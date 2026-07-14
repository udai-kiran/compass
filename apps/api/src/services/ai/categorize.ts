import { sql } from "drizzle-orm";
import type { AiProvider } from "@compass/ai";
import type { AiCategorySuggestion } from "@compass/shared";
import type { Db } from "../../db/index.ts";

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
      select id, merchant, notes, amount_paise
      from transactions
      where user_id = ${userId} and deleted_at is null and category_id is null
        ${restrict ? sql`and id in ${transactionIds}` : sql``}
      order by date desc
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

  const suggestions = await ai.suggestCategories({
    categories: catRows.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    transactions: rows.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      description: r.notes,
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
