import { and, asc, eq, gt, isNull, lt, max, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { CreateSip, Sip, UpdateSip } from "@compass/shared";
import {
  CreateSipSchema,
  UpdateSipSchema,
  accountCanHaveGoal,
  isBankAccount,
  sipDateRangeValid,
  sipFundingSourceIssue,
  todayInIST,
} from "@compass/shared";
import type { AccountType, SipFundingSource, SipTargetKind } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { accounts, transactions } from "../../../db/schema.ts";
import { holdingEvents, holdings, sips } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { assertOwnedGoal } from "../../../lib/ownership.ts";
import { dueInstallmentDate } from "./sip-schedule.ts";

type SipRow = typeof sips.$inferSelect;

export function toSip(s: SipRow, lastInstallmentDate: string | null, today: string = todayInIST()): Sip {
  return {
    id: s.id,
    goalId: s.goalId,
    sourceAccountId: s.sourceAccountId,
    targetKind: s.targetKind,
    targetHoldingId: s.targetHoldingId,
    targetAccountId: s.targetAccountId,
    amountPaise: s.amountPaise,
    dayOfMonth: s.dayOfMonth,
    frequency: s.frequency,
    status: s.status,
    fundingSource: s.fundingSource,
    startDate: s.startDate,
    endDate: s.endDate,
    lastInstallmentDate,
    dueInstallmentDate: dueInstallmentDate(s, lastInstallmentDate, today),
  };
}

/**
 * True when an error is a Postgres unique violation (SQLSTATE 23505) raised
 * by one specific constraint. Matching the constraint name as well as the
 * code matters: a bare 23505 check would relabel any future unique index on
 * holding_events as "this installment is already recorded". Goes through
 * `pgError` because Drizzle wraps the driver error — see its doc comment.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pg = pgError(err);
  return pg !== null && pg.code === "23505" && pg.constraint === constraint;
}

/**
 * True when an error is a Postgres check-constraint violation (SQLSTATE
 * 23514) raised by one specific constraint. Matching the constraint name as
 * well as the code matters: a bare 23514 check would relabel any future check
 * constraint on sips as "this SIP update conflicts with another". Goes
 * through `pgError` because Drizzle wraps the driver error — see its doc
 * comment.
 */
export function isCheckViolation(err: unknown, constraint: string): boolean {
  const pg = pgError(err);
  return pg !== null && pg.code === "23514" && pg.constraint === constraint;
}

/**
 * The greater (more recent) of two nullable ISO `YYYY-MM-DD` installment
 * dates — null when neither side has a recorded installment. Pure so the
 * merge of an MF-folio SIP's `holding_events` installments and an
 * account-target SIP's `transactions` installments (see
 * `lastInstallmentDateFor` / `listSipsForGoal`) is unit-testable without a
 * DB. ISO dates compare correctly as plain strings, so no Date parsing is
 * needed.
 */
export function laterInstallmentDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * The greater of MAX(holding_events.date) and MAX(transactions.date) over a
 * SIP's recorded installments, or null if it has none. An MF-folio SIP
 * records via `holding_events`; an account-target SIP (PPF/SSY) will record
 * via a ledger `transactions` row instead — so both sources are checked.
 * Soft-deleted transactions are excluded: a deleted transaction must not
 * count as a recorded installment (see modules/ledger/services/balances.ts).
 */
export async function lastInstallmentDateFor(db: DbOrTx, sipId: string): Promise<string | null> {
  const holdingRows = await db
    .select({ lastInstallmentDate: max(holdingEvents.date) })
    .from(holdingEvents)
    .where(eq(holdingEvents.sipId, sipId));
  const txRows = await db
    .select({ lastInstallmentDate: max(transactions.date) })
    .from(transactions)
    .where(and(eq(transactions.sipId, sipId), isNull(transactions.deletedAt)));
  return laterInstallmentDate(
    holdingRows[0]?.lastInstallmentDate ?? null,
    txRows[0]?.lastInstallmentDate ?? null,
  );
}

export async function ownedSip(db: Db, userId: string, id: string): Promise<SipRow> {
  const row = await db.query.sips.findFirst({ where: and(eq(sips.id, id), eq(sips.userId, userId)) });
  if (!row) throw new HttpError(404, "SIP not found");
  return row;
}

/**
 * Whether an `archivedAt` timestamp marks a row as archived — pure so the
 * archived-source/target rejection in `assertBankSource`/
 * `assertAccountTargetType`/`ownedHoldingGoal` is unit-testable without a DB.
 */
export function isArchived(archivedAt: Date | string | null): boolean {
  return archivedAt !== null;
}

/**
 * Locks an owned account row `FOR UPDATE` and returns the columns SIP
 * validation needs. Must run inside the caller's transaction — the lock is
 * what serializes a concurrent SIP create/update against a concurrent
 * account edit (type/goal/archive) on the same row: whichever transaction's
 * `SELECT ... FOR UPDATE` commits first is what the other one's re-read sees,
 * so the loser's later check (either side) can't act on stale data.
 */
async function lockedAccountForSip(
  db: DbOrTx,
  userId: string,
  accountId: string,
): Promise<{ type: AccountType; goalId: string | null; archivedAt: Date | null } | null> {
  const rows = await db
    .select({ type: accounts.type, goalId: accounts.goalId, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .for("update");
  return rows[0] ?? null;
}

/**
 * Fetch the source account and confirm it's a bank kind — a SIP is an
 * auto-debit from a transactable bank account, not a cash/card/loan/scheme.
 * (The lookup by (id, userId) doubles as the ownership check.) Also rejects
 * an archived account: an archived source is excluded from the cash forecast's
 * starting balance while its SIP debit would keep landing in the forecast.
 */
async function assertBankSource(db: DbOrTx, userId: string, accountId: string): Promise<void> {
  const acc = await lockedAccountForSip(db, userId, accountId);
  if (!acc) throw new HttpError(404, "Account not found");
  if (isArchived(acc.archivedAt)) throw new HttpError(400, "Source account is archived");
  if (!isBankAccount(acc.type)) throw new HttpError(400, "SIP source must be a bank account");
}

/**
 * A target account (PPF/EPF/SSY/investment) must be owned, distinct from the
 * source, and one of the goal-eligible investment-scheme types — the same set
 * `accounts.goalId` accepts (see `accountCanHaveGoal`). Bank/cash accounts are
 * excluded even though they aren't liabilities: the 90-day cash forecast
 * subtracts every SIP debit from the aggregate bank+cash balance
 * (`bankCashTotal`, which sums exactly `type in ('bank', 'cash')`), so a
 * bank→bank "SIP" would fabricate a cash loss instead of moving money between
 * two balances the forecast already counts. Also rejects an archived target:
 * an archived account would vanish from goal-asset totals while staying
 * "committed" via the SIP. Returns the target's current goal-earmark so the
 * caller can reconcile it against the SIP's goal.
 */
async function assertAccountTargetType(
  db: DbOrTx,
  userId: string,
  targetAccountId: string,
  sourceAccountId: string,
): Promise<{ goalId: string | null }> {
  if (targetAccountId === sourceAccountId) {
    throw new HttpError(400, "SIP target account must differ from the source account");
  }
  const acc = await lockedAccountForSip(db, userId, targetAccountId);
  if (!acc) throw new HttpError(404, "Account not found");
  if (isArchived(acc.archivedAt)) throw new HttpError(400, "Target account is archived");
  if (!accountCanHaveGoal(acc.type)) {
    throw new HttpError(
      400,
      "SIP target account must be an investment-scheme account (investment/PPF/EPF/SSY) — not bank, cash, or a liability",
    );
  }
  return { goalId: acc.goalId };
}

/**
 * Owned-holding lookup, locked `FOR UPDATE` (same TOCTOU rationale as
 * `lockedAccountForSip`), that also returns its current goal-earmark for the
 * goal reconciliation and rejects an archived holding — an archived folio
 * would drop out of goal-asset totals while its SIP kept counting as committed.
 */
async function ownedHoldingGoal(db: DbOrTx, userId: string, holdingId: string): Promise<{ goalId: string | null }> {
  const rows = await db
    .select({ goalId: holdings.goalId, archivedAt: holdings.archivedAt })
    .from(holdings)
    .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)))
    .for("update");
  const h = rows[0];
  if (!h) throw new HttpError(404, "Holding not found");
  if (isArchived(h.archivedAt)) throw new HttpError(400, "Target holding is archived");
  return h;
}

/**
 * How a SIP target's existing goal-earmark relates to the SIP's own goal.
 * Pure so it's unit-testable without a DB:
 * - unmapped (`null`) → "link": explicit mapping-on-create, the target gets
 *   earmarked to this goal so it (and only it) counts toward its funding.
 * - already mapped to this goal → "allow": no-op, already correct.
 * - mapped to a *different* goal → "reject": leaving it would let the same
 *   asset count toward two goals' committed funding/gap math at once.
 */
export type TargetGoalDecision = "allow" | "link" | "reject";

export function resolveTargetGoalDecision(sipGoalId: string, targetGoalId: string | null): TargetGoalDecision {
  if (targetGoalId === null) return "link";
  return targetGoalId === sipGoalId ? "allow" : "reject";
}

/**
 * Merges a partial SIP date update with the stored row's dates —
 * `undefined` means "not touched" (keep the current value), an explicit
 * `null` clears `endDate` (open-ended). Pure so the resolved-pair rule
 * (`sipDateRangeValid`) is testable without a DB: an update that only
 * changes one of the two dates can invert the pair even though neither
 * field is invalid on its own (the schema-level `.check()` can't catch
 * this — it only sees the fields actually sent).
 */
export function resolveSipDateRange(
  current: { startDate: string; endDate: string | null },
  patch: { startDate?: string; endDate?: string | null },
): { startDate: string; endDate: string | null } {
  return {
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
  };
}

/**
 * Merges a partial SIP target-kind/funding-source update with the stored
 * row's values — `undefined` means "not touched" (keep the current value).
 * Pure so the resolved-pair rule (`sipFundingSourceIssue`) is testable
 * without a DB: a patch that only changes `fundingSource` (or only
 * `targetKind`) can produce an invalid payroll+mf_folio pair even though
 * neither field is invalid on its own — the schema-level `.check()` can't
 * catch this, it only sees the fields actually sent. Mirrors
 * `resolveSipDateRange`.
 */
export function resolveSipFundingTarget(
  current: { targetKind: SipTargetKind; fundingSource: SipFundingSource },
  patch: { targetKind?: SipTargetKind; fundingSource?: SipFundingSource },
): { targetKind: SipTargetKind; fundingSource: SipFundingSource } {
  return {
    targetKind: patch.targetKind ?? current.targetKind,
    fundingSource: patch.fundingSource ?? current.fundingSource,
  };
}

/**
 * Whether a SIP update moves the plan somewhere its already-linked installments
 * cannot belong. `transactions.sip_id` says "this deposit into this SIP's target
 * account funded an installment" — repoint the SIP at a different account, at an
 * MF folio, or onto payroll and those deposits stop being its installments
 * entirely: they would keep driving `lastInstallmentDate` for a target they never
 * funded, while `listSipInstallmentCandidates` filters them out of the picker, so
 * the user could not even detach them by hand. `undefined` means "not touched"
 * and a field resent unchanged is deliberately not a change. Pure so the rule is
 * pinned by a test rather than by reading `updateSip` closely.
 */
export function sipEditOrphansLinks(
  current: { targetKind: SipTargetKind; targetAccountId: string | null; fundingSource: SipFundingSource },
  patch: { targetKind?: SipTargetKind; targetAccountId?: string | null; fundingSource?: SipFundingSource },
): boolean {
  if (patch.targetKind !== undefined && patch.targetKind !== current.targetKind) return true;
  if (patch.targetAccountId !== undefined && patch.targetAccountId !== current.targetAccountId) return true;
  if (patch.fundingSource !== undefined && patch.fundingSource !== current.fundingSource) return true;
  return false;
}

/**
 * Turns the affected-row count of `linkTargetToGoal`'s conditional UPDATE into
 * a pass/reject decision — pure so the TOCTOU guard is unit-testable without a
 * DB. Zero rows means the `goal_id IS NULL` predicate no longer matched: some
 * other request linked the target (to any goal, possibly this one) between
 * this transaction's read and write, so the caller must not proceed as if it
 * still owns an unclaimed target.
 */
export function assertLinkRowsMatched(matchedRows: number): void {
  if (matchedRows === 0) {
    throw new HttpError(409, "Target was just linked to another goal — refresh and retry");
  }
}

/**
 * Links an unmapped target to the SIP's goal — conditional on the target
 * *still* being unmapped at write time (`goal_id IS NULL`), not just at the
 * read a moment earlier in `assertAndLinkTarget`. Without this, two concurrent
 * SIP creations can both read `goalId: null`, both pass `resolveTargetGoalDecision`
 * as "link", and both unconditionally UPDATE — racing to earmark the same
 * target to two different goals while both SIPs insert successfully. The
 * conditional WHERE makes the loser's UPDATE match zero rows instead, which
 * `assertLinkRowsMatched` turns into a 409 that rolls back the whole
 * transaction (this runs inside `createSip`/`updateSip`'s `db.transaction`).
 */
async function linkTargetToGoal(
  db: DbOrTx,
  userId: string,
  goalId: string,
  targetKind: SipTargetKind,
  targetHoldingId: string | null,
  targetAccountId: string | null,
): Promise<void> {
  if (targetKind === "mf_folio") {
    const rows = await db
      .update(holdings)
      .set({ goalId, updatedAt: new Date() })
      .where(and(eq(holdings.id, targetHoldingId!), eq(holdings.userId, userId), isNull(holdings.goalId)))
      .returning({ id: holdings.id });
    assertLinkRowsMatched(rows.length);
  } else {
    const rows = await db
      .update(accounts)
      .set({ goalId, updatedAt: new Date() })
      .where(and(eq(accounts.id, targetAccountId!), eq(accounts.userId, userId), isNull(accounts.goalId)))
      .returning({ id: accounts.id });
    assertLinkRowsMatched(rows.length);
  }
}

/**
 * Validates a SIP target's type/ownership and reconciles its goal-earmark
 * with the SIP's own goal (see `resolveTargetGoalDecision`). Must run inside
 * the same transaction as the SIP insert/update so the target's goal link and
 * the SIP row commit or roll back together.
 */
async function assertAndLinkTarget(
  tx: DbOrTx,
  userId: string,
  goalId: string,
  input: { targetKind: SipTargetKind; targetHoldingId: string | null; targetAccountId: string | null },
  sourceAccountId: string,
): Promise<void> {
  const target =
    input.targetKind === "mf_folio"
      ? await ownedHoldingGoal(tx, userId, input.targetHoldingId!)
      : await assertAccountTargetType(tx, userId, input.targetAccountId!, sourceAccountId);

  const decision = resolveTargetGoalDecision(goalId, target.goalId);
  if (decision === "reject") {
    throw new HttpError(409, "This target is already earmarked for a different goal");
  }
  if (decision === "link") {
    await linkTargetToGoal(tx, userId, goalId, input.targetKind, input.targetHoldingId, input.targetAccountId);
  }
}

/**
 * Shared SIP-list query. Both installment-date sources are scalar subqueries
 * rather than a second `leftJoin` — two leftJoins here would produce a
 * cartesian product across a SIP's holding-event and transaction rows.
 * `laterInstallmentDate` picks the greater of the two in TypeScript.
 *
 * Kept as one builder so the per-goal and cross-goal listings can never drift
 * on how `lastInstallmentDate` (and therefore `dueInstallmentDate`) is derived.
 * Every caller must include a `sips.userId` predicate in `where` — there is no
 * unscoped SIP listing.
 */
async function listSipsWhere(db: Db, where: SQL): Promise<Sip[]> {
  const rows = await db
    .select({
      sip: sips,
      lastHoldingEventDate: sql<string | null>`(select max(${holdingEvents.date}) from ${holdingEvents} where ${holdingEvents.sipId} = ${sips.id})`,
      lastTransactionDate: sql<string | null>`(select max(${transactions.date}) from ${transactions} where ${transactions.sipId} = ${sips.id} and ${transactions.deletedAt} is null)`,
    })
    .from(sips)
    .where(where)
    .orderBy(asc(sips.createdAt));
  return rows.map((r) => toSip(r.sip, laterInstallmentDate(r.lastHoldingEventDate, r.lastTransactionDate)));
}

export async function listSipsForGoal(db: Db, userId: string, goalId: string): Promise<Sip[]> {
  return listSipsWhere(db, and(eq(sips.userId, userId), eq(sips.goalId, goalId))!);
}

/**
 * Every SIP the user has, across all goals — backs the `/sips` page's
 * cross-goal recording list. Ordered by `createdAt` like the per-goal listing;
 * the page does its own due-first grouping.
 */
export async function listAllSips(db: Db, userId: string): Promise<Sip[]> {
  return listSipsWhere(db, eq(sips.userId, userId));
}

export async function createSip(db: Db, userId: string, input: CreateSip): Promise<Sip> {
  const parsed = CreateSipSchema.parse(input);
  await assertOwnedGoal(db, userId, parsed.goalId);

  return db.transaction(async (tx) => {
    // Source/target rows are locked FOR UPDATE inside these validations (see
    // lockedAccountForSip / ownedHoldingGoal) — must run inside this
    // transaction, before assertAndLinkTarget's decision+write, so a
    // concurrent account/holding edit (type/goal/archive) can't race past
    // the check it would otherwise fail here.
    await assertBankSource(tx, userId, parsed.sourceAccountId);
    await assertAndLinkTarget(tx, userId, parsed.goalId, parsed, parsed.sourceAccountId);
    const rows = await tx.insert(sips).values({ ...parsed, userId }).returning();
    // A brand-new SIP has no installments recorded against it yet.
    return toSip(rows[0]!, null);
  });
}

/**
 * Updates a SIP's plan fields. Beyond the direct edit, this can *detach*
 * installments that are currently linked to it (`transactions.sip_id`):
 * repointing `targetAccountId`/`targetKind`/`fundingSource` invalidates every
 * existing link outright (see `sipEditOrphansLinks`), and narrowing the
 * `startDate`/`endDate` window detaches only the individual installments that
 * now fall outside it. Both are necessary — otherwise a stale link would keep
 * driving `lastInstallmentDate` for a target/window it no longer represents,
 * while `listSipInstallmentCandidates` (which re-derives its own window/target
 * from the current SIP row) would filter that same row out of the picker, so
 * the user could never even detach it by hand.
 */
export async function updateSip(db: Db, userId: string, id: string, input: UpdateSip): Promise<Sip> {
  const parsed = UpdateSipSchema.parse(input);
  const current = await ownedSip(db, userId, id);

  const sourceAccountId = parsed.sourceAccountId ?? current.sourceAccountId;

  // A partial update can invert start/end independently of the create-time
  // check (see sipDateRangeValid) — validate the *resolved* pair, merging
  // whichever field wasn't touched in from the stored row.
  const resolvedDates = resolveSipDateRange(current, parsed);
  if (!sipDateRangeValid(resolvedDates.startDate, resolvedDates.endDate)) {
    throw new HttpError(400, "endDate must be on or after startDate");
  }

  // Same reasoning as the date-range check above: a patch that only touches
  // `fundingSource` or only `targetKind` can produce an invalid payroll+mf_folio
  // pair without either field failing the create-time schema check on its own.
  const resolvedFunding = resolveSipFundingTarget(current, parsed);
  const fundingIssue = sipFundingSourceIssue(resolvedFunding.targetKind, resolvedFunding.fundingSource);
  if (fundingIssue) {
    throw new HttpError(400, fundingIssue.message);
  }

  return db.transaction(async (tx) => {
    // See createSip: source/target locks must happen inside this transaction,
    // before the target decision+write, to close the same edit-vs-SIP race.
    if (parsed.sourceAccountId !== undefined) {
      await assertBankSource(tx, userId, parsed.sourceAccountId);
    }
    if (parsed.targetKind !== undefined) {
      // goalId is immutable on update (not part of UpdateSipSchema) — reconcile
      // against the SIP's existing goal.
      await assertAndLinkTarget(
        tx,
        userId,
        current.goalId,
        {
          targetKind: parsed.targetKind,
          targetHoldingId: parsed.targetHoldingId ?? null,
          targetAccountId: parsed.targetAccountId ?? null,
        },
        sourceAccountId,
      );
    } else if (parsed.sourceAccountId !== undefined && current.targetKind === "account") {
      // Source changed but target didn't — re-check the (source, target) pair still differs.
      await assertAccountTargetType(tx, userId, current.targetAccountId!, sourceAccountId);
    }

    let rows;
    try {
      rows = await tx
        .update(sips)
        .set(parsed)
        .where(and(eq(sips.id, id), eq(sips.userId, userId)))
        .returning();
    } catch (err) {
      // A concurrent partial update can each validate the merged
      // (targetKind, fundingSource) pair against the same pre-transaction row
      // and still combine into an invalid pair — the sipFundingSourceIssue
      // check above can't catch that race, so the DB-level check constraint
      // is what actually rejects it here.
      if (isCheckViolation(err, "sips_payroll_requires_account_target")) {
        throw new HttpError(409, "This SIP's funding source or target just changed — refresh and retry");
      }
      throw err;
    }
    if (rows.length === 0) throw new HttpError(404, "SIP not found");

    // Clearing runs under the sips row's own lock and only ever touches rows
    // already pointing at this SIP, so it keeps the sips-before-transactions
    // order linkSipInstallment established (see the lock-order comment there).
    if (sipEditOrphansLinks(current, parsed)) {
      await tx
        .update(transactions)
        .set({ sipId: null, updatedAt: new Date() })
        .where(and(eq(transactions.userId, userId), eq(transactions.sipId, id)));
    } else if (parsed.startDate !== undefined || parsed.endDate !== undefined) {
      // A narrowed window strands individual installments rather than all of
      // them: only the ones that now fall outside it are detached, so extending
      // an endDate never throws away recorded history. This `lt`/`gt` pair is the
      // SQL mirror of `installmentDateError`'s window rule — same inclusive
      // boundaries, same `endDate: null` meaning open-ended — so the two must be
      // kept in step or a row could be judged in-window by one and stranded by
      // the other.
      const outOfWindow: SQL[] = [lt(transactions.date, resolvedDates.startDate)];
      if (resolvedDates.endDate !== null) outOfWindow.push(gt(transactions.date, resolvedDates.endDate));
      await tx
        .update(transactions)
        .set({ sipId: null, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.sipId, id),
            or(...outOfWindow)!,
          ),
        );
    }

    // Now that any stale links have been cleared above, recompute what's left.
    const lastInstallmentDate = await lastInstallmentDateFor(tx, id);
    return toSip(rows[0]!, lastInstallmentDate);
  });
}

export async function deleteSip(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(sips)
    .where(and(eq(sips.id, id), eq(sips.userId, userId)))
    .returning({ id: sips.id });
  if (rows.length === 0) throw new HttpError(404, "SIP not found");
}
