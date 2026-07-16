import { sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";

export interface AccountBalance {
  id: string;
  name: string;
  balancePaise: number;
}

/**
 * Posted bank+cash balance per account: opening balance plus every non-deleted
 * transaction dated on or before `asOf`.
 *
 * Future-dated transactions are excluded on purpose. A "current" balance is what
 * has posted, not what is scheduled — a salary credit dated next week must not
 * inflate today's cash, runway, or low-balance check. computeNetWorth and the
 * account list apply the same `date <= asOf` cut, so every surface that shows a
 * balance agrees on what counts as posted. Callers that need a different set of
 * account types should filter the result; this is the single source of the sum.
 */
export async function bankCashBalances(
  db: Db,
  userId: string,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<AccountBalance[]> {
  const res = await db.execute(sql`
    select a.id, a.name, (a.opening_balance_paise + coalesce(t.total, 0))::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total
      from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null and a.type in ('bank', 'cash')
  `);
  return (res.rows as Array<{ id: string; name: string; balance: string }>).map((r) => ({
    id: r.id,
    name: r.name,
    balancePaise: Number(r.balance),
  }));
}

/** Total posted bank+cash balance (sum of {@link bankCashBalances}). */
export async function bankCashTotal(
  db: Db,
  userId: string,
  asOf?: string,
): Promise<number> {
  const rows = await bankCashBalances(db, userId, asOf);
  return rows.reduce((sum, r) => sum + r.balancePaise, 0);
}
