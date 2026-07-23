import { and, eq, isNull, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { CashflowMonth, Forecast } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { recurringTemplates } from "../db/schema.ts";
import { toCsv } from "../lib/csv.ts";
import { bankCashTotal } from "./balances.ts";
import { cached } from "./cache.ts";
import { getTrends } from "./dashboard.ts";
import { LIABILITY_TYPES_SQL } from "./periods.ts";
import { advanceDate } from "./recurring.ts";

const TTL = 300;

export async function getCashflow(
  db: Db,
  redis: Redis,
  userId: string,
  months: number,
): Promise<CashflowMonth[]> {
  const trends = await getTrends(db, redis, userId, months);
  return trends.months.map((m) => ({
    month: m.month,
    incomePaise: m.incomePaise,
    expensePaise: m.expensePaise,
    netPaise: m.incomePaise - m.expensePaise,
  }));
}

export function cashflowCsv(rows: CashflowMonth[]): string {
  return toCsv([
    ["month", "income_inr", "expense_inr", "net_inr"],
    ...rows.map((r): Array<string | number> => [
      r.month,
      (r.incomePaise / 100).toFixed(2),
      (r.expensePaise / 100).toFixed(2),
      (r.netPaise / 100).toFixed(2),
    ]),
  ]);
}

function isoPlusDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 90-day cash forecast: today's bank+cash balance, minus a daily discretionary
 * burn (trailing 90 days of non-recurring spending) and every scheduled
 * recurring occurrence in the window. Runway = balance / average monthly net
 * burn; null when cash-flow positive.
 */
export async function getForecast(db: Db, redis: Redis, userId: string): Promise<Forecast> {
  return cached(redis, userId, "forecast:90", TTL, async () => {
    const startBalancePaise = await bankCashTotal(db, userId);

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const from90 = isoPlusDays(now, -90);
    // Opening-balance seed rows are not activity — excluded alongside transfers.
    const notTransfer = sql`not t.is_opening and not exists (select 1 from transfer_links tl
      where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)`;

    // trailing net burn (all sources) for runway, and discretionary spend
    // (excluding recurring-sourced rows, which the schedule below re-adds)
    const burnRes = await db.execute(sql`
      select
        coalesce(sum(case when t.amount_paise < 0 then -t.amount_paise else 0 end), 0)::bigint as expense,
        coalesce(sum(case when t.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL})
          then t.amount_paise else 0 end), 0)::bigint as income,
        coalesce(sum(case when t.amount_paise < 0 and t.source <> 'recurring' then -t.amount_paise else 0 end), 0)::bigint as discretionary
      from transactions t
      join accounts a on a.id = t.account_id
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= ${from90} and t.date <= ${today} and ${notTransfer}
    `);
    const burn = burnRes.rows[0] as { expense: string; income: string; discretionary: string };
    const netBurnMonthly = Math.round((Number(burn.expense) - Number(burn.income)) / 3);
    const dailyDiscretionary = Math.round(Number(burn.discretionary) / 90);

    // scheduled occurrences inside the window, per template
    const templates = await db.query.recurringTemplates.findMany({
      where: and(eq(recurringTemplates.userId, userId), isNull(recurringTemplates.pausedAt)),
    });
    const horizon = isoPlusDays(now, 90);
    const obligationsByDate = new Map<string, Array<{ merchant: string; amountPaise: number }>>();
    for (const t of templates) {
      let due = t.nextDueDate;
      while (due <= horizon) {
        if (t.endDate !== null && due > t.endDate) break;
        if (due >= today) {
          const list = obligationsByDate.get(due) ?? [];
          list.push({ merchant: t.merchant, amountPaise: t.amountPaise });
          obligationsByDate.set(due, list);
        }
        due = advanceDate(due, t.frequency, t.interval);
      }
    }

    const days: Forecast["days"] = [];
    let balance = startBalancePaise;
    for (let i = 0; i <= 90; i += 1) {
      const date = isoPlusDays(now, i);
      const obligations = obligationsByDate.get(date) ?? [];
      if (i > 0) balance -= dailyDiscretionary;
      for (const o of obligations) balance += o.amountPaise;
      days.push({ date, balancePaise: balance, obligations });
    }

    return {
      startBalancePaise,
      runwayMonths:
        netBurnMonthly <= 0 || startBalancePaise <= 0
          ? netBurnMonthly <= 0
            ? null
            : 0
          : Math.round((startBalancePaise / netBurnMonthly) * 10) / 10,
      avgMonthlyBurnPaise: netBurnMonthly,
      days,
    };
  });
}
