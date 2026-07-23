import { eq, sql } from "drizzle-orm";
import type { Report, ReportPeriod } from "@compass/shared";
import { formatINR } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { toCsv } from "../lib/csv.ts";
import { categories } from "../db/schema.ts";
import { incomeExpense, periodRange, spentByCategory } from "./periods.ts";
import { savingRatePct } from "./insights.ts";

/**
 * Period report: income/expense/net + savings rate, category breakdown, and top
 * merchants. Reuses the same aggregation helpers as the dashboard so totals
 * reconcile exactly.
 */
export async function buildReport(
  db: Db,
  userId: string,
  period: ReportPeriod,
  key: string,
): Promise<Report> {
  const { from, to } = periodRange(period === "annual" ? "annual" : "monthly", key);
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
    period,
    periodKey: key,
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
