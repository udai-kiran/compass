import { sql } from "drizzle-orm";
import type { SearchResults } from "@compass/shared";
import type { Db } from "../../../db/index.ts";

/** Cross-entity search: transactions (merchant/notes), categories, accounts, goals. */
export async function search(db: Db, userId: string, q: string): Promise<SearchResults> {
  const term = q.trim();
  if (!term) return { transactions: [], categories: [], accounts: [], goals: [] };
  const like = `%${term.toLowerCase()}%`;

  const [txs, cats, accs, goalRows] = await Promise.all([
    db.execute(sql`
      select id, merchant, amount_paise, date from transactions
      where user_id = ${userId} and deleted_at is null
        and (lower(merchant) like ${like} or lower(notes) like ${like})
      order by date desc limit 8
    `),
    db.execute(sql`select id, name from categories where user_id = ${userId} and lower(name) like ${like} order by name limit 6`),
    db.execute(sql`select id, name from accounts where user_id = ${userId} and lower(name) like ${like} and system_kind is null order by name limit 6`),
    db.execute(sql`select id, name from goals where user_id = ${userId} and archived_at is null and lower(name) like ${like} order by name limit 6`),
  ]);

  return {
    transactions: (txs.rows as Array<{ id: string; merchant: string; amount_paise: string; date: string }>).map((r) => ({
      id: r.id,
      merchant: r.merchant,
      amountPaise: Number(r.amount_paise),
      date: r.date,
    })),
    categories: (cats.rows as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, name: r.name })),
    accounts: (accs.rows as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, name: r.name })),
    goals: (goalRows.rows as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, name: r.name })),
  };
}
