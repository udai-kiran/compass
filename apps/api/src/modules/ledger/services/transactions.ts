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
import type { Db, DbOrTx } from "../../../db/index.ts";
import { recurringTemplates, transactions, transactionSplits, transferLinks } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { assertOwnedRealAccount, assertOwnedCategory } from "../../../lib/ownership.ts";
import { assertOwnedResource } from "./resources.ts";
import { isUniqueViolation } from "../../investments/services/sip-lifecycle.ts";
import {
  buildOpeningPostings,
  buildOrdinaryPostings,
  buildSplitPostings,
  buildTransferLegPostings,
  PostingShapeError,
  type PostingDraft,
  sumPaise,
} from "./postings.ts";
import { replacePostings, resolveSystemAccounts, type ResolvedSystemAccounts } from "./post-entry.ts";

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

export function encodeCursor(date: string, createdAt: Date | string, id: string): string {
  const createdAtIso = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  return Buffer.from(`${date}|${createdAtIso}|${id}`).toString("base64url");
}

/**
 * Decodes a keyset cursor of (date, createdAt, id). Returns `null` — rather
 * than throwing — for anything that doesn't parse, including the older
 * 2-part (date, id) cursor format: callers treat a `null` result as "no
 * cursor", i.e. serve the first page, instead of erroring on a stale link.
 */
export function decodeCursor(cursor: string): { date: string; createdAt: string; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString();
  } catch {
    return null;
  }
  const parts = decoded.split("|");
  if (parts.length !== 3) return null;
  const [date, createdAt, id] = parts as [string, string, string];
  if (!date || !createdAt || !id) return null;

  // Validate date: must be YYYY-MM-DD and a valid calendar date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return null;

  // Validate createdAt: must be parseable as a timestamp
  if (Number.isNaN(Date.parse(createdAt))) return null;

  // Validate id: must be a valid UUID (8-4-4-4-12 hex)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return { date, createdAt, id };
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
  const counterpartTxByTx = new Map<string, string>();
  for (const l of linkRows) {
    linkByTx.set(l.outTransactionId, l.id);
    linkByTx.set(l.inTransactionId, l.id);
    counterpartTxByTx.set(l.outTransactionId, l.inTransactionId);
    counterpartTxByTx.set(l.inTransactionId, l.outTransactionId);
  }
  // Resolve each transfer leg's *counterpart account* — the other leg often isn't
  // in this page, so look up just the account of the counterpart transactions.
  const counterpartTxIds = [
    ...new Set(rows.map((r) => counterpartTxByTx.get(r.id)).filter((id): id is string => !!id)),
  ];
  const accountByCounterpartTx = new Map<string, string>();
  if (counterpartTxIds.length > 0) {
    const cpRows = await db.query.transactions.findMany({
      where: inArray(transactions.id, counterpartTxIds),
      columns: { id: true, accountId: true },
    });
    for (const t of cpRows) accountByCounterpartTx.set(t.id, t.accountId);
  }
  const counterpartAccountByTx = (id: string): string | null => {
    const cpTx = counterpartTxByTx.get(id);
    return cpTx ? (accountByCounterpartTx.get(cpTx) ?? null) : null;
  };
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    date: r.date,
    amountPaise: r.amountPaise,
    merchant: r.merchant,
    categoryId: r.categoryId,
    necessity: r.necessity,
    notes: r.notes,
    tags: r.tags,
    source: r.source,
    transferLinkId: linkByTx.get(r.id) ?? null,
    transferCounterpartAccountId: counterpartAccountByTx(r.id),
    policyId: r.policyId,
    resourceId: r.resourceId,
    recurringTemplateId: r.recurringTemplateId,
    splits: splitsByTx.get(r.id) ?? [],
  }));
}

/**
 * Computes the posting drafts that mirror a transaction's CURRENT resulting
 * shape (the row + any transaction_splits, re-read on the passed handle).
 * Branches on the row's shape FIRST, in order: (a) an opening row
 * (`is_opening = true`, bank/cash accounts only) mirrors Opening postings;
 * (b) a row that is a member of `transfer_links` (as either `out_transaction_id`
 * or `in_transaction_id`) mirrors a per-leg Clearing pair via
 * `buildTransferLegPostings`; (c) a row with `transaction_splits` mirrors
 * split postings; (d) otherwise ordinary postings. `linkTransfer`/
 * `unlinkTransfer` (`transfers.ts`) call this after changing `transfer_links`
 * membership so both legs flip between Clearing and ordinary shape.
 *
 * `transaction_splits` carries no `necessity` column of its own (see schema
 * in `modules/ledger/schema.ts`) — each split posting's necessity is the
 * parent transaction's `necessity`, applied uniformly to every split.
 *
 * Tenant-scoped: returns `null` when no row exists for `id` owned by `userId`
 * (soft-deleted rows still count — their postings are retained). The SPLIT
 * branch enforces the split-sum invariant: if the split amounts do not sum to
 * the parent row's amount, a `PostingShapeError` is thrown — the shape is
 * unrepairable, not re-derivable.
 *
 * `systemAccounts` may be passed in to reuse an already-resolved set (e.g.
 * from `resolveSystemAccounts`); otherwise they are resolved here.
 */
export async function computePostingDraftsForTransaction(
  t: DbOrTx,
  userId: string,
  id: string,
  systemAccounts?: ResolvedSystemAccounts,
): Promise<PostingDraft[] | null> {
  const row = await t.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  });
  if (!row) return null;
  const resolved = systemAccounts ?? (await resolveSystemAccounts(t, userId));

  if (row.isOpening === true) {
    return buildOpeningPostings({
      accountId: row.accountId,
      amountPaise: row.amountPaise,
      systemOpeningAccountId: resolved.opening,
    });
  }

  const transferLink = await t.query.transferLinks.findFirst({
    where: or(eq(transferLinks.outTransactionId, id), eq(transferLinks.inTransactionId, id)),
  });
  if (transferLink) {
    return buildTransferLegPostings({
      accountId: row.accountId,
      amountPaise: row.amountPaise,
      clearingAccountId: resolved.clearing,
      note: "",
    });
  }

  const splitRows = await t.query.transactionSplits.findMany({
    where: eq(transactionSplits.transactionId, id),
  });
  if (splitRows.length > 0) {
    const splitSum = sumPaise(splitRows.map((s) => s.amountPaise));
    if (splitSum !== row.amountPaise) {
      throw new PostingShapeError(
        `transaction ${id}: split sum ${splitSum} paise does not match transaction amount ${row.amountPaise} paise`,
      );
    }
    return buildSplitPostings({
      accountId: row.accountId,
      splits: splitRows.map((s) => ({
        categoryId: s.categoryId,
        amountPaise: s.amountPaise,
        necessity: row.necessity,
        note: s.note,
      })),
      systemExpensesAccountId: resolved.expenses,
      systemIncomeAccountId: resolved.income,
    });
  }

  return buildOrdinaryPostings({
    accountId: row.accountId,
    amountPaise: row.amountPaise,
    categoryId: row.categoryId,
    necessity: row.necessity,
    systemExpensesAccountId: resolved.expenses,
    systemIncomeAccountId: resolved.income,
  });
}

/**
 * Rebuilds a transaction's posting mirror from its CURRENT resulting shape
 * (the row + any transaction_splits, re-read on the passed handle) and
 * replaces the postings via `replacePostings`. Shared by every writer that
 * needs to re-derive postings after a legacy mutation rather than construct
 * drafts inline: `updateTransaction`, `setSplits`, `bulkAction`
 * (restore/setCategory), and the opening-balance row writers in
 * `accounts.ts` (createAccount, updateAccount's opening-plan apply). Must be
 * called on the SAME tx as the legacy write it follows (ATOMICITY LAW) —
 * callers pass their `t` handle, never a bare `db`.
 *
 * Delegates the shape computation to `computePostingDraftsForTransaction`
 * (see there for the branch order and the split-sum invariant), then replaces
 * the postings via `replacePostings`. Returns without writing when no row
 * exists for `id` under `userId`.
 */
export async function rebuildPostingsForTransaction(t: DbOrTx, userId: string, id: string): Promise<void> {
  const drafts = await computePostingDraftsForTransaction(t, userId, id);
  if (!drafts) return;
  await replacePostings(t, id, userId, drafts);
}

export async function listTransactions(
  db: Db,
  userId: string,
  query: TransactionFilter & { cursor?: string; limit: number },
): Promise<TransactionPage> {
  const where = filterWhere(userId, query);
  const conds: SQL[] = [where];
  // A malformed/stale cursor (e.g. the older 2-part format) decodes to `null`
  // and is treated as "no cursor" — first page — rather than throwing.
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    conds.push(
      sql`(${transactions.date}, ${transactions.createdAt}, ${transactions.id}) < (${cursor.date}::date, ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const order = query.q
    ? [
        desc(sql`ts_rank("transactions"."search", plainto_tsquery('simple', ${query.q}))`),
        desc(transactions.date),
        desc(transactions.createdAt),
        desc(transactions.id),
      ]
    : [desc(transactions.date), desc(transactions.createdAt), desc(transactions.id)];

  // The filtered totals can't change between pages of one scroll, so only pay
  // for the count/sum aggregate on the first page (no cursor); later pages carry
  // the value the client already has and report -1 to signal "unchanged".
  const withTotals = cursor === null;
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
            inflow: sql<number>`coalesce(sum(${transactions.amountPaise}) filter (where ${transactions.amountPaise} > 0), 0)::bigint`,
            outflow: sql<number>`coalesce(-sum(${transactions.amountPaise}) filter (where ${transactions.amountPaise} < 0), 0)::bigint`,
          })
          .from(transactions)
          .where(where)
      : Promise.resolve(null),
  ]);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  // For cursor, we need the full-precision created_at to avoid sub-millisecond
  // truncation that can drop rows at page boundaries. Query it separately for
  // the last row when we need to build nextCursor. Use to_char to produce a
  // guaranteed ISO-8601 UTC string with microsecond precision that Date.parse
  // accepts and that ::timestamptz round-trips exactly.
  let lastCreatedAtPrecise: string | null = null;
  if (hasMore && last && !query.q) {
    const preciseRow = await db
      .select({
        createdAtText: sql<string>`to_char(${transactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(transactions)
      .where(eq(transactions.id, last.id))
      .limit(1);
    lastCreatedAtPrecise = preciseRow[0]?.createdAtText ?? null;
  }
  return {
    items: await hydrate(db, page),
    nextCursor:
      hasMore && last && !query.q && lastCreatedAtPrecise
        ? encodeCursor(last.date, lastCreatedAtPrecise, last.id)
        : null,
    totalCount: totals ? totals[0]!.count : -1,
    totalAmountPaise: totals ? Number(totals[0]!.sum) : -1,
    totalInflowPaise: totals ? Number(totals[0]!.inflow) : -1,
    totalOutflowPaise: totals ? Number(totals[0]!.outflow) : -1,
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
    policyId?: string | null;
    /** precise transaction instant when known (e.g. carried from an accepted alert) */
    occurredAt?: Date | null;
  },
): Promise<Transaction> {
  await assertOwnedRealAccount(db, userId, input.accountId);
  await assertOwnedCategory(db, userId, input.categoryId);
  await assertOwnedResource(db, userId, input.resourceId);
  if (input.recurringTemplateId) {
    const template = await db.query.recurringTemplates.findFirst({
      where: and(
        eq(recurringTemplates.id, input.recurringTemplateId),
        eq(recurringTemplates.userId, userId),
      ),
      columns: { id: true },
    });
    if (!template) throw new HttpError(404, "Recurring bill or subscription not found");
  }
  // normalize the merchant; the category is whatever the caller supplied
  // (manual entry now, AI-assisted categorization later)
  const merchantRulesList = await getMerchantRules(db, userId);
  const merchant = input.merchant ? normalizeMerchant(input.merchant, merchantRulesList) : "";
  // Legacy insert + posting mirror share ONE db transaction (ATOMICITY LAW).
  // `db.transaction(...)` opens a real transaction when `db` is a bare `Db`,
  // or a nested savepoint when `db` is already a `Tx` (this fn is `DbOrTx`) —
  // either way the legacy row and its postings commit/rollback together.
  const rows = await db.transaction(async (t) => {
    const inserted = await t
      .insert(transactions)
      .values({ ...input, merchant, userId })
      .returning();
    const newRow = inserted[0]!;
    const systemAccounts = await resolveSystemAccounts(t, userId);
    const drafts = buildOrdinaryPostings({
      accountId: newRow.accountId,
      amountPaise: newRow.amountPaise,
      categoryId: newRow.categoryId,
      necessity: newRow.necessity,
      systemExpensesAccountId: systemAccounts.expenses,
      systemIncomeAccountId: systemAccounts.income,
    });
    await replacePostings(t, newRow.id, userId, drafts);
    return inserted;
  });
  return (await hydrate(db, [rows[0]!]))[0]!;
}

export async function updateTransaction(
  db: Db,
  userId: string,
  id: string,
  input: UpdateTransaction,
): Promise<Transaction> {
  if (input.accountId !== undefined) await assertOwnedRealAccount(db, userId, input.accountId);
  if (input.categoryId !== undefined) await assertOwnedCategory(db, userId, input.categoryId);
  if (input.resourceId !== undefined) await assertOwnedResource(db, userId, input.resourceId);
  if (input.recurringTemplateId) {
    const template = await db.query.recurringTemplates.findFirst({
      where: and(
        eq(recurringTemplates.id, input.recurringTemplateId),
        eq(recurringTemplates.userId, userId),
      ),
      columns: { id: true },
    });
    if (!template) throw new HttpError(404, "Recurring bill or subscription not found");
  }
  let rows;
  try {
    // Legacy update + posting rebuild share ONE db transaction (ATOMICITY LAW).
    rows = await db.transaction(async (t) => {
      // 1. Lock the target row under FOR UPDATE to serialize concurrent edits.
      const [locked] = await t
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
        )
        .for("update");
      if (!locked) return [];

      // 2. Transfer-leg guard: reject account/amount edits on a linked leg.
      if (input.accountId !== undefined || input.amountPaise !== undefined) {
        const linkRow = await t.query.transferLinks.findFirst({
          where: or(eq(transferLinks.outTransactionId, id), eq(transferLinks.inTransactionId, id)),
        });
        if (linkRow) {
          throw new HttpError(
            409,
            "Unlink the transfer before changing a transfer leg's account or amount",
          );
        }
      }

      // 3. Split-amount guard: reject amountPaise change that doesn't match existing splits.
      if (input.amountPaise !== undefined) {
        const splitRows = await t.query.transactionSplits.findMany({
          where: eq(transactionSplits.transactionId, id),
          columns: { amountPaise: true },
        });
        if (splitRows.length > 0) {
          const splitSum = sumPaise(splitRows.map((s) => s.amountPaise));
          if (splitSum !== input.amountPaise) {
            throw new HttpError(
              409,
              "Update the transaction's splits to match the new amount",
            );
          }
        }
      }

      const updated = await t
        .update(transactions)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
        )
        .returning();
      if (updated.length === 0) return updated;
      // Re-read the RESULTING shape (row + any transaction_splits) and rebuild
      // postings from it — account/amount/category/necessity can all change
      // via the spread update, and this covers every case uniformly (D15).
      await rebuildPostingsForTransaction(t, userId, id);
      return updated;
    });
  } catch (err) {
    // A SIP's linked installment holds (sip_id, date) uniquely, so moving this
    // transaction onto the date of another installment of the same SIP collides.
    // Before `transactions.sip_id` was ever written (see linkSipInstallment in
    // sip-installments.ts) this index could not fire from here at all — without this
    // catch the collision reaches the client as an unhandled 23505, i.e. a 500.
    if (isUniqueViolation(err, "transactions_sip_date_idx")) {
      throw new HttpError(409, "This SIP's installment is already recorded on that date — unlink it first");
    }
    throw err;
  }
  if (rows.length === 0) throw new HttpError(404, "Transaction not found");
  return (await hydrate(db, rows))[0]!;
}

export async function softDeleteTransaction(db: Db, userId: string, id: string): Promise<void> {
  // NO posting change: readers exclude via the parent's deleted_at, and postings
  // are intentionally retained (see PLAN-dualwrite.md; review-8 carry-forward).
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
  for (const s of splits) await assertOwnedCategory(db, userId, s.categoryId);
  await db.transaction(async (t) => {
    // Lock the parent row and validate the sum INSIDE the write tx (ATOMICITY
    // LAW / concurrency safety) — a concurrent amount edit can't race this
    // check between read and write. BigInt-safe sum via sumPaise.
    const parentRows = await t
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
      )
      .for("update");
    const parent = parentRows[0];
    if (!parent) throw new HttpError(404, "Transaction not found");
    const total = sumPaise(splits.map((s) => s.amountPaise));
    if (splits.length > 0 && total !== parent.amountPaise) {
      throw new HttpError(400, `Splits must sum to the transaction amount (${parent.amountPaise})`);
    }
    await t.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    if (splits.length > 0) {
      await t.insert(transactionSplits).values(splits.map((s) => ({ ...s, transactionId: id })));
    }
    // Rebuild postings from the RESULTING shape in the SAME tx (ATOMICITY LAW):
    // split postings when splits remain, else ordinary postings from the txn's
    // own amount/category/necessity (reverting to ordinary).
    await rebuildPostingsForTransaction(t, userId, id);
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
        // Restore can change the category and un-delete the row — rebuild this
        // row's postings from its resulting shape in the SAME tx.
        await rebuildPostingsForTransaction(t, userId, item.id);
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
        // Re-category changes the affected rows' Expenses/Income counter
        // posting's category — rebuild each row's postings from its resulting
        // shape (never touches Clearing/Opening) in the SAME tx.
        for (const id of ids) await rebuildPostingsForTransaction(t, userId, id);
        break;
      case "addTag":
        // Header-only (tags array) — NO posting change.
        await t
          .update(transactions)
          .set({
            tags: sql`(select array_agg(distinct x) from unnest(array_append(${transactions.tags}, ${action.tag})) as x)`,
            updatedAt: new Date(),
          })
          .where(where);
        break;
      case "removeTag":
        // Header-only (tags array) — NO posting change.
        await t
          .update(transactions)
          .set({ tags: sql`array_remove(${transactions.tags}, ${action.tag})`, updatedAt: new Date() })
          .where(where);
        break;
      case "delete":
        // NO posting change: same as softDeleteTransaction — readers exclude
        // via deleted_at; postings are intentionally retained.
        await t.update(transactions).set({ deletedAt: new Date() }).where(where);
        break;
    }
    return { affected: ids.length, snapshot };
  });
}
