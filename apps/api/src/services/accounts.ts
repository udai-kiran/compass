import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  Account,
  AccountWithBalance,
  CreateAccount,
  UpdateAccount,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, bankDetails, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

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
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function listAccounts(db: Db, userId: string): Promise<AccountWithBalance[]> {
  const rows = await db
    .select({
      account: accounts,
      txSum: sql<number>`coalesce(sum(${transactions.amountPaise}) filter (where ${transactions.deletedAt} is null), 0)::bigint`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(eq(accounts.userId, userId))
    .groupBy(accounts.id)
    .orderBy(accounts.sortOrder, accounts.createdAt);
  return rows.map(({ account, txSum }) => ({
    ...toAccount(account),
    balancePaise: account.openingBalancePaise + Number(txSum),
  }));
}

export async function createAccount(
  db: Db,
  userId: string,
  input: CreateAccount,
): Promise<Account> {
  const rows = await db
    .insert(accounts)
    .values({ ...input, userId })
    .returning();
  return toAccount(rows[0]!);
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
  return toAccount(rows[0]!);
}

export async function deleteAccount(db: Db, userId: string, id: string): Promise<void> {
  const used = await db.query.transactions.findFirst({
    where: and(eq(transactions.accountId, id), isNull(transactions.deletedAt)),
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
