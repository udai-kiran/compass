import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { StatementReconciliation } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts, extractedTransactions, transactions } from "../../../db/schema.ts";
import { statementReconciliations } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { withSerializableRetry } from "../../../lib/serializable.ts";
import { repairSnapshots } from "../../investments/services/networth.ts";
import { ownedCardAccount } from "./cards.ts";
import { dueDrift, ledgerDuesAtDates, summarizeStatementLines, toReconciliationDto } from "./reconciliation-reads.ts";

/**
 * Re-derive one cycle's reconciliation from the ledger as it stands now, and
 * re-stamp the transactions it cleared.
 *
 * The extractor's snapshot is a point-in-time reading; accepting the statement's
 * lines afterwards (the normal flow) leaves it understating what is cleared.
 * This is the repair path — read-only with respect to the statement lines
 * themselves, so it can be run as often as the user likes.
 *
 * Reads `extractedTransactions` (an ingest-module table, task 1.7) directly —
 * pre-existing direct/raw-SQL cross-module access, unchanged by this move
 * (see tasks/008-migrate-credit/TASK.md Root Cause; not fixed here, same
 * discipline task 1.1 established for its own domain).
 */
export async function recomputeReconciliation(
  db: Db,
  userId: string,
  accountId: string,
  id: string,
): Promise<StatementReconciliation> {
  await ownedCardAccount(db, userId, accountId);
  const updated = await db.transaction(async (tx) => {
    // Lock the snapshot for the duration: the extractor upserts this same row by
    // (account_id, period), and without the lock a concurrent statement run could
    // leave a hybrid of its ingestion and our stats.
    const [snapshot] = await tx
      .select()
      .from(statementReconciliations)
      .where(
        and(
          eq(statementReconciliations.id, id),
          eq(statementReconciliations.accountId, accountId),
          eq(statementReconciliations.userId, userId),
        ),
      )
      .for("update");
    if (!snapshot) throw new HttpError(404, "Reconciliation not found");
    // The snapshot names the statement email its lines came from. Without it there
    // is nothing to recompute against (the ingestion was deleted).
    if (!snapshot.ingestionId) {
      throw new HttpError(409, "This statement's email is no longer available to re-check");
    }

    const lines = await tx
      .select({
        direction: extractedTransactions.direction,
        amountPaise: extractedTransactions.amountPaise,
        transactionId: extractedTransactions.transactionId,
        matchedTransactionId: extractedTransactions.matchedTransactionId,
      })
      .from(extractedTransactions)
      .where(
        and(
          eq(extractedTransactions.ingestionId, snapshot.ingestionId),
          eq(extractedTransactions.userId, userId),
          // One email can in principle carry more than one card's lines; only this
          // card's belong to this cycle.
          eq(extractedTransactions.suggestedAccountId, accountId),
        ),
      );

    // A link is only real if the transaction is still there, still this user's, and
    // still on this card: a since-deleted or moved row must not count as cleared.
    const candidateIds = [
      ...new Set(
        lines.flatMap((l) =>
          [l.matchedTransactionId, l.transactionId].filter((v): v is string => v !== null),
        ),
      ),
    ];
    const live =
      candidateIds.length === 0
        ? []
        : await tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                inArray(transactions.id, candidateIds),
                eq(transactions.userId, userId),
                eq(transactions.accountId, accountId),
                isNull(transactions.deletedAt),
              ),
            );
    const liveIds = new Set(live.map((t) => t.id));
    const stats = summarizeStatementLines(
      { lineCount: snapshot.lineCount, lineDebitPaise: snapshot.lineDebitPaise },
      lines.map((l) => {
        // The duplicate link is the stronger claim; fall back to the accepted one.
        const linked = [l.matchedTransactionId, l.transactionId].find(
          (v): v is string => v !== null && liveIds.has(v),
        );
        return { direction: l.direction, amountPaise: l.amountPaise, ledgerTxnId: linked ?? null };
      }),
    );

    const [row] = await tx
      .update(statementReconciliations)
      .set({
        matchedCount: stats.matchedCount,
        matchedPaise: stats.matchedPaise,
        unmatchedCount: stats.unmatchedCount,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statementReconciliations.id, id),
          eq(statementReconciliations.accountId, accountId),
          eq(statementReconciliations.userId, userId),
        ),
      )
      .returning();
    // Re-stamp as the extractor does: drop this cycle's prior stamps so a recompute
    // that clears fewer rows leaves none stale, then mark the current set. Both
    // writes stay scoped to this user's rows on this card.
    await tx
      .update(transactions)
      .set({ reconciledStatementId: null })
      .where(
        and(
          eq(transactions.reconciledStatementId, id),
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
        ),
      );
    if (stats.matchedTxnIds.length > 0) {
      await tx
        .update(transactions)
        .set({ reconciledStatementId: id })
        .where(
          and(
            inArray(transactions.id, stats.matchedTxnIds),
            eq(transactions.userId, userId),
            eq(transactions.accountId, accountId),
            isNull(transactions.deletedAt),
          ),
        );
    }

    // Enrich with the same ledger-due arithmetic as listReconciliations, computed
    // through this same transaction handle (not a follow-up call after commit) so
    // the returned drift describes the identical ledger snapshot as `row`'s stats
    // — see review-1/2 on recompute's enrichment needing one consistent instant.
    const [acctRow] = await tx
      .select({ openingBalancePaise: accounts.openingBalancePaise })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    const ledgerDuePaise =
      row!.statementDate !== null && acctRow
        ? ((
            await ledgerDuesAtDates(tx, userId, accountId, acctRow.openingBalancePaise, [row!.statementDate])
          ).get(row!.statementDate) ?? null)
        : null;
    return { row: row!, ledgerDuePaise };
  });
  return toReconciliationDto(updated.row, updated.ledgerDuePaise);
}

// ---------- statement reconciliation: absorb a carried-forward balance ----------

/**
 * Test-only concurrency seam for `absorbCarryover`. Every field is optional
 * and a no-op in every production caller — see `afterAggregate` below.
 */
export interface AbsorbCarryoverHooks {
  /**
   * Fires once per attempt, immediately after this transaction has read the
   * ledger aggregate (`ledgerDuesAtDates`) and before it updates the account
   * row. Exists so a test can deterministically land a concurrent write in
   * exactly the window the SSI race depends on
   * (tasks/cc-recon-02-carryover-seed/TASK.md P6a). Never set by a real
   * route handler.
   */
  afterAggregate?: () => Promise<void>;
}

/**
 * Absorb a statement's carried-forward balance into the card's opening
 * balance, so the ledger-derived due at that statement's close matches what
 * the issuer actually billed (`totalDuePaise`). See
 * tasks/cc-recon-02-carryover-seed/TASK.md.
 *
 * Runs in ONE transaction at `SERIALIZABLE` isolation, wrapped by
 * `withSerializableRetry` (one retry on SQLSTATE `40001`): a concurrent
 * ledger write touching this card, a settings opening-balance edit, or a
 * second absorb call (same or a different reconciliation row of the same
 * card) either serializes cleanly against this call or forces it to retry
 * against fresh state — it never commits an adjustment computed from a
 * ledger snapshot that no longer held by commit time.
 *
 * Lock order is account (`FOR UPDATE`) then reconciliation (`FOR UPDATE`) —
 * the same order `updateAccount` (accounts.ts) uses for its own
 * opening-balance edits, so the two can never deadlock against each other.
 * Every check (existence, `type = 'credit_card'`, not archived) is read from
 * that same locked row version, not from an earlier unlocked read.
 *
 * Only a POSITIVE drift is absorbed (`drift <= 0` → 409 "Nothing to carry
 * forward"): drift is evidence of a carried-forward balance, not proof of
 * one — missing, misdated, or misassigned ledger entries can produce the
 * same number — so an already-complete or over-complete ledger is never
 * silently reinterpreted as history.
 *
 * `opening_balance_paise` carries no effective date, so this mutation
 * reinterprets the card's liability for every historical date, not merely
 * from today forward. That is accepted deliberately (TASK.md P4): a card
 * onboarded mid-history should have carried this balance from account
 * creation, so this corrects history rather than corrupting it. After
 * commit this fires a fire-and-forget, best-effort `repairSnapshots` scoped
 * to this user, `from` = the account's `created_at` converted to a UTC date
 * string — errors (including `repairSnapshots`'s own 409 when a repair is
 * already running) are logged and never fail this call's response.
 * `recomputeSnapshotsSince` (which `repairSnapshots` wraps) clamps `from` to
 * at most `MAX_RECOMPUTE_SINCE_DAYS` (370) days before today, and the
 * nightly sweep only ever revisits the trailing 45 days — so for a card
 * older than ~370 days, stored net-worth snapshots between account creation
 * and that clamp boundary remain UNREPAIRED until a future targeted repair.
 * This is an accepted, disclosed limitation (see the web confirm dialog),
 * not a bug.
 */
export async function absorbCarryover(
  db: Db,
  redis: Pick<Redis, "set" | "eval">,
  userId: string,
  accountId: string,
  reconciliationId: string,
  hooks?: AbsorbCarryoverHooks,
): Promise<StatementReconciliation> {
  const { dto, createdAt } = await withSerializableRetry(() =>
    db.transaction(
      async (tx) => {
        // Lock the account first — this is what serializes against a concurrent
        // opening-balance edit (updateAccount locks the same row the same way
        // before its own edit) or a second absorb on this same card.
        const [account] = await tx
          .select()
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
          .for("update");
        if (!account) throw new HttpError(404, "Account not found");
        if (account.type !== "credit_card") throw new HttpError(400, "Not a credit card account");
        if (account.archivedAt !== null) throw new HttpError(409, "Card is archived");

        const [reconciliation] = await tx
          .select()
          .from(statementReconciliations)
          .where(
            and(
              eq(statementReconciliations.id, reconciliationId),
              eq(statementReconciliations.accountId, accountId),
              eq(statementReconciliations.userId, userId),
            ),
          )
          .for("update");
        if (!reconciliation) throw new HttpError(404, "Reconciliation not found");
        if (reconciliation.totalDuePaise === null || reconciliation.statementDate === null) {
          throw new HttpError(409, "This statement has no total due or statement date to absorb against");
        }
        const statementDate = reconciliation.statementDate;

        // Recompute the ledger due server-side, inside this same transaction —
        // never trust a client-sent number, and never reuse a figure read before
        // this transaction started.
        const beforeLedgerDueByDate = await ledgerDuesAtDates(
          tx,
          userId,
          accountId,
          account.openingBalancePaise,
          [statementDate],
        );
        const ledgerDuePaise = beforeLedgerDueByDate.get(statementDate) ?? null;

        // Test seam only — see AbsorbCarryoverHooks. Fires after the ledger
        // aggregate read above and before the account UPDATE below, which is the
        // exact window tasks/cc-recon-02-carryover-seed/TASK.md P6a's SSI
        // dependency-cycle test depends on.
        await hooks?.afterAggregate?.();

        const drift = dueDrift(reconciliation.totalDuePaise, ledgerDuePaise);
        if (drift === null || drift <= 0) {
          throw new HttpError(409, "Nothing to carry forward");
        }

        // Sign proof: ledgerDue = −(opening + Σtx); want −(opening' + Σtx) =
        // totalDue ⇒ opening' = opening − drift (see dueDrift and TASK.md P1).
        const nextOpeningBalancePaise = account.openingBalancePaise - drift;
        if (!Number.isSafeInteger(nextOpeningBalancePaise)) {
          throw new HttpError(500, "Adjusted opening balance exceeded a safe integer — refusing to lose paise");
        }

        await tx
          .update(accounts)
          .set({ openingBalancePaise: nextOpeningBalancePaise })
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

        // Re-derive from the post-update state through this SAME tx handle (not a
        // follow-up call after commit), mirroring recomputeReconciliation's own
        // enrichment — the returned drift must describe the committed opening
        // balance, not the pre-update arithmetic.
        const afterLedgerDueByDate = await ledgerDuesAtDates(
          tx,
          userId,
          accountId,
          nextOpeningBalancePaise,
          [statementDate],
        );
        const afterLedgerDuePaise = afterLedgerDueByDate.get(statementDate) ?? null;

        return {
          dto: toReconciliationDto(reconciliation, afterLedgerDuePaise),
          createdAt: account.createdAt,
        };
      },
      { isolationLevel: "serializable" },
    ),
  );

  // Post-commit, fire-and-forget: never let a repair failure fail this
  // response (see JSDoc above). Logged, not surfaced.
  const from = createdAt.toISOString().slice(0, 10);
  void repairSnapshots(db, redis, userId, from).catch((err: unknown) => {
    console.error("absorbCarryover: post-commit net-worth snapshot repair failed", {
      userId,
      accountId,
      from,
      err,
    });
  });

  return dto;
}
