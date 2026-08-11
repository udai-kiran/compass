import { and, eq, isNull, or, sql } from "drizzle-orm";
import type {
  Account,
  AccountWithBalance,
  CreateAccount,
  UpdateAccount,
} from "@compass/shared";
import { accountCanHaveGoal, isBankAccount, type AccountType } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts, postings, transactions } from "../schema.ts";
import { bankDetails, retirementDetails, sips } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedGoal } from "../../../lib/ownership.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";
import { postTransaction, resolveSystemAccounts } from "./post-entry.ts";
import { buildOpeningPostings } from "./postings.ts";

/** Only these carry their opening balance as a ledger transaction; other types
 * (cards/loans/schemes) keep it on the accounts.opening_balance_paise column,
 * which their statement/valuation logic reads directly. */
function carriesOpeningAsTransaction(type: AccountType): boolean {
  return type === "bank" || type === "cash";
}

function seedsOpeningTransaction(type: AccountType, openingBalancePaise: number): boolean {
  return carriesOpeningAsTransaction(type) && openingBalancePaise !== 0;
}

/**
 * The "Opening balance" ledger row for a bank/cash account's starting balance —
 * a real, dated transaction so the account ledger reconciles (rather than a
 * balance appearing from a hidden column). Pure/DB-free for testability; returns
 * null when the account type or amount warrants no seed row. Flagged `isOpening`
 * so it is excluded from income/expense/spend like a transfer.
 */
export function openingBalanceRow(
  input: { userId: string; accountId: string; type: AccountType; openingBalancePaise: number; date: string },
): typeof transactions.$inferInsert | null {
  if (!seedsOpeningTransaction(input.type, input.openingBalancePaise)) return null;
  return {
    userId: input.userId,
    accountId: input.accountId,
    date: input.date,
    amountPaise: input.openingBalancePaise,
    merchant: "Opening balance",
    isOpening: true,
  };
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** What to do with an account's "Opening balance" ledger row when the opening balance is corrected. */
export type OpeningBalanceTxnAction =
  | { kind: "none" }
  | { kind: "insert"; amountPaise: number; date: string }
  | { kind: "update"; id: string; amountPaise: number }
  | { kind: "delete"; id: string };

export type OpeningBalancePlan = {
  /** what accounts.opening_balance_paise must become */
  columnPaise: number;
  txn: OpeningBalanceTxnAction;
};

/**
 * Correcting an opening balance has to preserve the invariant createAccount sets
 * up, because every balance is `opening_balance_paise + Σtx`: a bank/cash account
 * keeps the amount in its `is_opening` transaction with the column pinned at 0,
 * and every other type keeps it on the column with no such row. Writing both
 * would double-count. Pure/DB-free so the rule is testable without a database.
 *
 * A leftover opening row on a type that no longer carries one (a bank later
 * switched to a card, say) is removed, so the amount can never be counted twice.
 * A newly inserted row is dated before the account's earliest activity — an
 * opening balance that sorts after a spend would misreport every historical
 * balance in between.
 */
export function planOpeningBalanceChange(input: {
  type: AccountType;
  requestedPaise: number;
  existing: { id: string; amountPaise: number } | null;
  earliestTxnDate: string | null;
  today: string;
}): OpeningBalancePlan {
  const { type, requestedPaise, existing, earliestTxnDate, today } = input;

  if (!carriesOpeningAsTransaction(type)) {
    return {
      columnPaise: requestedPaise,
      txn: existing ? { kind: "delete", id: existing.id } : { kind: "none" },
    };
  }
  if (requestedPaise === 0) {
    return { columnPaise: 0, txn: existing ? { kind: "delete", id: existing.id } : { kind: "none" } };
  }
  if (existing) {
    return {
      columnPaise: 0,
      txn:
        existing.amountPaise === requestedPaise
          ? { kind: "none" }
          : { kind: "update", id: existing.id, amountPaise: requestedPaise },
    };
  }
  return {
    columnPaise: 0,
    txn: {
      kind: "insert",
      amountPaise: requestedPaise,
      date: earliestTxnDate ? dayBefore(earliestTxnDate) : today,
    },
  };
}

/**
 * The opening balance to reconcile toward. An explicit request wins; otherwise
 * this is a type change carrying the existing amount across, so take it from
 * wherever the old type kept it — the ledger row for bank/cash, the column for
 * everything else — and let planOpeningBalanceChange move it to the new type's
 * home. Reading the row first matters: a carrier type pins its column at 0, so
 * trusting the column would silently zero the balance on every bank -> card change.
 */
export function openingBalanceToReconcile(input: {
  requestedPaise: number | undefined;
  existingRowPaise: number | null;
  columnPaise: number;
}): number {
  if (input.requestedPaise !== undefined) return input.requestedPaise;
  return input.existingRowPaise ?? input.columnPaise;
}

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: assertPublicAccountType(row.type),
    institution: row.institution,
    accountLast4: row.accountLast4,
    holderName: row.holderName,
    upiIds: row.upiIds,
    currency: row.currency,
    openingBalancePaise: row.openingBalancePaise,
    goalId: row.goalId,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export interface AccountBalanceAtDate {
  type: AccountType;
  balancePaise: number;
}

export async function accountBalancesAtDate(
  db: Db,
  userId: string,
  asOf: string,
): Promise<AccountBalanceAtDate[]> {
  const res = await db.execute(sql`
    select a.type,
           a.opening_balance_paise as opening,
           coalesce(p.total, 0) as posting_total
    from accounts a
    left join (
      select po.account_id, sum(po.amount_paise) as total
      from postings po
      join transactions t on t.id = po.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${asOf}
      group by po.account_id
    ) p on p.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null and a.system_kind is null
  `);
  return (
    res.rows as Array<{ type: string; opening: string; posting_total: string }>
  ).map((r) => {
    const postingTotal = Number(r.posting_total);
    if (!Number.isSafeInteger(postingTotal)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const balancePaise = Number(r.opening) + postingTotal;
    if (!Number.isSafeInteger(balancePaise)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    return { type: assertPublicAccountType(r.type), balancePaise };
  });
}

export async function listAccounts(db: Db, userId: string): Promise<AccountWithBalance[]> {
  const rows = await db
    .select({
      account: accounts,
      // Current balance is posted, not projected: a future-dated transaction
      // must not move it. computeNetWorth applies the same date <= today cut, so
      // the account list and net worth can never disagree about what's posted.
      // The date/deleted/userId predicates live inside the aggregate FILTER (not
      // the outer WHERE) so the left join doesn't collapse zero-activity accounts.
      postingSum: sql<number>`coalesce(sum(${postings.amountPaise}) filter (where ${transactions.deletedAt} is null and ${transactions.date} <= current_date and ${transactions.userId} = ${userId}), 0)::bigint`,
      subtype: bankDetails.subtype,
    })
    .from(accounts)
    .leftJoin(postings, eq(postings.accountId, accounts.id))
    .leftJoin(transactions, eq(transactions.id, postings.transactionId))
    .leftJoin(bankDetails, eq(bankDetails.accountId, accounts.id))
    .where(and(eq(accounts.userId, userId), isNull(accounts.systemKind)))
    .groupBy(accounts.id, bankDetails.subtype)
    .orderBy(accounts.sortOrder, accounts.createdAt);
  return rows.map(({ account, postingSum, subtype }) => {
    const sum = Number(postingSum);
    if (!Number.isSafeInteger(sum)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const balancePaise = account.openingBalancePaise + sum;
    if (!Number.isSafeInteger(balancePaise)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    return {
      ...toAccount(account),
      balancePaise,
      subtype: subtype ?? null,
    };
  });
}

export async function createAccount(
  db: Db,
  userId: string,
  input: CreateAccount,
): Promise<Account> {
  // For bank/cash we move the opening balance into a real "Opening balance"
  // transaction and hold the column at 0, so the ledger reconciles and no
  // surface double-counts (every balance is column + Σtx = 0 + Σtx).
  const seedOpening = seedsOpeningTransaction(input.type, input.openingBalancePaise);
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(accounts)
      .values({ ...input, userId, ...(seedOpening ? { openingBalancePaise: 0 } : {}) })
      .returning();
    const account = rows[0]!;
    if (seedOpening) {
      const row = openingBalanceRow({
        userId,
        accountId: account.id,
        type: input.type,
        openingBalancePaise: input.openingBalancePaise,
        date: new Date().toISOString().slice(0, 10),
      });
      if (row) {
        const [openingTxn] = await tx.insert(transactions).values(row).returning({ id: transactions.id });
        const sys = await resolveSystemAccounts(tx, userId);
        await postTransaction(
          tx,
          openingTxn!.id,
          userId,
          buildOpeningPostings({
            accountId: account.id,
            amountPaise: input.openingBalancePaise,
            systemOpeningAccountId: sys.opening,
          }),
        );
      }
    }
    return toAccount(account);
  });
}

/** Last 4 of a full account number; null when there aren't enough digits to take. */
export function last4Of(accountNumber: string): string | null {
  return accountNumber.length >= 4 ? accountNumber.slice(-4) : null;
}

/**
 * Keeps accounts.account_last4 equal to the tail of the full number. Called on
 * every bank-details write so the list can never show ••••3510 for an account
 * ending 7754. Clearing the number releases last4 back to manual entry.
 */
export async function syncAccountLast4(
  db: Db,
  userId: string,
  accountId: string,
  accountNumber: string,
): Promise<void> {
  if (accountNumber === "") return;
  await db
    .update(accounts)
    .set({ accountLast4: last4Of(accountNumber), updatedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}

/** Message for the "account is a SIP target, and its goal earmark would change" edit guard. */
export function sipTargetGoalBlockedMessage(count: number): string {
  return `Account is the target of ${count} SIP(s) for a goal — delete or repoint them first`;
}

/** Message for the "account is a SIP target, and its type would stop being goal-eligible" edit guard. */
export function sipTargetTypeBlockedMessage(count: number): string {
  return `Account is the target of ${count} SIP(s) — delete or repoint them before changing its type`;
}

/** Message for the "account is a SIP target, and would be archived out from under it" guard. */
export function sipTargetArchiveBlockedMessage(count: number): string {
  return `Account is the target of ${count} SIP(s) — delete or repoint them before archiving`;
}

/**
 * Whether an UpdateAccount patch would break a SIP that references this
 * account (as its target or its source). Pure/DB-free so the guard is
 * unit-testable: `undefined` fields mean "not touched" (UpdateAccountSchema
 * partial-patch semantics), and only an actual value change — not a same-value
 * patch or an unrelated field edit — counts as a conflict. Counts include
 * paused SIPs, which resume with their existing bindings. Returns the 409
 * message to throw, or null when the patch is safe.
 */
export function assessAccountEditAgainstSips(
  patch: { type?: AccountType; goalId?: string | null; archived?: boolean },
  current: { type: AccountType; goalId: string | null; archivedAt: Date | string | null },
  refs: { targetSipCount: number; sourceSipCount: number },
): string | null {
  const nextType = patch.type ?? current.type;
  const typeChanged = patch.type !== undefined && patch.type !== current.type;
  // Only a fresh archive (not already archived, and not an unarchive) removes
  // the account from the cash forecast / goal-asset totals it was providing.
  const archiving = patch.archived === true && current.archivedAt === null;

  if (archiving) {
    // An archived source would drop out of the forecast's starting bank+cash
    // balance while its SIP debit kept landing in the forecast; an archived
    // target would drop out of goal-asset totals while the SIP kept counting
    // it as committed (see sips.ts's lockedAccountForSip callers).
    if (refs.targetSipCount > 0) return sipTargetArchiveBlockedMessage(refs.targetSipCount);
    if (refs.sourceSipCount > 0) return sipSourceBlockedMessage(refs.sourceSipCount);
  }

  if (refs.targetSipCount > 0) {
    // A SIP's target earmark must stay pointed at the SIP's own goal — see
    // resolveTargetGoalDecision in sips.ts.
    if (patch.goalId !== undefined && patch.goalId !== current.goalId) {
      return sipTargetGoalBlockedMessage(refs.targetSipCount);
    }
    // A SIP target must remain a goal-eligible investment-scheme type (see
    // assertAccountTargetType in sips.ts) — losing that would recreate a
    // fictional forecast cash outflow / broken goal-funding math.
    if (typeChanged && !accountCanHaveGoal(nextType)) {
      return sipTargetTypeBlockedMessage(refs.targetSipCount);
    }
  }
  // A SIP source must stay a bank account (assertBankSource in sips.ts) — the
  // same invariant the delete guard below protects, just via an edit instead.
  if (refs.sourceSipCount > 0 && typeChanged && !isBankAccount(nextType)) {
    return sipSourceBlockedMessage(refs.sourceSipCount);
  }
  return null;
}

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  input: UpdateAccount,
): Promise<Account> {
  const { archived, openingBalancePaise, ...fields } = input;

  return db.transaction(async (tx) => {
    // Lock the account row first — this is what serializes against a
    // concurrent SIP creation/update targeting the same account (sips.ts's
    // lockedAccountForSip locks the same row before its own checks): whichever
    // transaction commits first is what the other one's guard sees, so the
    // loser can't act on the pre-edit state.
    const currentRows = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .for("update");
    const current = currentRows[0];
    if (!current) throw new HttpError(404, "Account not found");
    // System accounts (Expenses/Income/Opening/Clearing) are internal to the
    // postings model — invisible to account management, including archive
    // (which flows through this function).
    if (current.systemKind !== null) throw new HttpError(404, "Account not found");

    const nextType = assertPublicAccountType(fields.type ?? current.type);
    const typeChanged = fields.type !== undefined && fields.type !== current.type;
    const goalChanged = fields.goalId !== undefined && fields.goalId !== current.goalId;
    const archiving = archived === true && current.archivedAt === null;

    // A SIP bound to this account (as its source or its target, active or
    // paused) keeps assuming the account's original type/goal/archived state —
    // check *before* the auto-null-goalId logic below mutates `fields`, using
    // the patch's as-submitted values.
    if (typeChanged || goalChanged || archiving) {
      const sipRefs = await tx
        .select({ sourceAccountId: sips.sourceAccountId, targetAccountId: sips.targetAccountId })
        .from(sips)
        .where(or(eq(sips.sourceAccountId, id), eq(sips.targetAccountId, id)));
      const targetSipCount = sipRefs.filter((r) => r.targetAccountId === id).length;
      const sourceSipCount = sipRefs.filter((r) => r.sourceAccountId === id).length;
      const blocked = assessAccountEditAgainstSips(
        { ...fields, archived },
        { ...current, type: assertPublicAccountType(current.type) },
        { targetSipCount, sourceSipCount },
      );
      if (blocked) throw new HttpError(409, blocked);
    }

    // A goal earmark only applies to accounts you accumulate toward a goal. If the
    // resulting type can't hold one, drop the assignment — whether it's being set
    // now or was left over from before a type change — so it never lingers,
    // hidden from the UI, still counted in goal funding.
    if (!accountCanHaveGoal(nextType)) {
      fields.goalId = null;
    }
    // Earmarking to a goal must point at the caller's own goal.
    await assertOwnedGoal(tx, userId, fields.goalId);

    if (fields.accountLast4 !== undefined) {
      const bank = await tx.query.bankDetails.findFirst({
        where: and(eq(bankDetails.accountId, id), eq(bankDetails.userId, userId)),
      });
      // Accepting this would let the two drift apart silently. The full number wins.
      if (bank && bank.accountNumber !== "") {
        throw new HttpError(400, "Last 4 is derived from the account number — edit that instead");
      }
    }

    // Correcting the opening balance must keep the column and the "Opening
    // balance" row from both carrying the amount — see planOpeningBalanceChange.
    let openingColumn: { openingBalancePaise: number } | Record<string, never> = {};
    // Also on a bare type change: the new type keeps its opening balance
    // somewhere else (column vs ledger row), so leaving it put would drift from
    // the invariant and force the user to edit the amount just to migrate it.
    if (openingBalancePaise !== undefined || typeChanged) {
      // `is_opening` is not settable through any route or schema — only
      // createAccount, this function and the demo seed ever write it, each at most
      // once per account — so there is normally exactly one row. Ordered anyway so
      // that if one ever did exist twice, the row this may delete is deterministic.
      const existingRow = await tx.query.transactions.findFirst({
        where: and(
          eq(transactions.accountId, id),
          eq(transactions.userId, userId),
          eq(transactions.isOpening, true),
          isNull(transactions.deletedAt),
        ),
        orderBy: (t, { asc }) => [asc(t.date), asc(t.id)],
        columns: { id: true, amountPaise: true },
      });
      const earliest = await tx
        .select({ min: sql<string | null>`min(${transactions.date})` })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, id),
            eq(transactions.userId, userId),
            eq(transactions.isOpening, false),
            isNull(transactions.deletedAt),
          ),
        );
      const plan = planOpeningBalanceChange({
        type: nextType,
        requestedPaise: openingBalanceToReconcile({
          requestedPaise: openingBalancePaise,
          existingRowPaise: existingRow?.amountPaise ?? null,
          columnPaise: current.openingBalancePaise,
        }),
        existing: existingRow ? { id: existingRow.id, amountPaise: existingRow.amountPaise } : null,
        earliestTxnDate: earliest[0]?.min ?? null,
        today: new Date().toISOString().slice(0, 10),
      });
      openingColumn = { openingBalancePaise: plan.columnPaise };
      if (plan.txn.kind === "insert") {
        const [openingTxn] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId: id,
            date: plan.txn.date,
            amountPaise: plan.txn.amountPaise,
            merchant: "Opening balance",
            isOpening: true,
          })
          .returning({ id: transactions.id });
        const sys = await resolveSystemAccounts(tx, userId);
        await postTransaction(
          tx,
          openingTxn!.id,
          userId,
          buildOpeningPostings({
            accountId: id,
            amountPaise: plan.txn.amountPaise,
            systemOpeningAccountId: sys.opening,
          }),
        );
      } else if (plan.txn.kind === "update") {
        const sys = await resolveSystemAccounts(tx, userId);
        await postTransaction(
          tx,
          plan.txn.id,
          userId,
          buildOpeningPostings({
            accountId: id,
            amountPaise: plan.txn.amountPaise,
            systemOpeningAccountId: sys.opening,
          }),
        );
      } else if (plan.txn.kind === "delete") {
        // Soft-delete, like every other user-transaction removal (see
        // transactions.ts) — a hard delete would cascade away the row's splits,
        // transfer link and attachment metadata while leaving the stored
        // attachment files orphaned. Every balance surface filters
        // `deleted_at is null`, so the amount stops counting either way.
        // NO posting change here: postings are retained on soft-delete, same
        // as softDeleteTransaction (readers exclude via deleted_at).
        await tx
          .update(transactions)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(transactions.id, plan.txn.id),
              eq(transactions.accountId, id),
              eq(transactions.userId, userId),
            ),
          );
      }
    }

    const rows = await tx
      .update(accounts)
      .set({
        ...fields,
        ...openingColumn,
        ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();
    if (rows.length === 0) throw new HttpError(404, "Account not found");

    // Keep scheme details consistent with the new type: EPS is EPF-only, and EPF
    // has no maturity date. Clear whichever the transition invalidates so a stale
    // value can't survive the type editor.
    if (typeChanged) {
      const patch = nextType === "epf" ? { maturityDate: null } : { epsBalancePaise: null };
      await tx
        .update(retirementDetails)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(retirementDetails.accountId, id), eq(retirementDetails.userId, userId)));
    }

    return toAccount(rows[0]!);
  });
}

/** Message for the "account is a SIP source" delete guard — pure so it's testable without a DB. */
export function sipSourceBlockedMessage(count: number): string {
  return `Account is the source of ${count} SIP(s) — pause and delete them or repoint them first`;
}

export async function deleteAccount(db: Db, userId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    // Lock the account row first — same TOCTOU rationale as updateAccount: a
    // concurrent SIP creation locks this same row (sips.ts's
    // lockedAccountForSip) before it counts/relies on this account, so
    // whichever side commits first is what the other sees.
    const currentRows = await tx
      .select({ id: accounts.id, systemKind: accounts.systemKind })
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .for("update");
    if (currentRows.length === 0) throw new HttpError(404, "Account not found");
    // System accounts are internal to the postings model — invisible to
    // account management.
    if (currentRows[0]!.systemKind !== null) throw new HttpError(404, "Account not found");

    // Any transaction counts, including soft-deleted ones: they still hold a
    // (non-cascading) FK to the account, so deleting would hit a constraint error
    // at the DB. Archive is the path for an account that has ever been used.
    const used = await tx.query.transactions.findFirst({
      where: eq(transactions.accountId, id),
    });
    if (used) {
      throw new HttpError(409, "Account has transactions — archive it instead of deleting");
    }
    // sips.source_account_id has no delete action (unlike target_account_id,
    // which cascades by design) — without this check a SIP-referenced account
    // would hit a raw FK constraint error instead of a controlled response.
    const sipRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sips)
      .where(eq(sips.sourceAccountId, id));
    const sipCount = sipRows[0]!.count;
    if (sipCount > 0) {
      throw new HttpError(409, sipSourceBlockedMessage(sipCount));
    }
    const rows = await tx
      .delete(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });
    if (rows.length === 0) throw new HttpError(404, "Account not found");
  });
}
