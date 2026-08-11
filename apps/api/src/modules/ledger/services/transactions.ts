import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
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
import { postings, recurringTemplates, transactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { assertOwnedRealAccount, assertOwnedCategory } from "../../../lib/ownership.ts";
import { assertOwnedResource } from "./resources.ts";
import { isUniqueViolation } from "../../investments/services/sip-lifecycle.ts";
import {
  buildOrdinaryPostings,
  buildSplitPostings,
  classifyShape,
  legForAccount,
  PostingShapeError,
  primaryRealLeg,
  rebuildDrafts,
  type ShapePatch,
  sumPaise,
} from "./postings.ts";
import {
  currentPostings,
  postTransaction,
  resolveSystemAccounts,
  systemKindLookup,
  type ResolvedSystemAccounts,
} from "./post-entry.ts";

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

/**
 * The list filter, expressed against POSTINGS.
 *
 * Every predicate that used to read a legacy column is now an EXISTS over the
 * transaction's postings. The account filter is the one that actually changes
 * behaviour: `transactions.account_id` projects only a transfer's OUTFLOW leg,
 * so filtering on it would drop transfers from the destination account's ledger
 * entirely — the money would arrive nowhere. `EXISTS (a posting on this
 * account)` matches both legs, and `hydrate` then projects the one belonging to
 * the account being viewed.
 *
 * Amount filters compare against the real postings for the same reason: a
 * transfer has two, and either may satisfy the range.
 */
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
  if (filter.accountId) {
    conds.push(sql`exists (
      select 1 from postings pf
      where pf.transaction_id = ${transactions.id} and pf.account_id = ${filter.accountId}
    )`);
  }
  if (filter.categoryId) {
    conds.push(sql`exists (
      select 1 from postings pf
      where pf.transaction_id = ${transactions.id} and pf.category_id = ${filter.categoryId}
    )`);
  }
  if (filter.tag) conds.push(sql`${filter.tag} = any(${transactions.tags})`);
  if (filter.minAmountPaise !== undefined) {
    conds.push(sql`exists (
      select 1 from postings pf
      join accounts af on af.id = pf.account_id and af.system_kind is null
      where pf.transaction_id = ${transactions.id}
        and abs(pf.amount_paise) >= ${filter.minAmountPaise}
    )`);
  }
  if (filter.maxAmountPaise !== undefined) {
    conds.push(sql`exists (
      select 1 from postings pf
      join accounts af on af.id = pf.account_id and af.system_kind is null
      where pf.transaction_id = ${transactions.id}
        and abs(pf.amount_paise) <= ${filter.maxAmountPaise}
    )`);
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

/**
 * Builds the `Transaction` DTO for a page of headers from their POSTINGS.
 *
 * Everything shape-related now comes from the postings: the account and amount
 * are a projection, `splits` are the counter postings, and a transfer is two
 * real postings on one header rather than a `transfer_links` row joining two.
 *
 * `perspectiveAccountId` selects WHICH posting the account/amount project from.
 * A transfer touches two accounts, so a global list shows its outflow leg
 * (`primaryRealLeg`) while an account ledger must show that account's own leg —
 * otherwise the destination account's ledger renders an inflow as an outflow.
 */
async function hydrate(
  db: DbOrTx,
  userId: string,
  rows: TxRow[],
  perspectiveAccountId?: string,
): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [postingRows, systemKindOf] = await Promise.all([
    db
      .select({
        transactionId: postings.transactionId,
        id: postings.id,
        accountId: postings.accountId,
        amountPaise: postings.amountPaise,
        categoryId: postings.categoryId,
        necessity: postings.necessity,
        note: postings.note,
      })
      .from(postings)
      .where(inArray(postings.transactionId, ids)),
    systemKindLookup(db, userId),
  ]);

  const byTx = new Map<string, typeof postingRows>();
  for (const p of postingRows) {
    const list = byTx.get(p.transactionId) ?? [];
    list.push(p);
    byTx.set(p.transactionId, list);
  }

  return rows.map((r) => {
    const stored = byTx.get(r.id) ?? [];
    const shape = classifyShape(stored, systemKindOf);
    const isTransfer = shape === "transfer";

    // Which leg this row speaks for. An account-scoped read projects that
    // account's posting; everything else projects the primary real leg.
    const projected =
      (perspectiveAccountId ? legForAccount(stored, perspectiveAccountId) : null) ??
      primaryRealLeg(stored, systemKindOf);

    const counters = stored.filter((p) => {
      const kind = systemKindOf(p.accountId);
      return kind === "expenses" || kind === "income";
    });
    const splits: Split[] =
      shape === "split"
        ? counters.map((c) => ({
            id: c.id,
            categoryId: c.categoryId!,
            amountPaise: -c.amountPaise,
            note: c.note,
          }))
        : [];
    const counterpart = isTransfer
      ? (stored.find((p) => systemKindOf(p.accountId) === null && p.accountId !== projected.accountId)
          ?.accountId ?? null)
      : null;

    return {
      id: r.id,
      accountId: projected.accountId,
      date: r.date,
      amountPaise: projected.amountPaise,
      merchant: r.merchant,
      // A single counter carries the category; a split's categories live on its
      // `splits`, and a transfer or opening has none.
      categoryId: shape === "ordinary" ? (counters[0]?.categoryId ?? null) : null,
      necessity: shape === "ordinary" ? (counters[0]?.necessity ?? null) : null,
      notes: r.notes,
      tags: r.tags,
      source: r.source,
      isTransfer,
      transferCounterpartAccountId: counterpart,
      policyId: r.policyId,
      resourceId: r.resourceId,
      recurringTemplateId: r.recurringTemplateId,
      splits,
    };
  });
}

/**
 * Applies a shape-affecting patch to a transaction: reads its CURRENT postings
 * (the authority for what it is), rebuilds them through the pure
 * `rebuildDrafts`, and writes them plus their legacy projection.
 *
 * This replaces `computePostingDraftsForTransaction`, which re-derived the
 * whole shape from `is_opening` / `transfer_links` / `transaction_splits` and
 * the legacy columns. That direction is gone: those columns are now written
 * FROM postings and read by nothing.
 *
 * Throws `PostingShapeError` for a transaction with no postings at all rather
 * than inventing a shape for it — under the old model a postings-less row was
 * repairable from its columns, and under this one it is corrupt data.
 *
 * `systemAccounts` may be passed in to reuse an already-resolved set.
 */
export async function applyShapePatch(
  t: DbOrTx,
  userId: string,
  id: string,
  patch: ShapePatch,
  systemAccounts?: ResolvedSystemAccounts,
): Promise<void> {
  const stored = await currentPostings(t, id);
  if (stored.length === 0) {
    throw new PostingShapeError(
      `transaction ${id} has no postings — its shape cannot be determined`,
    );
  }
  const resolved = systemAccounts ?? (await resolveSystemAccounts(t, userId));
  const systemKindOf = await systemKindLookup(t, userId);
  const drafts = rebuildDrafts(stored, patch, resolved, systemKindOf);
  await postTransaction(t, id, userId, drafts);
}

/**
 * Re-projects a transaction's legacy columns from its existing postings,
 * changing no posting. The postings-authoritative successor to
 * `rebuildPostingsForTransaction`, whose name described the old direction:
 * it rebuilt POSTINGS from the columns.
 *
 * Callers that only touched header fields (merchant, notes, tags, date) do not
 * need this at all. It exists for the writers that must guarantee the doomed
 * columns still satisfy NOT NULL after they have inserted a header — and it
 * disappears with those columns in PR-G2.
 */
export async function reprojectLegacyColumns(t: DbOrTx, userId: string, id: string): Promise<void> {
  await applyShapePatch(t, userId, id, {});
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
      ? // Totals sum the PROJECTED leg of each matching transaction, so they
        // agree with the amounts the list actually shows — one row, one
        // contribution. Which leg that is depends on the same perspective the
        // rows use: an account-scoped list sums that account's postings, and a
        // global list sums the outflow leg of a transfer and the single real
        // leg of everything else.
        //
        // A global list additionally EXCLUDES transfers from the money totals
        // (it still counts them in `count`). Summing one leg of a transfer
        // would drop the net by the transfer amount, when moving money between
        // your own accounts nets to zero — which is what the header claims to
        // show.
        db.execute(sql`
          with projected as (
            select
              t.id,
              (
                select p.amount_paise
                from postings p
                join accounts a on a.id = p.account_id and a.system_kind is null
                where p.transaction_id = t.id
                  ${query.accountId ? sql`and p.account_id = ${query.accountId}` : sql`order by p.amount_paise asc`}
                limit 1
              ) as amount_paise,
              (
                select count(*) from postings pr
                join accounts ar on ar.id = pr.account_id and ar.system_kind is null
                where pr.transaction_id = t.id
              ) as real_legs
            from transactions t
            where ${where}
          )
          select
            count(*)::int as count,
            coalesce(sum(amount_paise) filter (where ${query.accountId ? sql`true` : sql`real_legs = 1`}), 0)::bigint as sum,
            coalesce(sum(amount_paise) filter (where amount_paise > 0 and ${query.accountId ? sql`true` : sql`real_legs = 1`}), 0)::bigint as inflow,
            coalesce(-sum(amount_paise) filter (where amount_paise < 0 and ${query.accountId ? sql`true` : sql`real_legs = 1`}), 0)::bigint as outflow
          from projected
        `)
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
  const totalRow = (totals?.rows[0] ?? null) as {
    count: number;
    sum: string;
    inflow: string;
    outflow: string;
  } | null;
  return {
    items: await hydrate(db, userId, page, query.accountId),
    nextCursor:
      hasMore && last && !query.q && lastCreatedAtPrecise
        ? encodeCursor(last.date, lastCreatedAtPrecise, last.id)
        : null,
    totalCount: totalRow ? totalRow.count : -1,
    totalAmountPaise: totalRow ? safeTotal(totalRow.sum) : -1,
    totalInflowPaise: totalRow ? safeTotal(totalRow.inflow) : -1,
    totalOutflowPaise: totalRow ? safeTotal(totalRow.outflow) : -1,
  };
}

/** bigint→Number with the repo's refuse-to-lose-paise guard. */
function safeTotal(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new HttpError(500, "Transaction total exceeded a safe integer — refusing to lose paise");
  }
  return n;
}

export async function getTransaction(db: DbOrTx, userId: string, id: string): Promise<Transaction> {
  const row = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  });
  if (!row || row.deletedAt) throw new HttpError(404, "Transaction not found");
  return (await hydrate(db, userId, [row]))[0]!;
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
    // Drafts come from the caller's INPUT, not from re-reading the row we just
    // wrote: the request is the intent, and the columns are only its shadow.
    const drafts = buildOrdinaryPostings({
      accountId: input.accountId,
      amountPaise: input.amountPaise,
      categoryId: input.categoryId ?? null,
      necessity: input.necessity ?? null,
      systemExpensesAccountId: systemAccounts.expenses,
      systemIncomeAccountId: systemAccounts.income,
    });
    await postTransaction(t, newRow.id, userId, drafts);
    return inserted;
  });
  return getTransaction(db, userId, rows[0]!.id);
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

      // 2. Header-only fields go straight to the row. The shape-affecting four
      //    (account, amount, category, necessity) are deliberately NOT written
      //    here — `applyShapePatch` derives them from the rebuilt postings, so
      //    writing them now would only be overwritten a line later.
      const { accountId, amountPaise, categoryId, necessity, ...header } = input;
      if (Object.keys(header).length > 0) {
        await t
          .update(transactions)
          .set({ ...header, updatedAt: new Date() })
          .where(
            and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
          );
      }

      // 3. Rebuild the postings for the shape patch. The transfer-leg guard and
      //    the split-sum guard both live inside `rebuildDrafts` now — they are
      //    properties of the shape, not of the columns, so they belong with the
      //    shape logic where they are unit-testable.
      await applyShapePatch(t, userId, id, { accountId, amountPaise, categoryId, necessity });

      return t
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
        );
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
  return getTransaction(db, userId, id);
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
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
      )
      .for("update");
    if (!parentRows[0]) throw new HttpError(404, "Transaction not found");

    // The amount to match is the CURRENT postings' real leg, not the legacy
    // column — postings are the authority, and the column is their shadow.
    const stored = await currentPostings(t, id);
    const systemKindOf = await systemKindLookup(t, userId);
    const shape = classifyShape(stored, systemKindOf);
    if (shape === "transfer" || shape === "opening") {
      throw new HttpError(409, `A ${shape} cannot be split`);
    }
    const parentAmount = primaryRealLeg(stored, systemKindOf).amountPaise;
    const total = sumPaise(splits.map((s) => s.amountPaise));
    if (splits.length > 0 && total !== parentAmount) {
      throw new HttpError(400, `Splits must sum to the transaction amount (${parentAmount})`);
    }

    const systemAccounts = await resolveSystemAccounts(t, userId);
    const necessity = stored.find((p) => {
      const kind = systemKindOf(p.accountId);
      return kind === "expenses" || kind === "income";
    })?.necessity ?? null;
    const drafts =
      splits.length > 0
        ? buildSplitPostings({
            accountId: primaryRealLeg(stored, systemKindOf).accountId,
            splits: splits.map((s) => ({ ...s, necessity })),
            systemExpensesAccountId: systemAccounts.expenses,
            systemIncomeAccountId: systemAccounts.income,
          })
        : // Clearing the splits reverts to an ordinary transaction. Its single
          // category is genuinely gone with the split counters, so it becomes
          // uncategorized rather than resurrecting a stale legacy column.
          buildOrdinaryPostings({
            accountId: primaryRealLeg(stored, systemKindOf).accountId,
            amountPaise: parentAmount,
            categoryId: null,
            necessity,
            systemExpensesAccountId: systemAccounts.expenses,
            systemIncomeAccountId: systemAccounts.income,
          });
    await postTransaction(t, id, userId, drafts);
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
            tags: item.tags,
            deletedAt: item.deleted ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(transactions.id, item.id), eq(transactions.userId, userId)));
        // The category lives on the counter posting, so restoring it is a shape
        // patch — not a column write followed by a re-derive.
        await applyShapePatch(t, userId, item.id, { categoryId: item.categoryId });
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
        // The category lives on the counter posting. `rebuildDrafts` ignores a
        // category patch for split, transfer and opening shapes, so a bulk
        // re-category over a filter that catches one leaves it alone — which is
        // exactly what the legacy branch did.
        for (const id of ids) await applyShapePatch(t, userId, id, { categoryId: action.categoryId });
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
