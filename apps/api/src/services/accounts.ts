import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  Account,
  AccountWithBalance,
  CreateAccount,
  UpdateAccount,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type AccountRow = typeof accounts.$inferSelect;

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    institution: row.institution,
    accountLast4: row.accountLast4,
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

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  input: UpdateAccount,
): Promise<Account> {
  const { archived, ...fields } = input;
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
