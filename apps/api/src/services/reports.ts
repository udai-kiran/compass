import { eq, sql } from "drizzle-orm";
import type { Report, ReportQuery } from "@compass/shared";
import {
  formatINR,
  inclusiveDayCount,
  isRealIsoDate,
  MAX_REPORT_RANGE_DAYS,
  MONTH_KEY_RE,
  YEAR_KEY_RE,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { toCsv } from "../lib/csv.ts";
import { categories } from "../db/schema.ts";
import { incomeExpense, periodRange, spentByCategory } from "./periods.ts";
import { savingRatePct } from "./insights.ts";

/**
 * Resolve a validated `ReportQuery` into a concrete `from`/`to`/`periodKey`.
 * Throws rather than using `!` non-null assertions: `buildReport` is also
 * called directly from `services/ai/tools.ts` and `services/ai/summary.ts`,
 * which construct their own query objects and bypass Zod entirely. The rules
 * enforced here are equivalent to `ReportQuerySchema`'s: `MONTH_KEY_RE`,
 * `YEAR_KEY_RE`, `MAX_REPORT_RANGE_DAYS` and `inclusiveDayCount` are shared
 * directly, while date validity is checked with the shared `isRealIsoDate`
 * because the schema's `z.iso.date()` never runs on these bypass paths.
 */
export function resolveReportRange(q: ReportQuery): { from: string; to: string; periodKey: string } {
  if (q.period === "custom") {
    if (!q.from || !q.to || !isRealIsoDate(q.from) || !isRealIsoDate(q.to)) {
      throw new Error("A custom report range requires valid from/to calendar dates");
    }
    if (q.from > q.to) {
      throw new Error("A custom report range requires from <= to");
    }
    if (inclusiveDayCount(q.from, q.to) > MAX_REPORT_RANGE_DAYS) {
      throw new Error(`A custom report range must not exceed ${MAX_REPORT_RANGE_DAYS} days`);
    }
    return { from: q.from, to: q.to, periodKey: `${q.from}..${q.to}` };
  }
  if (!q.key) {
    throw new Error(`A period key is required for a ${q.period} report`);
  }
  if (q.period === "annual" && !YEAR_KEY_RE.test(q.key)) {
    throw new Error(`An annual report key must be YYYY, got "${q.key}"`);
  }
  if (q.period === "monthly" && !MONTH_KEY_RE.test(q.key)) {
    throw new Error(`A monthly report key must be YYYY-MM, got "${q.key}"`);
  }
  const { from, to } = periodRange(q.period, q.key);
  return { from, to, periodKey: q.key };
}

/**
 * Period report: income/expense/net + savings rate, category breakdown, and top
 * merchants. Reuses the same aggregation helpers as the dashboard so totals
 * reconcile exactly.
 */
export async function buildReport(db: Db, userId: string, query: ReportQuery): Promise<Report> {
  const { from, to, periodKey } = resolveReportRange(query);
  const [{ incomePaise, expensePaise }, byCat, catRows, merchants] = await Promise.all([
    incomeExpense(db, userId, from, to),
    spentByCategory(db, userId, from, to),
    db.query.categories.findMany({ where: eq(categories.userId, userId) }),
    db.execute(sql`
      select t.merchant, coalesce(sum(-t.amount_paise), 0)::bigint as spent, count(*)::int as n
      from transactions t
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= ${from} and t.date <= ${to} and t.amount_paise < 0 and t.merchant <> ''
        and not t.is_opening
        and not exists (select 1 from transfer_links tl where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      group by t.merchant order by spent desc limit 15
    `),
  ]);
  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const categoriesOut = [...byCat.entries()]
    .map(([categoryId, spentPaise]) => ({
      categoryId,
      name: categoryId === null ? "Uncategorized" : (catName.get(categoryId) ?? "Unknown"),
      spentPaise,
    }))
    .sort((a, b) => b.spentPaise - a.spentPaise);

  return {
    period: query.period,
    periodKey,
    from,
    to,
    incomePaise,
    expensePaise,
    netPaise: incomePaise - expensePaise,
    savingsRatePct: savingRatePct(incomePaise, expensePaise),
    categories: categoriesOut,
    topMerchants: (merchants.rows as Array<{ merchant: string; spent: string; n: number }>).map((r) => ({
      merchant: r.merchant,
      spentPaise: Number(r.spent),
      count: r.n,
    })),
  };
}

/** Flatten a report into CSV sections (summary, categories, merchants). */
export function reportToCsv(report: Report): string {
  const rows: Array<Array<string | number>> = [];
  rows.push([`Compass report — ${report.period} ${report.periodKey}`]);
  rows.push([`Period`, `${report.from} to ${report.to}`]);
  rows.push([]);
  rows.push(["Summary", "Amount (INR)"]);
  rows.push(["Income", formatINR(report.incomePaise)]);
  rows.push(["Expense", formatINR(report.expensePaise)]);
  rows.push(["Net", formatINR(report.netPaise)]);
  rows.push(["Savings rate", `${report.savingsRatePct}%`]);
  rows.push([]);
  rows.push(["Category", "Spent (INR)"]);
  for (const c of report.categories) rows.push([c.name, formatINR(c.spentPaise)]);
  rows.push([]);
  rows.push(["Merchant", "Spent (INR)", "Transactions"]);
  for (const m of report.topMerchants) rows.push([m.merchant, formatINR(m.spentPaise), m.count]);
  return toCsv(rows);
}
