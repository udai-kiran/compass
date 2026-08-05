import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Dashboard, Trends } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { bankCashTotal } from "../../ledger/services/balances.ts";
import { cached } from "../../../lib/cache.ts";
import { getUtilization } from "./budgets.ts";
import {
  currentPeriodKey,
  incomeExpense,
  LIABILITY_TYPES_SQL,
  periodRange,
  spentByCategory,
} from "../../../lib/periods.ts";
import { listTransactions } from "../../ledger/services/transactions.ts";

const TTL = 300;

export async function getDashboard(db: Db, redis: Redis, userId: string): Promise<Dashboard> {
  return cached(redis, userId, "dashboard", TTL, async () => {
    const key = currentPeriodKey("monthly");
    const { from, to } = periodRange("monthly", key);

    const [cashAvailablePaise, month, util, recent, byCat] = await Promise.all([
      bankCashTotal(db, userId),
      incomeExpense(db, userId, from, to),
      getUtilization(db, userId, "monthly", key),
      listTransactions(db, userId, { limit: 5 }),
      spentByCategory(db, userId, from, to),
    ]);

    return {
      cashAvailablePaise,
      month: { periodKey: key, ...month },
      budget: {
        totalBudgetedPaise: util.totalBudgetedPaise,
        totalSpentPaise: util.totalSpentPaise,
        lines: util.lines.slice(0, 5),
      },
      recent: recent.items,
      byCategory: [...byCat.entries()]
        .map(([categoryId, spentPaise]) => ({ categoryId, spentPaise }))
        .sort((a, b) => b.spentPaise - a.spentPaise),
    };
  });
}

/** Pre-aggregated monthly rollups (SQL group-by, Redis-cached per user). */
export async function getTrends(db: Db, redis: Redis, userId: string, months: number): Promise<Trends> {
  return cached(redis, userId, `trends:${months}`, TTL, async () => {
    const end = currentPeriodKey("monthly");
    let start = end;
    for (let i = 1; i < months; i += 1) {
      const [y, m] = start.split("-").map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 2, 1));
      start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    const from = `${start}-01`;
    const { to } = periodRange("monthly", end);

    // Opening-balance seed rows are not activity — excluded alongside transfers.
    const notTransfer = sql`not t.is_opening and not exists (select 1 from transfer_links tl
      where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)`;

    const totals = await db.execute(sql`
      select to_char(t.date, 'YYYY-MM') as month,
        coalesce(sum(case when t.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL})
          then t.amount_paise else 0 end), 0)::bigint as income,
        coalesce(sum(case when t.amount_paise < 0 then -t.amount_paise else 0 end), 0)::bigint as expense
      from transactions t
      join accounts a on a.id = t.account_id
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= ${from} and t.date <= ${to} and ${notTransfer}
      group by 1
    `);
    const nonSplitCat = await db.execute(sql`
      select to_char(t.date, 'YYYY-MM') as month, t.category_id as cid,
        coalesce(sum(-t.amount_paise), 0)::bigint as spent
      from transactions t
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= ${from} and t.date <= ${to} and t.amount_paise < 0 and ${notTransfer}
        and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
      group by 1, 2
    `);
    const splitCat = await db.execute(sql`
      select to_char(t.date, 'YYYY-MM') as month, s.category_id as cid,
        coalesce(sum(-s.amount_paise), 0)::bigint as spent
      from transaction_splits s
      join transactions t on t.id = s.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= ${from} and t.date <= ${to} and s.amount_paise < 0 and ${notTransfer}
      group by 1, 2
    `);

    const byMonth = new Map<string, { incomePaise: number; expensePaise: number; cats: Map<string | null, number> }>();
    // seed every month in the window so the series has no gaps
    let cursor = start;
    for (let i = 0; i < months; i += 1) {
      byMonth.set(cursor, { incomePaise: 0, expensePaise: 0, cats: new Map() });
      const [y, m] = cursor.split("-").map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m, 1));
      cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    for (const r of totals.rows as Array<{ month: string; income: string; expense: string }>) {
      const m = byMonth.get(r.month);
      if (m) {
        m.incomePaise = Number(r.income);
        m.expensePaise = Number(r.expense);
      }
    }
    for (const r of [...nonSplitCat.rows, ...splitCat.rows] as Array<{ month: string; cid: string | null; spent: string }>) {
      const m = byMonth.get(r.month);
      if (m) m.cats.set(r.cid, (m.cats.get(r.cid) ?? 0) + Number(r.spent));
    }

    return {
      months: [...byMonth.entries()].map(([month, m]) => ({
        month,
        incomePaise: m.incomePaise,
        expensePaise: m.expensePaise,
        byCategory: [...m.cats.entries()]
          .map(([categoryId, spentPaise]) => ({ categoryId, spentPaise }))
          .sort((a, b) => b.spentPaise - a.spentPaise),
      })),
    };
  });
}
