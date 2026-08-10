import { sql } from "drizzle-orm";
import type { AiProvider } from "@compass/ai";
import { redactPii, type AiCategorySuggestion, type RedactionIdentity } from "@compass/shared";
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
      where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
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
