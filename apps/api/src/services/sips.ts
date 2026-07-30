import { and, asc, desc, eq, gt, gte, isNull, lt, lte, max, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  CreateSip,
  HoldingEvent,
  LinkSipInstallment,
  RecordSipInstallment,
  Sip,
  SipInstallmentCandidate,
  UpdateSip,
} from "@compass/shared";
import {
  CreateSipSchema,
  LinkSipInstallmentSchema,
  RecordSipInstallmentSchema,
  UpdateSipSchema,
  accountCanHaveGoal,
  isBankAccount,
  sipDateRangeValid,
  sipFundingSourceIssue,
  todayInIST,
  unitsForInstallment,
} from "@compass/shared";
import type { AccountType, AssetClass, GainsTaxClass, SipFrequency, SipFundingSource, SipTargetKind } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { accounts, holdingEvents, holdings, sips, transactions } from "../db/schema.ts";
import { HttpError, pgError } from "../lib/errors.ts";
import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "./goal-allocation.ts";
import { nextSeqForDate } from "./holdings.ts";
import { assertOwnedGoal } from "./ownership.ts";

type SipRow = typeof sips.$inferSelect;

function toSip(s: SipRow, lastInstallmentDate: string | null, today: string = todayInIST()): Sip {
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
 * count as a recorded installment (see services/balances.ts).
 */
async function lastInstallmentDateFor(db: DbOrTx, sipId: string): Promise<string | null> {
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

async function ownedSip(db: Db, userId: string, id: string): Promise<SipRow> {
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

// ---------- Recording an actual installment ----------

/**
 * Whether an installment date falls within the SIP's life — before its start,
 * or after an endDate if one is set. ISO dates (`YYYY-MM-DD`) compare
 * correctly as plain strings, so no Date parsing is needed. Pure so it's
 * unit-testable without a DB.
 */
export function installmentDateError(sip: { startDate: string; endDate: string | null }, date: string): string | null {
  if (date < sip.startDate) return "Installment date is before the SIP started";
  if (sip.endDate !== null && date > sip.endDate) return "Installment date is after the SIP ended";
  return null;
}

/**
 * Why this SIP can't record an installment by linking a ledger transaction, as
 * a status+message to throw, or null when it can. Split out of
 * `linkInstallmentIssue` so the candidate listing can apply exactly the same
 * two SIP-level gates without having to invent a transaction to test against.
 * Pure so both gates are unit-testable without a DB.
 */
export function accountInstallmentSipIssue(sip: {
  targetKind: SipTargetKind;
  fundingSource: SipFundingSource;
}): { status: number; message: string } | null {
  if (sip.targetKind !== "account") {
    return { status: 400, message: "Only an account-target SIP records by linking a ledger transaction" };
  }
  if (sip.fundingSource === "payroll") {
    return { status: 400, message: "A payroll-funded SIP is recorded from your payslip, not manually" };
  }
  return null;
}

/**
 * Whether an existing ledger transaction can stand as this SIP's installment —
 * a status+message to throw, or null when it can. Pure so every rule is
 * unit-testable without a DB, and ordered deliberately: the SIP-level gates
 * first (a wrong-kind SIP makes every later question meaningless), then the
 * row's identity, then its existing link, then the date window.
 *
 * The row must be a *credit into the SIP's own target account*: the outgoing
 * leg of the same transfer is negative and sits in the source account, so the
 * sign check is what keeps the debit side from being mistaken for the deposit.
 * An opening-balance row is excluded because it is a reconciliation seed, not
 * money that moved. A row already linked to *another* SIP is a 409 rather than
 * a 400 — nothing about the request is malformed, it just lost a race for a
 * transaction that is now spoken for. Amount is deliberately *not* checked
 * against `sip.amountPaise`: a real PPF/SSY deposit routinely differs from the
 * plan, exactly as `recordSipInstallment` lets the MF amount be overridden.
 */
export function linkInstallmentIssue(
  sip: {
    id: string;
    targetKind: SipTargetKind;
    targetAccountId: string | null;
    fundingSource: SipFundingSource;
    startDate: string;
    endDate: string | null;
  },
  tx: { accountId: string; amountPaise: number; date: string; isOpening: boolean; sipId: string | null },
): { status: number; message: string } | null {
  const sipIssue = accountInstallmentSipIssue(sip);
  if (sipIssue) return sipIssue;
  if (tx.accountId !== sip.targetAccountId) {
    return { status: 400, message: "That transaction isn't in this SIP's target account" };
  }
  if (tx.isOpening) {
    return { status: 400, message: "An opening-balance entry can't be a SIP installment" };
  }
  if (tx.amountPaise <= 0) {
    return { status: 400, message: "A SIP installment must be money arriving in the target account" };
  }
  if (tx.sipId !== null && tx.sipId !== sip.id) {
    return { status: 409, message: "That transaction is already linked to another SIP's installment" };
  }
  const dateError = installmentDateError(sip, tx.date);
  if (dateError) return { status: 400, message: dateError };
  return null;
}

/**
 * The inclusive date window a linkable transaction must fall in: no earlier
 * than the SIP's start, no later than the `asOf` day the user is recording
 * against — clamped to `endDate` once the SIP has ended, so an ended SIP stops
 * offering deposits it could never have funded (the same clamp
 * `lastOccurrenceOnOrBefore` applies to `today`). An `asOf` before `startDate`
 * yields an empty window (`to < from`), which the query simply returns nothing
 * for. Pure so the clamp is testable without a DB.
 */
export function candidateDateBounds(
  sip: { startDate: string; endDate: string | null },
  asOf: string,
): { from: string; to: string } {
  const to = sip.endDate !== null && asOf > sip.endDate ? sip.endDate : asOf;
  return { from: sip.startDate, to };
}

/** Most ledger candidates offered for one account-target installment link. */
const INSTALLMENT_CANDIDATE_LIMIT = 20;

/**
 * Books an actual buy against a SIP's target folio when an installment goes
 * through — the amount/units/NAV the platform actually allotted, not the
 * SIP's own plan. Deliberately does not create a ledger `transactions` row;
 * the SIP's bank-side debit and this fund-side buy are tracked independently.
 */
export async function recordSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  input: RecordSipInstallment,
): Promise<HoldingEvent> {
  const parsed = RecordSipInstallmentSchema.parse(input);

  // Everything from the SIP read through the insert runs inside one
  // transaction with the holding and SIP rows locked FOR UPDATE, in that
  // order: the holding is locked before the sips row to match
  // createSip/updateSip's parent-first convention (they lock the referenced
  // account/holding before touching the sips row) — locking sips first here
  // would invert that order and risk a deadlock against a concurrent
  // updateSip on the same SIP. Since we don't know which holding to lock
  // until we've read the SIP, we take an unlocked probe read first, lock the
  // holding, then re-read the SIP under its own lock and confirm its target
  // didn't move in between (a concurrent updateSip could have repointed it).
  // Computing `seq` inside the same locks also stops two concurrent same-day
  // recordings from both computing the same intra-day sequence.
  return db.transaction(async (tx) => {
    // Unlocked probe: we only need it to learn which holding to lock. The
    // authoritative read is the locked one below. Reading it unlocked first is
    // what lets us take the two locks in the same order the rest of this file
    // does — createSip/updateSip both lock the referenced account/holding
    // before touching the sips row, so locking sips first here would invert
    // the order and let a recorder and a concurrent updateSip deadlock.
    const probeRows = await tx
      .select({ targetKind: sips.targetKind, targetHoldingId: sips.targetHoldingId })
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)));
    const probe = probeRows[0];
    if (!probe) throw new HttpError(404, "SIP not found");

    // An account-target SIP (PPF/SSY) has no folio to allot units into — only an
    // mf_folio SIP can book a fund transaction.
    if (probe.targetKind !== "mf_folio") {
      throw new HttpError(400, "Only an MF-folio SIP can record a fund transaction");
    }

    const holdingRows = await tx
      .select({ archivedAt: holdings.archivedAt })
      .from(holdings)
      .where(and(eq(holdings.id, probe.targetHoldingId!), eq(holdings.userId, userId)))
      .for("update");
    const holding = holdingRows[0];
    if (!holding) throw new HttpError(404, "Holding not found");
    if (isArchived(holding.archivedAt)) throw new HttpError(400, "Target holding is archived");

    // Now the SIP itself, locked — and re-checked, because the probe above was
    // unlocked: a concurrent updateSip could have repointed the SIP at another
    // folio in between, which would otherwise book the buy against the holding
    // we just locked rather than the SIP's real current target.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");
    if (sip.targetKind !== "mf_folio" || sip.targetHoldingId !== probe.targetHoldingId) {
      throw new HttpError(409, "The SIP's target folio just changed — refresh and retry");
    }
    // Defence in depth: createSip/updateSip already reject a payroll-funded
    // mf_folio SIP (see sipFundingSourceIssue), so this should be unreachable —
    // but a SIP row created before that constraint existed could still carry
    // this combination, and a payroll SIP's installment is booked automatically
    // from the payslip, never by hand. Read from the locked `sip` row, not the
    // unlocked `probe`, since a concurrent updateSip could have changed
    // `fundingSource` in between.
    if (sip.fundingSource === "payroll") {
      throw new HttpError(400, "A payroll-funded SIP is recorded from your payslip, not manually");
    }

    const dateError = installmentDateError(sip, parsed.date);
    if (dateError) throw new HttpError(400, dateError);

    const amountPaise = parsed.amountPaise ?? sip.amountPaise;
    const units = parsed.units ?? unitsForInstallment(amountPaise, parsed.nav!);

    const seq = await nextSeqForDate(tx, sip.targetHoldingId!, parsed.date);

    try {
      const rows = await tx
        .insert(holdingEvents)
        .values({
          holdingId: sip.targetHoldingId!,
          type: "buy",
          date: parsed.date,
          amountPaise,
          units,
          note: parsed.note,
          seq,
          // Not "import": mf-import.ts's reconcileEvents only ever re-sequences
          // *imported* events on a CAS re-import, so marking this event "manual"
          // keeps a recorded SIP installment safe from being resequenced or
          // dropped by a later statement import (see the test "an import never
          // rewrites a user's manual same-day order").
          source: "manual",
          sipId,
        })
        .returning();
      const e = rows[0]!;
      return { id: e.id, type: e.type, date: e.date, amountPaise: e.amountPaise, units: e.units, note: e.note };
    } catch (err) {
      if (isUniqueViolation(err, "holding_events_sip_date_idx")) {
        throw new HttpError(409, "This SIP installment is already recorded for that date");
      }
      // 23503 = FK violation: the SIP or its holding was deleted between our
      // locked read and the insert (a delete that was already in flight).
      if (pgError(err)?.code === "23503") {
        throw new HttpError(409, "The SIP or its folio was just removed — refresh and retry");
      }
      throw err;
    }
  });
}

// ---------- Linking a ledger transaction as an account-target installment ----------

/**
 * Records an account-target (PPF/SSY) installment by stamping `sip_id` onto a
 * ledger transaction the user already has — the mirror of
 * `recordSipInstallment`, which instead *creates* a `holding_events` buy for an
 * MF folio. Nothing about the transaction's money changes: the deposit was
 * already in the ledger and already in the account's balance, so this only
 * records *which* installment it satisfied. Returns the refreshed SIP so the
 * caller immediately sees `lastInstallmentDate`/`dueInstallmentDate` move.
 */
export async function linkSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  input: LinkSipInstallment,
): Promise<Sip> {
  const parsed = LinkSipInstallmentSchema.parse(input);

  return db.transaction(async (tx) => {
    // Lock order is the sips row first, the transaction row second — the same
    // direction `deleteSip` already travels: deleting a SIP locks it and then,
    // through `transactions.sip_id`'s ON DELETE SET NULL, updates (and so locks)
    // every transaction referencing it. Locking the transaction first would form
    // the opposite edge, and a delete racing an unlink of the same pair would
    // deadlock outright — the unlinker holding the transaction and waiting for
    // the SIP, the deleter holding the SIP and waiting for the transaction.
    // Nothing else in this file locks a transaction row at all, so this path only
    // has to respect parent-before-child; it never contends with the
    // account/holding-before-sips order createSip/updateSip/recordSipInstallment
    // use, because those never touch transactions.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");

    const txRows = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amountPaise: transactions.amountPaise,
        date: transactions.date,
        isOpening: transactions.isOpening,
        sipId: transactions.sipId,
        deletedAt: transactions.deletedAt,
      })
      .from(transactions)
      .where(and(eq(transactions.id, parsed.transactionId), eq(transactions.userId, userId)))
      .for("update");
    const ledgerTx = txRows[0];
    // A soft-deleted row is 404, not 400: it is not part of the ledger the user
    // can see, so "not found" is the honest answer — and linking it would stamp
    // an installment that every installment query filters straight back out.
    if (!ledgerTx || ledgerTx.deletedAt !== null) throw new HttpError(404, "Transaction not found");

    const issue = linkInstallmentIssue(sip, ledgerTx);
    if (issue) throw new HttpError(issue.status, issue.message);

    // Idempotent: re-linking the transaction this SIP already points at reports
    // the same success rather than the (sip, date) unique index's 409, so a
    // double-click or a retried request isn't punished.
    if (ledgerTx.sipId === sip.id) {
      return toSip(sip, await lastInstallmentDateFor(tx, sipId));
    }

    try {
      const rows = await tx
        .update(transactions)
        .set({ sipId, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.id, ledgerTx.id),
            eq(transactions.userId, userId),
            isNull(transactions.sipId),
          ),
        )
        .returning({ id: transactions.id });
      // Unreachable while this row's FOR UPDATE lock is held — kept because the
      // conditional WHERE makes "we only ever claim an unclaimed row" true
      // independently of the lock, the same way linkTargetToGoal does.
      if (rows.length === 0) {
        throw new HttpError(409, "That transaction was just linked elsewhere — refresh and retry");
      }
    } catch (err) {
      if (isUniqueViolation(err, "transactions_sip_date_idx")) {
        throw new HttpError(409, "This SIP installment is already recorded for that date");
      }
      // 23503 = FK violation: the SIP was deleted between our locked read and
      // the update (a delete that was already in flight).
      if (pgError(err)?.code === "23503") {
        throw new HttpError(409, "The SIP was just removed — refresh and retry");
      }
      throw err;
    }
    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
  });
}

/**
 * Detaches a wrongly-linked installment: clears `sip_id` and leaves the ledger
 * transaction itself completely untouched. Without this a mislink could only be
 * undone by deleting a real transaction, because the (sip, date) unique index
 * blocks linking a different row for the same date.
 */
export async function unlinkSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  transactionId: string,
): Promise<Sip> {
  return db.transaction(async (tx) => {
    // Same sips-before-transaction order as linkSipInstallment, and for the
    // same reason — see there. `deletedAt` is deliberately not checked here — a
    // soft-deleted row already counts for nothing (see lastInstallmentDateFor),
    // so letting its stale link be cleared is pure cleanup.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");

    const txRows = await tx
      .select({ id: transactions.id, sipId: transactions.sipId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for("update");
    const ledgerTx = txRows[0];
    if (!ledgerTx) throw new HttpError(404, "Transaction not found");
    if (ledgerTx.sipId !== sipId) throw new HttpError(404, "That transaction isn't linked to this SIP");

    await tx
      .update(transactions)
      .set({ sipId: null, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.id, ledgerTx.id),
          eq(transactions.userId, userId),
          eq(transactions.sipId, sipId),
        ),
      );
    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
  });
}

/**
 * The most recent ledger rows this SIP has already claimed as installments.
 *
 * Deliberately exempt from the *eligibility* rules `unlinkedInstallmentRows`
 * applies — account, sign, opening-row and date window are all ignored here. A
 * row that is already linked must stay visible even if a later edit moved it to
 * another account, flipped its sign, or pushed it outside the SIP's date window:
 * `updateTransaction` leaves `sip_id` in place through all of those (it only
 * rejects the one edit that would collide on the (sip, date) index). Filtering
 * these the same way as free rows would hide exactly the rows a user has reason
 * to detach, leaving no recovery path at all.
 *
 * Still bounded by `INSTALLMENT_CANDIDATE_LIMIT`, though — this is a picker, not
 * an installment history. Ordering is most-recent-first, so what a long-running
 * SIP eventually drops off the end is its oldest installments, while a mislink
 * needing attention is by nature recent. Soft-deleted rows are excluded outright:
 * they already count for nothing (see `lastInstallmentDateFor`), so there is
 * nothing to detach.
 */
async function linkedInstallmentRows(
  db: Db,
  userId: string,
  sipId: string,
): Promise<Array<{ id: string; date: string; amountPaise: number; merchant: string; notes: string }>> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountPaise: transactions.amountPaise,
      merchant: transactions.merchant,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.sipId, sipId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(INSTALLMENT_CANDIDATE_LIMIT);
}

/**
 * The free ledger rows that could become this SIP's next installment: credits
 * into its target account, inside the SIP's own date window, not yet claimed by
 * any SIP. These are the rows `linkInstallmentIssue` will accept, so the filters
 * here and its rules must stay in step — anything offered that it would reject
 * is an input guaranteed to 400.
 */
async function unlinkedInstallmentRows(
  db: Db,
  userId: string,
  accountId: string,
  bounds: { from: string; to: string },
): Promise<Array<{ id: string; date: string; amountPaise: number; merchant: string; notes: string }>> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountPaise: transactions.amountPaise,
      merchant: transactions.merchant,
      notes: transactions.notes,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        isNull(transactions.sipId),
        eq(transactions.isOpening, false),
        gt(transactions.amountPaise, 0),
        gte(transactions.date, bounds.from),
        lte(transactions.date, bounds.to),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(INSTALLMENT_CANDIDATE_LIMIT);
}

/**
 * The ledger transactions that could be this SIP's installment as of `asOf`:
 * unlinked credits into its target account plus the most recent of the ones
 * this SIP already linked — the linked rows are exempt from the `asOf` window
 * and the eligibility filters, because their only purpose in the response is to
 * be detachable (see `linkedInstallmentRows`). Response contract: linked rows
 * first, then unlinked, each most-recent-first. Kept server-side rather than
 * left to a client filter over `/api/transactions` because `sip_id` is not
 * part of the transaction API at all — the browser has no way to tell an
 * already-linked deposit from a free one.
 */
export async function listSipInstallmentCandidates(
  db: Db,
  userId: string,
  sipId: string,
  asOf: string,
): Promise<SipInstallmentCandidate[]> {
  const sip = await ownedSip(db, userId, sipId);
  const issue = accountInstallmentSipIssue(sip);
  if (issue) throw new HttpError(issue.status, issue.message);

  // Two budgeted queries rather than one ORed query under a single LIMIT: a run
  // of recent unlinked credits would otherwise crowd this SIP's own older linked
  // installment off the end, and an installment that can't be listed can't be
  // unlinked — so the row that a mislink must be detached from would be exactly
  // the one to disappear. Each group gets its own budget instead. Only the
  // unlinked side is bounded by `asOf`/the eligibility filters — the linked side
  // is exempt from those but still shares the same per-group recency budget (see
  // its doc comment). `linked` comes from which query produced the row, so the
  // raw `sip_id` never has to be selected, let alone returned.
  const [linked, unlinked] = await Promise.all([
    linkedInstallmentRows(db, userId, sipId),
    unlinkedInstallmentRows(db, userId, sip.targetAccountId!, candidateDateBounds(sip, asOf)),
  ]);
  return [
    ...linked.map((row) => ({ ...row, linked: true })),
    ...unlinked.map((row) => ({ ...row, linked: false })),
  ];
}

// ---------- Committed monthly (goal-plan gap) ----------

export interface ClassifiableSip {
  amountPaise: number;
  /** defaults to "monthly" when omitted, so existing call sites need not change. */
  frequency?: SipFrequency;
  allocationClass: GoalAllocationClass;
}

/**
 * A SIP's contribution monthlyized for the goal plan's ₹/mo comparison: a
 * quarterly deposit counts a third each month, a yearly one a twelfth — so a
 * lumpy PPF/SSY contribution still compares fairly against a monthly MF SIP.
 */
export function monthlyEquivalentPaise(amountPaise: number, frequency: SipFrequency): number {
  if (frequency === "quarterly") return Math.round(amountPaise / 3);
  if (frequency === "yearly") return Math.round(amountPaise / 12);
  return amountPaise;
}

/** Sum a set of already-classified SIPs into the equity/debt legs a goal plan compares against. */
export function committedSplit(
  sips: ClassifiableSip[],
): { committedEquityPaise: number; committedDebtPaise: number } {
  let equity = 0;
  let debt = 0;
  for (const s of sips) {
    const monthly = monthlyEquivalentPaise(s.amountPaise, s.frequency ?? "monthly");
    if (s.allocationClass === "equity") equity += monthly;
    else if (s.allocationClass === "debt") debt += monthly;
    // "other" targets (shouldn't happen for a SIP target, but stay defensive) don't count.
  }
  return { committedEquityPaise: equity, committedDebtPaise: debt };
}

/** Classify one SIP's target the same way the goal-plan reports current holdings/accounts. */
export function classifySipTarget(sip: {
  targetKind: "mf_folio" | "account";
  holding: { assetClass: AssetClass; gainsTaxClass: GainsTaxClass } | null;
  account: { type: AccountType } | null;
}): GoalAllocationClass {
  if (sip.targetKind === "mf_folio") {
    return sip.holding ? holdingAllocationClass(sip.holding.assetClass, sip.holding.gainsTaxClass) : "other";
  }
  return sip.account ? accountAllocationClass(sip.account.type) : "other";
}

/**
 * Committed equity/debt paise-per-month for a goal's *active* SIPs — the basis
 * for the goal plan's gap. Joins each SIP's target so classification matches
 * exactly how the plan classifies mapped assets (holdingAllocationClass /
 * accountAllocationClass).
 */
export async function committedForGoal(
  db: Db,
  userId: string,
  goalId: string,
): Promise<{ committedEquityPaise: number; committedDebtPaise: number }> {
  const rows = await db
    .select({
      amountPaise: sips.amountPaise,
      frequency: sips.frequency,
      targetKind: sips.targetKind,
      holdingAssetClass: holdings.assetClass,
      holdingGainsTaxClass: holdings.gainsTaxClass,
      accountType: accounts.type,
    })
    .from(sips)
    .leftJoin(holdings, eq(holdings.id, sips.targetHoldingId))
    .leftJoin(accounts, eq(accounts.id, sips.targetAccountId))
    .where(and(eq(sips.userId, userId), eq(sips.goalId, goalId), eq(sips.status, "active")));

  const classified: ClassifiableSip[] = rows.map((r) => ({
    amountPaise: r.amountPaise,
    frequency: r.frequency,
    allocationClass: classifySipTarget({
      targetKind: r.targetKind,
      holding:
        r.holdingAssetClass && r.holdingGainsTaxClass
          ? { assetClass: r.holdingAssetClass, gainsTaxClass: r.holdingGainsTaxClass }
          : null,
      account: r.accountType ? { type: r.accountType } : null,
    }),
  }));
  return committedSplit(classified);
}

// ---------- Next-occurrence / cash-flow ----------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Number of months between occurrences at each cadence. */
const FREQUENCY_STEP_MONTHS: Record<SipFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Whole-month index (year*12 + zero-based month) — lets month arithmetic be plain integer math. */
function monthIndex(iso: string): number {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
}

function dateFromMonthIndex(idx: number, day: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${pad(m)}-${pad(day)}`;
}

/**
 * First date with the given day-of-month (1–28) on or after `ref` (inclusive)
 * whose month falls on the SIP's cadence — monthly (every month), quarterly
 * (every 3rd month) or yearly (every 12th month) — **anchored to
 * `anchorDate`'s month** (typically the SIP's `startDate`): a quarterly SIP
 * started in March occurs in March/June/September/December, not
 * January/April/July/October. `frequency`/`anchorDate` default to a plain
 * monthly occurrence, so existing 2-arg callers are unaffected.
 */
export function firstOccurrenceOnOrAfter(
  ref: string,
  day: number,
  frequency: SipFrequency = "monthly",
  anchorDate: string = ref,
): string {
  const step = FREQUENCY_STEP_MONTHS[frequency];
  const [, , d] = ref.split("-").map(Number) as [number, number, number];
  let candidateIdx = monthIndex(ref);
  if (d > day) candidateIdx += 1; // day-of-month already passed this month
  if (step > 1) {
    const anchorIdx = monthIndex(anchorDate);
    let offset = (candidateIdx - anchorIdx) % step;
    if (offset < 0) offset += step;
    if (offset !== 0) candidateIdx += step - offset;
  }
  return dateFromMonthIndex(candidateIdx, day);
}

/**
 * The mirror image of `firstOccurrenceOnOrAfter`: the most recent date with
 * the given day-of-month on or before `ref` (inclusive), on the SIP's cadence,
 * anchored the same way to `startDate`'s month. Used to answer "what
 * installment is due by now" rather than "what's coming up next". The
 * reference date is clamped to `endDate` when `today` is past it — once a SIP
 * has ended, its last occurrence is bounded by when it stopped, not by
 * whatever `today` happens to be (otherwise a long-ended SIP would keep
 * reporting today's own day-of-month as "due" forever).
 */
export function lastOccurrenceOnOrBefore(
  sip: { dayOfMonth: number; startDate: string; endDate: string | null; frequency?: SipFrequency },
  today: string,
): string | null {
  const ref = sip.endDate !== null && today > sip.endDate ? sip.endDate : today;
  const step = FREQUENCY_STEP_MONTHS[sip.frequency ?? "monthly"];
  const [, , d] = ref.split("-").map(Number) as [number, number, number];
  let candidateIdx = monthIndex(ref);
  if (d < sip.dayOfMonth) candidateIdx -= 1; // this month's occurrence hasn't happened yet
  if (step > 1) {
    const anchorIdx = monthIndex(sip.startDate);
    const offset = (((candidateIdx - anchorIdx) % step) + step) % step;
    candidateIdx -= offset;
  }
  const date = dateFromMonthIndex(candidateIdx, sip.dayOfMonth);
  if (date < sip.startDate) return null; // the SIP hadn't started yet
  return date;
}

/**
 * The first calendar day of the occurrence month that produced `due` (a
 * return value of lastOccurrenceOnOrBefore). due's own day is always
 * sip.dayOfMonth, but the cadence cycle it represents is the half-open
 * interval from the 1st of this month through the day before the next
 * aligned occurrence — lastOccurrenceOnOrBefore's step-alignment already
 * guarantees due's month is the first month of that interval for every
 * cadence, so no frequency/anchor input is needed here, only due's month.
 */
function occurrenceMonthStart(due: string): string {
  return dateFromMonthIndex(monthIndex(due), 1);
}

/**
 * The installment a user still owes a record for: the most recent due
 * occurrence, unless one has already been recorded anywhere in that
 * occurrence's cadence cycle. Null when nothing is outstanding. Paused SIPs
 * never prompt — but the user can still backfill one by hand.
 *
 * Tolerates an early deposit: the cycle a `due` occurrence belongs to is the
 * half-open interval from the 1st of `due`'s own month through the day
 * before the next aligned occurrence (one calendar month for monthly, the
 * full 3-/12-month block for quarterly/yearly). Any `lastInstallmentDate`
 * within that interval satisfies it, not only one on or after `due`'s exact
 * day-of-month — e.g. a PPF SIP with `dayOfMonth: 5` that the user always
 * actually funds on the 1st clears its due flag on the 1st, rather than
 * prompting again the moment `today` reaches the 5th. An installment from a
 * strictly earlier cycle does not satisfy it — the due occurrence is still
 * reported.
 *
 * Gated on `fundingSource`, not `targetKind`: an account-target SIP (PPF/SSY)
 * *does* prompt, because it can now record by linking the ledger transaction
 * that funded it (see `linkSipInstallment`). What must never prompt is a
 * `payroll` SIP — its contribution reaches the ledger through
 * `createPayslip`'s bank→retirement transfer, which stamps no `sip_id`, so it
 * would otherwise report the same installment as due forever.
 */
export function dueInstallmentDate(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
    fundingSource: SipFundingSource;
  },
  lastInstallmentDate: string | null,
  today: string,
): string | null {
  if (sip.status !== "active") return null;
  if (sip.fundingSource === "payroll") return null;
  const due = lastOccurrenceOnOrBefore(sip, today);
  if (due === null) return null;
  if (lastInstallmentDate !== null && lastInstallmentDate >= occurrenceMonthStart(due)) return null;
  return due;
}

/**
 * Next debit date for an active SIP on or after `today` — the first
 * cadence-aligned occurrence of `dayOfMonth` (anchored to `startDate`'s month)
 * no earlier than both `today` and `startDate`, or null if the SIP is paused
 * or has already ended by then.
 */
export function nextSipDate(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
  },
  today: string,
): string | null {
  if (sip.status !== "active") return null;
  const base = sip.startDate > today ? sip.startDate : today;
  const due = firstOccurrenceOnOrAfter(base, sip.dayOfMonth, sip.frequency ?? "monthly", sip.startDate);
  if (sip.endDate !== null && due > sip.endDate) return null;
  return due;
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Every SIP occurrence from `today` through `horizon` (inclusive), stepping at
 * the SIP's cadence from the first due date (a quarterly/yearly SIP whose next
 * anchored month falls outside a 90-day window contributes zero occurrences).
 * Mirrors how getForecast walks a recurring template's occurrences into its
 * obligations window.
 */
export function sipOccurrencesInWindow(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
  },
  today: string,
  horizon: string,
): string[] {
  const dates: string[] = [];
  let due = nextSipDate(sip, today);
  while (due !== null && due <= horizon) {
    dates.push(due);
    // Step to the next occurrence: the first cadence-aligned day-of-month strictly after this one.
    const next = firstOccurrenceOnOrAfter(dayAfter(due), sip.dayOfMonth, sip.frequency ?? "monthly", sip.startDate);
    due = sip.endDate !== null && next > sip.endDate ? null : next > horizon ? null : next;
  }
  return dates;
}
