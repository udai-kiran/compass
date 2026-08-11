import { and, eq, sql } from "drizzle-orm";
import type { AcceptRepayment, AcceptTransfer, ExtractedTransaction } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { extractedTransactions } from "../schema.ts";
import { accounts } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { linkTransfer, TRANSFER_WINDOW_DAYS } from "../../ledger/services/transfers.ts";
import { reload } from "./inbox-shared.ts";

/** Transfer / repayment classification: two-legged accepts that are NOT plain income/expense. */

/**
 * Claim one pending draft inside a transaction: flip it to `accepted` only if
 * it's still `pending` (row-locked so racing requests can't both win), and
 * report back what it was. Missing → 404, already-settled → 409. Private to
 * this file — its only two callers (`acceptTransfer`, `acceptRepayment`) both
 * live here; `acceptExtracted` (in `review-actions.ts`) has its own inline
 * claim and never called this helper, even in the original monolithic
 * `services/inbox.ts` (Codex review-1 B2).
 */
async function claimPending(db: DbOrTx, userId: string, id: string) {
  const [claimed] = await db
    .update(extractedTransactions)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(
      and(
        eq(extractedTransactions.id, id),
        eq(extractedTransactions.userId, userId),
        eq(extractedTransactions.status, "pending"),
      ),
    )
    .returning({
      amountPaise: extractedTransactions.amountPaise,
      direction: extractedTransactions.direction,
      occurredAtTs: extractedTransactions.occurredAtTs,
    });
  if (!claimed) {
    const [exists] = await db
      .select({ id: extractedTransactions.id })
      .from(extractedTransactions)
      .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    throw new HttpError(exists ? 409 : 404, exists ? "Draft is not pending" : "Draft not found");
  }
  return claimed;
}

/**
 * Accept two paired drafts as one account-to-account transfer: create the debit
 * leg on `fromAccountId` and the credit leg on `toAccountId`, then link them so
 * the movement never shows up as income + expense. The amount comes from the
 * drafts, not the client. All-or-nothing in a single transaction; both drafts
 * are claimed the same race-safe way an ordinary accept is.
 */
export async function acceptTransfer(
  db: Db,
  userId: string,
  input: AcceptTransfer,
): Promise<ExtractedTransaction[]> {
  if (input.fromAccountId === input.toAccountId) {
    throw new HttpError(400, "A transfer needs two different accounts");
  }
  if (input.outId === input.inId) {
    throw new HttpError(400, "A transfer needs two different drafts");
  }

  await db.transaction(async (tx) => {
    const out = await claimPending(tx, userId, input.outId);
    const inn = await claimPending(tx, userId, input.inId);
    if (out.direction !== "debit" || inn.direction !== "credit") {
      throw new HttpError(400, "A transfer is a debit leg paired with a credit leg");
    }
    if (out.amountPaise !== inn.amountPaise) {
      throw new HttpError(400, "Transfer legs must be equal amounts");
    }

    // Ownership is re-checked inside createTransaction; the names are just for labels.
    const [fromAcct, toAcct] = await Promise.all([
      tx.query.accounts.findFirst({
        where: and(eq(accounts.id, input.fromAccountId), eq(accounts.userId, userId)),
        columns: { name: true },
      }),
      tx.query.accounts.findFirst({
        where: and(eq(accounts.id, input.toAccountId), eq(accounts.userId, userId)),
        columns: { name: true },
      }),
    ]);

    const outTxn = await createTransaction(tx, userId, {
      accountId: input.fromAccountId,
      date: input.occurredAt,
      occurredAt: out.occurredAtTs,
      amountPaise: -out.amountPaise,
      merchant: toAcct ? `Transfer to ${toAcct.name}` : "Transfer out",
      categoryId: null,
      notes: "Transfer imported from email",
      tags: [],
      source: "import",
    });
    const inTxn = await createTransaction(tx, userId, {
      accountId: input.toAccountId,
      date: input.occurredAt,
      occurredAt: inn.occurredAtTs,
      amountPaise: inn.amountPaise,
      merchant: fromAcct ? `Transfer from ${fromAcct.name}` : "Transfer in",
      categoryId: null,
      notes: "Transfer imported from email",
      tags: [],
      source: "import",
    });
    // The link MERGES the two headers into one and deletes the inflow leg, so
    // both extracted rows must point at the survivor. Stamping `inTxn.id` here
    // — as this did before PR-G1 — would leave a dangling reference to a row
    // that no longer exists.
    const { id: transferId } = await linkTransfer(tx, userId, outTxn.id, inTxn.id);

    for (const extractedId of [input.outId, input.inId]) {
      await tx
        .update(extractedTransactions)
        .set({ transactionId: transferId })
        .where(and(eq(extractedTransactions.id, extractedId), eq(extractedTransactions.userId, userId)));
    }
  });

  return Promise.all([reload(db, userId, input.outId), reload(db, userId, input.inId)]);
}

/** What to do with a repayment's paying-account leg, given its existing candidates. */
export type RepaymentCandidateSelection =
  | { kind: "create" }
  | { kind: "reuse"; id: string }
  | { kind: "ambiguous"; count: number };

/**
 * Pure 0/1/many selection rule for `acceptRepayment`'s candidate detection: no
 * existing eligible debit means create one; exactly one means reuse it (never
 * touch it); two or more is refused rather than guessed, mirroring
 * `autoLinkTransfers`'s refusal to link an ambiguous pair. Takes only `id`s so
 * it's testable without a database — the SQL eligibility predicate itself
 * (amount/window/user/link-state filtering) is covered separately by DB-backed
 * tests.
 */
export function selectRepaymentCandidate(candidates: { id: string }[]): RepaymentCandidateSelection {
  if (candidates.length === 0) return { kind: "create" };
  if (candidates.length === 1) return { kind: "reuse", id: candidates[0]!.id };
  return { kind: "ambiguous", count: candidates.length };
}

/**
 * Accept a single card-repayment draft (a credit alert on the card) as a
 * transfer, instead of a plain categorized inflow. This is what fixes the
 * double-counted spend: `acceptExtracted` would book the card credit alone,
 * leaving the paying account's own debit (a real ledger row, from a statement
 * import or another alert) counted as ordinary expense on top of the card
 * purchases it repays. Linking both legs excludes both from income/expense.
 *
 * There is no `draftId` in the input — the draft is identified by the route
 * path only — and the amount always comes from the claimed draft, never the
 * client, so the ledger entry can't be severed from the alert that justifies
 * it (no amount override, even for a partial payment).
 *
 * Candidate detection (mirrors `suggestTransfers`, `transfers.ts:37-66`, so
 * the two agree by construction): look for an existing, unlinked debit on
 * `fromAccountId` that is exactly this repayment — opposite integer paise,
 * not soft-deleted, not an opening balance, not already linked, within
 * `TRANSFER_WINDOW_DAYS` of the reviewer's confirmed date. Zero candidates
 * creates the paying-account leg; exactly one is reused untouched (its
 * amount, date, timestamp, merchant and category are never written to);
 * two or more refuses with a 409 naming the count rather than guessing which
 * one is right.
 *
 * The candidate read is not itself an atomic claim — another request could
 * link the same candidate between this SELECT and `linkTransfer`. Deliberately
 * not using `SELECT ... FOR UPDATE` here: other `linkTransfer` callers
 * (`transfers.ts`, `autoLinkTransfers`) never take that lock, so it wouldn't
 * exclude them. The real atomic claim is `linkTransfer`'s sorted `FOR UPDATE`
 * header locks on both transaction rows
 * (`apps/api/src/modules/ledger/services/transfers.ts`) — whichever concurrent
 * call acquires both locks first wins, and the loser's post-lock posting-shape
 * validation via `classifyShape` detects that the transaction is already part
 * of a transfer and throws `HttpError(409, "Transaction is already part of a
 * transfer")`, which `acceptRepayment` catches outside the aborted transaction
 * and re-wraps in the friendlier "reload and try again" message.
 *
 * Timestamp/date provenance: newly created legs take the reviewer's `date`
 * (the in leg always; the out leg only in the zero-candidate branch). The in
 * (card) leg also carries the draft's precise `occurredAtTs` — the alert
 * genuinely describes this side. The synthetic out leg gets `occurredAt:
 * null`: there's no paying-side timestamp evidence, and inventing one would
 * block a later paying-account statement line from deduplicating against it.
 *
 * Does NOT call `autoLinkTransfers` afterward — the pair is already
 * explicitly linked, and an auto-link pass could incidentally link unrelated
 * candidates elsewhere in the ledger.
 */
export async function acceptRepayment(
  db: Db,
  userId: string,
  id: string,
  input: AcceptRepayment,
): Promise<ExtractedTransaction> {
  if (input.fromAccountId === input.cardAccountId) {
    throw new HttpError(400, "The paying account must be different from the card");
  }

  try {
    await db.transaction(async (tx) => {
      const claimed = await claimPending(tx, userId, id);
      if (claimed.direction !== "credit") {
        throw new HttpError(400, "A repayment must be a credit draft");
      }

      // Validate both accounts before creating either leg. A foreign account
      // (owned by another user) is 404, never grouped with the 400 cases below.
      const [cardAcct, fromAcct] = await Promise.all([
        tx.query.accounts.findFirst({
          where: and(eq(accounts.id, input.cardAccountId), eq(accounts.userId, userId)),
          columns: { id: true, name: true, type: true, archivedAt: true },
        }),
        tx.query.accounts.findFirst({
          where: and(eq(accounts.id, input.fromAccountId), eq(accounts.userId, userId)),
          columns: { id: true, name: true, type: true, archivedAt: true },
        }),
      ]);
      if (!cardAcct || !fromAcct) throw new HttpError(404, "Account not found");
      if (cardAcct.type !== "credit_card") {
        throw new HttpError(400, "The card account must be a credit card");
      }
      if (fromAcct.type === "credit_card") {
        throw new HttpError(400, "The paying account cannot be a credit card");
      }
      if (fromAcct.archivedAt) {
        throw new HttpError(400, "The paying account is archived");
      }

      const result = await tx.execute(sql`
        SELECT t.id
        FROM transactions t
        WHERE t.user_id = ${userId}
          AND t.deleted_at IS NULL
          AND abs(t.date::date - ${input.occurredAt}::date) <= ${TRANSFER_WINDOW_DAYS}
          AND EXISTS (
            SELECT 1 FROM postings p
            JOIN accounts a ON a.id = p.account_id AND a.system_kind IS NULL
            WHERE p.transaction_id = t.id
              AND p.account_id = ${input.fromAccountId}
              AND p.amount_paise = ${-claimed.amountPaise}
          )
          AND NOT EXISTS (
            SELECT 1 FROM postings p
            JOIN accounts a ON a.id = p.account_id AND a.system_kind = 'opening'
            WHERE p.transaction_id = t.id
          )
          AND 2 > (
            SELECT count(*) FROM postings p2
            JOIN accounts a2 ON a2.id = p2.account_id AND a2.system_kind IS NULL
            WHERE p2.transaction_id = t.id
          )
      `);
      const candidates = result.rows as { id: string }[];
      const selection = selectRepaymentCandidate(candidates);
      if (selection.kind === "ambiguous") {
        throw new HttpError(
          409,
          `${selection.count} existing transactions on the paying account could be this repayment — link one manually instead`,
        );
      }

      const outTransactionId =
        selection.kind === "reuse"
          ? selection.id
          : (
              await createTransaction(tx, userId, {
                accountId: input.fromAccountId,
                date: input.occurredAt,
                occurredAt: null,
                amountPaise: -claimed.amountPaise,
                merchant: `Card repayment to ${cardAcct.name}`,
                categoryId: null,
                notes: "Imported from email",
                tags: [],
                source: "import",
              })
            ).id;

      const inTxn = await createTransaction(tx, userId, {
        accountId: input.cardAccountId,
        date: input.occurredAt,
        occurredAt: claimed.occurredAtTs,
        amountPaise: claimed.amountPaise,
        merchant: `Card repayment from ${fromAcct.name}`,
        categoryId: null,
        notes: "Imported from email",
        tags: [],
        source: "import",
      });

      // As above: the merge keeps the outflow header, so the extracted row
      // points at the survivor, not at the absorbed inflow leg.
      const { id: transferId } = await linkTransfer(tx, userId, outTransactionId, inTxn.id);

      await tx
        .update(extractedTransactions)
        .set({ transactionId: transferId })
        .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    });
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 409 && err.message === "Transaction is already part of a transfer") {
      throw new HttpError(409, "That payment was linked to another transfer just now — reload and try again.");
    }
    throw err;
  }

  return reload(db, userId, id);
}
