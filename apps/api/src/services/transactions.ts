import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type {
  BulkAction,
  BulkResult,
  CreateTransaction,
  Split,
  Transaction,
  TransactionFilter,
  TransactionPage,
  UpdateTransaction,
} from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { transactions, transactionSplits, transferLinks } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { assertOwnedAccount, assertOwnedCategory } from "./ownership.ts";

type TxRow = typeof transactions.$inferSelect;

/** Sign conventions: outflow (expense) is negative, inflow (income) positive. */
export function txDirection(amountPaise: number): "inflow" | "outflow" {
  return amountPaise > 0 ? "inflow" : "outflow";
}

/** Net income/expense aggregation over signed amounts, excluding transfers. */
export function sumSigned(amounts: number[]): { incomePaise: number; expensePaise: number } {
  let incomePaise = 0;
  let expensePaise = 0;
  for (const a of amounts) {
    if (a > 0) incomePaise += a;
    else expensePaise += -a;
  }
  return { incomePaise, expensePaise };
}

/** SQL fragment: true when the transaction is part of a linked transfer. */
export function isTransferSql(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${transferLinks} tl
    where tl.out_transaction_id = ${transactions.id} or tl.in_transaction_id = ${transactions.id})`;
}

export function filterWhere(
  userId: string,
  filter: TransactionFilter,
  opts: { includeDeleted?: boolean } = {},
): SQL {
  const conds: SQL[] = [eq(transactions.userId, userId) as SQL];
  if (!opts.includeDeleted) conds.push(isNull(transactions.deletedAt) as SQL);
  if (filter.q) {
    conds.push(sql`"transactions"."search" @@ plainto_tsquery('simple', ${filter.q})`);
  }
  if (filter.from) conds.push(gte(transactions.date, filter.from) as SQL);
  if (filter.to) conds.push(lte(transactions.date, filter.to) as SQL);
  if (filter.accountId) conds.push(eq(transactions.accountId, filter.accountId) as SQL);
  if (filter.categoryId) conds.push(eq(transactions.categoryId, filter.categoryId) as SQL);
  if (filter.tag) conds.push(sql`${filter.tag} = any(${transactions.tags})`);
  if (filter.minAmountPaise !== undefined) {
    conds.push(sql`abs(${transactions.amountPaise}) >= ${filter.minAmountPaise}`);
  }
  if (filter.maxAmountPaise !== undefined) {
    conds.push(sql`abs(${transactions.amountPaise}) <= ${filter.maxAmountPaise}`);
  }
  return and(...conds)!;
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!date || !id) throw new HttpError(400, "Invalid cursor");
  return { date, id };
}

async function hydrate(db: DbOrTx, rows: TxRow[]): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [splitRows, linkRows] = await Promise.all([
    db.query.transactionSplits.findMany({ where: inArray(transactionSplits.transactionId, ids) }),
    db.query.transferLinks.findMany({
      where: or(
        inArray(transferLinks.outTransactionId, ids),
        inArray(transferLinks.inTransactionId, ids),
      ),
    }),
  ]);
  const splitsByTx = new Map<string, Split[]>();
  for (const s of splitRows) {
    const list = splitsByTx.get(s.transactionId) ?? [];
    list.push({ id: s.id, categoryId: s.categoryId, amountPaise: s.amountPaise, note: s.note });
    splitsByTx.set(s.transactionId, list);
  }
  const linkByTx = new Map<string, string>();
  for (const l of linkRows) {
    linkByTx.set(l.outTransactionId, l.id);
    linkByTx.set(l.inTransactionId, l.id);
  }
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    date: r.date,
    amountPaise: r.amountPaise,
    merchant: r.merchant,
    categoryId: r.categoryId,
    notes: r.notes,
    tags: r.tags,
    source: r.source,
    transferLinkId: linkByTx.get(r.id) ?? null,
    policyAccountId: r.policyAccountId,
    splits: splitsByTx.get(r.id) ?? [],
  }));
}

export async function listTransactions(
  db: Db,
  userId: string,
  query: TransactionFilter & { cursor?: string; limit: number },
): Promise<TransactionPage> {
  const where = filterWhere(userId, query);
  const conds: SQL[] = [where];
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conds.push(
      sql`(${transactions.date}, ${transactions.id}) < (${c.date}::date, ${c.id}::uuid)`,
    );
  }
  const order = query.q
    ? [
        desc(sql`ts_rank("transactions"."search", plainto_tsquery('simple', ${query.q}))`),
        desc(transactions.date),
        desc(transactions.id),
      ]
    : [desc(transactions.date), desc(transactions.id)];

  // The filtered totals can't change between pages of one scroll, so only pay
  // for the count/sum aggregate on the first page (no cursor); later pages carry
  // the value the client already has and report -1 to signal "unchanged".
  const withTotals = query.cursor === undefined;
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(and(...conds))
      .orderBy(...order)
      .limit(query.limit + 1),
    withTotals
      ? db
          .select({
            count: sql<number>`count(*)::int`,
            sum: sql<number>`coalesce(sum(${transactions.amountPaise}), 0)::bigint`,
          })
          .from(transactions)
          .where(where)
      : Promise.resolve(null),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: await hydrate(db, page),
    nextCursor: hasMore && last && !query.q ? encodeCursor(last.date, last.id) : null,
    totalCount: totals ? totals[0]!.count : -1,
    totalAmountPaise: totals ? Number(totals[0]!.sum) : -1,
  };
}

export async function getTransaction(db: Db, userId: string, id: string): Promise<Transaction> {
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  });
  if (!row || row.deletedAt) throw new HttpError(404, "Transaction not found");
  return (await hydrate(db, [row]))[0]!;
}

export async function createTransaction(
  db: DbOrTx,
  userId: string,
  input: CreateTransaction & {
    source?: "manual" | "import" | "recurring";
    policyAccountId?: string | null;
  },
): Promise<Transaction> {
  await assertOwnedAccount(db, userId, input.accountId);
  await assertOwnedCategory(db, userId, input.categoryId);
  // normalize the merchant; the category is whatever the caller supplied
  // (manual entry now, AI-assisted categorization later)
  const merchantRulesList = await getMerchantRules(db, userId);
  const merchant = input.merchant ? normalizeMerchant(input.merchant, merchantRulesList) : "";
  const rows = await db
    .insert(transactions)
    .values({ ...input, merchant, userId })
    .returning();
  return (await hydrate(db, [rows[0]!]))[0]!;
}

export async function updateTransaction(
  db: Db,
  userId: string,
  id: string,
  input: UpdateTransaction,
): Promise<Transaction> {
  if (input.accountId !== undefined) await assertOwnedAccount(db, userId, input.accountId);
  if (input.categoryId !== undefined) await assertOwnedCategory(db, userId, input.categoryId);
  const rows = await db
    .update(transactions)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
    )
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Transaction not found");
  return (await hydrate(db, rows))[0]!;
}

export async function softDeleteTransaction(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .update(transactions)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
    )
    .returning({ id: transactions.id });
  if (rows.length === 0) throw new HttpError(404, "Transaction not found");
}

export async function setSplits(
  db: Db,
  userId: string,
  id: string,
  splits: Array<{ categoryId: string; amountPaise: number; note: string }>,
): Promise<Transaction> {
  const tx = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
  });
  if (!tx) throw new HttpError(404, "Transaction not found");
  for (const s of splits) await assertOwnedCategory(db, userId, s.categoryId);
  const total = splits.reduce((s, x) => s + x.amountPaise, 0);
  if (splits.length > 0 && total !== tx.amountPaise) {
    throw new HttpError(400, `Splits must sum to the transaction amount (${tx.amountPaise})`);
  }
  await db.transaction(async (t) => {
    await t.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    if (splits.length > 0) {
      await t.insert(transactionSplits).values(splits.map((s) => ({ ...s, transactionId: id })));
    }
  });
  return getTransaction(db, userId, id);
}

export async function bulkAction(db: Db, userId: string, action: BulkAction): Promise<BulkResult> {
  if (action.action === "restore") {
    // The snapshot is client-supplied on undo — its category ids must be the
    // caller's own, or a restore could stamp another user's category onto a row.
    for (const item of action.snapshot) await assertOwnedCategory(db, userId, item.categoryId);
    return db.transaction(async (t) => {
      for (const item of action.snapshot) {
        await t
          .update(transactions)
          .set({
            categoryId: item.categoryId,
            tags: item.tags,
            deletedAt: item.deleted ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(transactions.id, item.id), eq(transactions.userId, userId)));
      }
      return { affected: action.snapshot.length, snapshot: [] };
    });
  }

  // A bulk re-category must target the caller's own category.
  if (action.action === "setCategory") await assertOwnedCategory(db, userId, action.categoryId);

  const targetWhere =
    action.ids !== undefined
      ? and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          inArray(transactions.id, action.ids),
        )!
      : filterWhere(userId, action.filter ?? {});

  return db.transaction(async (t) => {
    const before = await t
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        tags: transactions.tags,
      })
      .from(transactions)
      .where(targetWhere);
    const snapshot = before.map((b) => ({ ...b, deleted: false }));
    const ids = before.map((b) => b.id);
    if (ids.length === 0) return { affected: 0, snapshot: [] };

    const where = inArray(transactions.id, ids);
    switch (action.action) {
      case "setCategory":
        await t
          .update(transactions)
          .set({ categoryId: action.categoryId, updatedAt: new Date() })
          .where(where);
        break;
      case "addTag":
        await t
          .update(transactions)
          .set({
            tags: sql`(select array_agg(distinct x) from unnest(array_append(${transactions.tags}, ${action.tag})) as x)`,
            updatedAt: new Date(),
          })
          .where(where);
        break;
      case "removeTag":
        await t
          .update(transactions)
          .set({ tags: sql`array_remove(${transactions.tags}, ${action.tag})`, updatedAt: new Date() })
          .where(where);
        break;
      case "delete":
        await t.update(transactions).set({ deletedAt: new Date() }).where(where);
        break;
    }
    return { affected: ids.length, snapshot };
  });
}
