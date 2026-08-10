import { sql, type SQL } from "drizzle-orm";

/**
 * SQL guard restricting an aggregate to transactions that have a CATEGORY
 * DIMENSION — i.e. real spend or income, not a transfer and not an opening
 * balance. Expects the `transactions` table aliased as `t`.
 *
 * Stated positively, which is both simpler and safer than the exclusions it
 * replaces. Every shape either has Expenses/Income counter postings or does not:
 *
 *   ordinary  1 real + 1 counter    → included
 *   split     1 real + N counters   → included
 *   transfer  2 real, no system     → excluded
 *   opening   1 real + 1 Opening    → excluded
 *
 * Before PR-G1 this was `NOT EXISTS (… system_kind IN ('clearing','opening'))`,
 * which identified a transfer by its Clearing posting. Clearing is gone, and a
 * collapsed transfer has no marker posting at all — so that guard would have
 * silently counted every transfer as BOTH income and expense. Anchoring on the
 * counter postings needs no marker: a transfer simply has nothing to sum.
 *
 * Only aggregates over REAL postings need this. A query that already sums
 * counter postings (`a.system_kind = 'expenses'`) is inherently transfer-free,
 * because a transfer has none.
 */
export function hasCategoryDimension(): SQL {
  return sql`exists (
        select 1 from postings pc
        join accounts ac on ac.id = pc.account_id
        where pc.transaction_id = t.id and ac.system_kind in ('expenses', 'income')
      )`;
}
