import { sql } from "drizzle-orm";
import type { AiProvider } from "@compass/ai";
import {
  redactPii,
  type AiCategorySuggestion,
  type MerchantSuggestion,
  type RedactionIdentity,
  type SmartFillResponse,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { hasCategoryDimension } from "../../../lib/ledger-sql.ts";

/**
 * The user's own identifiers, to redact *their* PII from the free-text note sent
 * to the model (the merchant name is kept — it's the categorization signal). See
 * `redactPii`.
 */
async function loadRedactionIdentity(db: Db, userId: string): Promise<RedactionIdentity> {
  const row = (
    await db.execute(sql`
      select u.display_name, u.email,
        array_remove(array_agg(distinct nullif(a.holder_name, '')), null) as holder_names,
        array_remove(array_agg(distinct vpa), null) as upi_ids
      from users u
      left join accounts a on a.user_id = u.id
      left join lateral unnest(coalesce(a.upi_ids, '{}')) as vpa on true
      where u.id = ${userId}
      group by u.id
    `)
  ).rows[0] as
    | { display_name: string; email: string; holder_names: string[] | null; upi_ids: string[] | null }
    | undefined;
  if (!row) return { names: [], emails: [], upiIds: [] };
  const names = new Set<string>(row.holder_names ?? []);
  if (row.display_name) names.add(row.display_name);
  return {
    names: [...names],
    emails: row.email ? [row.email] : [],
    upiIds: (row.upi_ids ?? []).filter((v) => v !== ""),
  };
}

/**
 * AI categorization assist (task 7.3). Fetches uncategorized transactions,
 * asks the provider for suggestions, and returns them enriched for display.
 * Nothing is written — the user confirms in the UI, and manual categories are
 * never touched because only rows with `category_id IS NULL` are considered.
 */
export async function suggestCategoriesFor(
  db: Db,
  ai: AiProvider,
  userId: string,
  transactionIds: string[] | undefined,
): Promise<AiCategorySuggestion[]> {
  const restrict = transactionIds && transactionIds.length > 0;
  const rows = (
    await db.execute(sql`
      select t.id, t.merchant, t.notes, p.amount_paise
      from postings p
      join accounts a on a.id = p.account_id
      join transactions t on t.id = p.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null
        and not exists (
          select 1 from postings cp
          join accounts ca on ca.id = cp.account_id and ca.system_kind is not null
          where cp.transaction_id = t.id and cp.category_id is not null
        )
        and a.system_kind is null
        and ${hasCategoryDimension()}
        ${restrict ? sql`and t.id in (${sql.join(transactionIds!.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
      order by t.date desc
      limit 200
    `)
  ).rows as Array<{ id: string; merchant: string; notes: string; amount_paise: string }>;

  if (rows.length === 0) return [];

  const catRows = (
    await db.execute(sql`
      select id, name, kind from categories
      where user_id = ${userId} and archived_at is null and kind in ('expense','income')
    `)
  ).rows as Array<{ id: string; name: string; kind: "expense" | "income" }>;
  if (catRows.length === 0) return [];

  const identity = await loadRedactionIdentity(db, userId);
  const suggestions = await ai.suggestCategories({
    categories: catRows.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    transactions: rows.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      // The user's free-text note may carry their own PII; the merchant name is
      // the categorization signal and stays as-is.
      description: redactPii(r.notes, identity),
      amountPaise: Number(r.amount_paise),
    })),
  });

  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const txById = new Map(rows.map((r) => [r.id, r]));
  return suggestions
    .filter((s) => txById.has(s.transactionId) && s.categoryId !== null)
    .map((s) => {
      const tx = txById.get(s.transactionId)!;
      return {
        transactionId: s.transactionId,
        merchant: tx.merchant,
        amountPaise: Number(tx.amount_paise),
        categoryId: s.categoryId,
        categoryName: s.categoryId ? (catName.get(s.categoryId) ?? null) : null,
        confidence: s.confidence,
      };
    });
}

/**
 * History-based Smart Fill (no AI). Groups uncategorized transactions by
 * merchant × direction and returns one suggestion per pair derived from the
 * user's own past categorization choices. M merchant-direction pairs replaces
 * N transaction rows, so the review panel scales to any transaction volume.
 *
 * Only transactions that have a category dimension (ordinary or split) are
 * considered — transfers and opening entries are excluded.
 *
 * Fixes:
 * - History CTE joins categories to exclude archived ones before ranking, so
 *   the top-ranked result is always an active category and uncoveredCount is
 *   never over-counted by merchants whose only history is archived categories.
 * - Direction (sign of posting amount on the system account) is included in
 *   the grouping key to prevent blending expense and income history for the
 *   same merchant.
 * - Ranked CTE has a deterministic tie-breaker (category_id) so equal-frequency
 *   candidates always resolve to the same winner.
 * - Response is capped at 200 merchant-direction pairs (ordered by txn_count
 *   desc) to bound response size and subsequent bulk-write bursts.
 */
export async function suggestByMerchant(db: Db, userId: string): Promise<SmartFillResponse> {
  // Step 1: best historical category per merchant × direction (frequency-ranked).
  // The join on categories excludes archived categories before ranking, so the
  // winning category is always active and uncoveredCount is not artificially
  // inflated by merchants whose top category is archived.
  const histRows = (
    await db.execute(sql`
      with history as (
        select t.merchant,
               sign(p.amount_paise)::int as direction,
               p.category_id,
               count(*)                 as freq
        from transactions t
        join postings    p on p.transaction_id = t.id
        join accounts    a on a.id = p.account_id and a.system_kind is not null
        join categories  c on c.id = p.category_id
                           and c.user_id = ${userId}
                           and c.archived_at is null
        where t.user_id = ${userId} and t.deleted_at is null and p.category_id is not null
        group by t.merchant, direction, p.category_id
      ),
      ranked as (
        select merchant, direction, category_id, freq,
          sum(freq) over (partition by merchant, direction) as total,
          row_number() over (
            partition by merchant, direction
            order by freq desc, category_id   -- deterministic tie-break
          ) as rnk
        from history
      )
      select merchant, direction, category_id,
        freq::float / total as confidence,
        freq::int           as history_count
      from ranked
      where rnk = 1
    `)
  ).rows as Array<{
    merchant: string;
    direction: number;
    category_id: string;
    confidence: number;
    history_count: number;
  }>;

  if (histRows.length === 0) {
    // No categorized history at all — count uncovered merchant×direction pairs and return early.
    const uncovRow = (
      await db.execute(sql`
        select count(*) as cnt
        from (
          select distinct t.merchant, sign(p.amount_paise)::int
          from transactions t
          join postings p on p.transaction_id = t.id
          join accounts a on a.id = p.account_id and a.system_kind is not null
          where t.user_id = ${userId} and t.deleted_at is null and p.category_id is null
            and ${hasCategoryDimension()}
        ) sub
      `)
    ).rows[0] as { cnt: string | number } | undefined;
    return { suggestions: [], uncoveredCount: Number(uncovRow?.cnt ?? 0) };
  }

  // Build lookup: "${merchant}:${direction}" → best active category info
  const best = new Map(
    histRows.map((r) => [
      `${r.merchant}:${r.direction}`,
      { categoryId: r.category_id, confidence: r.confidence, historyCount: r.history_count },
    ]),
  );

  // Step 2: uncategorized transactions grouped by merchant × direction.
  // Fetch 201 rows ordered by txn_count desc; if we get 201 the result is capped.
  const pendingRows = (
    await db.execute(sql`
      select t.merchant,
        sign(p.amount_paise)::int          as direction,
        array_agg(distinct t.id::text)     as txn_ids,
        count(distinct t.id)::int          as txn_count
      from transactions t
      join postings p on p.transaction_id = t.id
      join accounts a on a.id = p.account_id and a.system_kind is not null
      where t.user_id = ${userId} and t.deleted_at is null and p.category_id is null
        and ${hasCategoryDimension()}
      group by t.merchant, direction
      order by txn_count desc
      limit 201
    `)
  ).rows as Array<{ merchant: string; direction: number; txn_ids: string[]; txn_count: number }>;

  if (pendingRows.length === 0) return { suggestions: [], uncoveredCount: 0 };

  const capped = pendingRows.length > 200;
  if (capped) pendingRows.splice(200);

  // Step 3: split pending rows into those with history and those without
  const matchedRows = pendingRows.filter((r) => best.has(`${r.merchant}:${r.direction}`));
  const uncoveredCount = pendingRows.length - matchedRows.length;

  if (matchedRows.length === 0) return { suggestions: [], uncoveredCount, ...(capped ? { capped } : {}) };

  // Step 4: fetch category names for all matched suggestions in one query
  const categoryIds = [
    ...new Set(matchedRows.map((r) => best.get(`${r.merchant}:${r.direction}`)!.categoryId)),
  ];
  const catRows = (
    await db.execute(sql`
      select id, name from categories
      where user_id = ${userId} and id = any(${categoryIds}::uuid[]) and archived_at is null
    `)
  ).rows as Array<{ id: string; name: string }>;
  const catName = new Map(catRows.map((c) => [c.id, c.name]));

  const suggestions: MerchantSuggestion[] = matchedRows
    .map((r) => {
      const b = best.get(`${r.merchant}:${r.direction}`)!;
      const name = catName.get(b.categoryId);
      if (!name) return null; // safety net: archived_at filter in history CTE should prevent this
      return {
        merchant: r.merchant,
        direction: r.direction,
        txnIds: r.txn_ids,
        txnCount: r.txn_count,
        categoryId: b.categoryId,
        categoryName: name,
        confidence: b.confidence,
        historyCount: b.historyCount,
      };
    })
    .filter((s): s is MerchantSuggestion => s !== null)
    .sort((a, b) => b.confidence - a.confidence || b.txnCount - a.txnCount);

  return { suggestions, uncoveredCount, ...(capped ? { capped } : {}) };
}
