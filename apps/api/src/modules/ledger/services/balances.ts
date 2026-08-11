import { sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { HttpError } from "../../../lib/errors.ts";

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
 *
 * The per-account activity total is summed from `postings` (dual-write mirror
 * of `transactions.amount_paise`), joined to the non-deleted parent transaction
 * for the date cut — see postings-balance-parity.test.ts for the parity proof.
 * `opening_balance_paise` is always 0 (boot-time check enforces this), so
 * the balance is the posting total only.
 */
export async function bankCashBalances(
  db: Db,
  userId: string,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<AccountBalance[]> {
  const res = await db.execute(sql`
    select a.id, a.name,
           coalesce(p.total, 0) as posting_total
    from accounts a
    left join (
      select po.account_id, sum(po.amount_paise) as total
      from postings po
      join transactions t on t.id = po.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${asOf}
      group by po.account_id
    ) p on p.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null and a.type in ('bank', 'cash')
  `);
  return (
    res.rows as Array<{ id: string; name: string; posting_total: string }>
  ).map((r) => {
    const balancePaise = Number(r.posting_total);
    if (!Number.isSafeInteger(balancePaise)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    return { id: r.id, name: r.name, balancePaise };
  });
}

/** Total posted bank+cash balance (sum of {@link bankCashBalances}). */
export async function bankCashTotal(
  db: Db,
  userId: string,
  asOf?: string,
): Promise<number> {
  const rows = await bankCashBalances(db, userId, asOf);
  let total = 0;
  for (const r of rows) {
    total += r.balancePaise;
    if (!Number.isSafeInteger(total)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
  }
  return total;
}
