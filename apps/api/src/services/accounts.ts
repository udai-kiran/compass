import { and, eq, sql } from "drizzle-orm";
import type {
  Account,
  AccountWithBalance,
  CreateAccount,
  UpdateAccount,
} from "@compass/shared";
import { accountCanHaveGoal, type AccountType } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, bankDetails, retirementDetails, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { assertOwnedGoal } from "./ownership.ts";

/** Only these carry their opening balance as a ledger transaction; other types
 * (cards/loans/schemes) keep it on the accounts.opening_balance_paise column,
 * which their statement/valuation logic reads directly. */
function seedsOpeningTransaction(type: AccountType, openingBalancePaise: number): boolean {
  return (type === "bank" || type === "cash") && openingBalancePaise !== 0;
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

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
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

export async function listAccounts(db: Db, userId: string): Promise<AccountWithBalance[]> {
  const rows = await db
    .select({
      account: accounts,
      // Current balance is posted, not projected: a future-dated transaction
      // must not move it. computeNetWorth applies the same date <= today cut, so
      // the account list and net worth can never disagree about what's posted.
      txSum: sql<number>`coalesce(sum(${transactions.amountPaise}) filter (where ${transactions.deletedAt} is null and ${transactions.date} <= current_date), 0)::bigint`,
      subtype: bankDetails.subtype,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .leftJoin(bankDetails, eq(bankDetails.accountId, accounts.id))
    .where(eq(accounts.userId, userId))
    .groupBy(accounts.id, bankDetails.subtype)
    .orderBy(accounts.sortOrder, accounts.createdAt);
  return rows.map(({ account, txSum, subtype }) => ({
    ...toAccount(account),
    balancePaise: account.openingBalancePaise + Number(txSum),
    subtype: subtype ?? null,
  }));
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
      if (row) await tx.insert(transactions).values(row);
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

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  input: UpdateAccount,
): Promise<Account> {
  const { archived, ...fields } = input;
  const current = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
  });
  if (!current) throw new HttpError(404, "Account not found");

  const nextType = fields.type ?? current.type;
  const typeChanged = fields.type !== undefined && fields.type !== current.type;

  // A goal earmark only applies to accounts you accumulate toward a goal. If the
  // resulting type can't hold one, drop the assignment — whether it's being set
  // now or was left over from before a type change — so it never lingers,
  // hidden from the UI, still counted in goal funding.
  if (!accountCanHaveGoal(nextType)) {
    fields.goalId = null;
  }
  // Earmarking to a goal must point at the caller's own goal.
  await assertOwnedGoal(db, userId, fields.goalId);

  if (fields.accountLast4 !== undefined) {
    const bank = await db.query.bankDetails.findFirst({
      where: and(eq(bankDetails.accountId, id), eq(bankDetails.userId, userId)),
    });
    // Accepting this would let the two drift apart silently. The full number wins.
    if (bank && bank.accountNumber !== "") {
      throw new HttpError(400, "Last 4 is derived from the account number — edit that instead");
    }
  }
  const rows = await db
    .update(accounts)
    .set({
      ...fields,
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
    await db
      .update(retirementDetails)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(retirementDetails.accountId, id), eq(retirementDetails.userId, userId)));
  }

  return toAccount(rows[0]!);
}

export async function deleteAccount(db: Db, userId: string, id: string): Promise<void> {
  // Any transaction counts, including soft-deleted ones: they still hold a
  // (non-cascading) FK to the account, so deleting would hit a constraint error
  // at the DB. Archive is the path for an account that has ever been used.
  const used = await db.query.transactions.findFirst({
    where: eq(transactions.accountId, id),
  });
  if (used) {
    throw new HttpError(409, "Account has transactions — archive it instead of deleting");
  }
  const rows = await db
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .returning({ id: accounts.id });
  if (rows.length === 0) throw new HttpError(404, "Account not found");
}
