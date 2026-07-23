import { sql } from "drizzle-orm";
import type { HealthScore, InsightCard, Insights } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { incomeExpense, periodRange, prevPeriodKey } from "./periods.ts";

// ---------- pure, tested helpers ----------

/** Savings rate as a percentage of income; 0 when there is no income. */
export function savingRatePct(incomePaise: number, expensePaise: number): number {
  if (incomePaise <= 0) return 0;
  return Math.round(((incomePaise - expensePaise) / incomePaise) * 1000) / 10;
}

/** Coefficient of variation (stddev / mean) — lower means steadier. */
export function coefficientOfVariation(values: number[]): number {
  const nonzero = values.filter((v) => v > 0);
  if (nonzero.length < 2) return 0;
  const mean = nonzero.reduce((s, v) => s + v, 0) / nonzero.length;
  if (mean === 0) return 0;
  const variance = nonzero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonzero.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Lifestyle-inflation drift: how much the recent 3-month average expense has
 * risen over the baseline of the months before it. Positive = spending creep.
 */
export function lifestyleInflationPct(monthlyExpenses: number[]): number {
  if (monthlyExpenses.length < 6) return 0;
  const recent = monthlyExpenses.slice(-3);
  const baseline = monthlyExpenses.slice(0, -3);
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const baseAvg = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  if (baseAvg <= 0) return 0;
  return Math.round(((recentAvg - baseAvg) / baseAvg) * 1000) / 10;
}

/**
 * Financial health score (0–100), documented weighted formula:
 *   • Savings rate (35%): 20%+ saved → full marks, linear below.
 *   • Emergency buffer (25%): months of expenses covered by cash, 6mo → full.
 *   • Debt load (20%): liabilities vs 6× monthly income, 0 debt → full.
 *   • Income stability (20%): 1 − coefficient of variation of monthly income.
 * Each component is clamped to 0–100; the score is their weighted sum.
 */
export function computeHealthScore(inputs: {
  savingRatePct: number;
  monthsBuffer: number;
  liabilitiesPaise: number;
  monthlyIncomePaise: number;
  incomeCV: number;
}): HealthScore {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const savings = clamp((inputs.savingRatePct / 20) * 100);
  const buffer = clamp((inputs.monthsBuffer / 6) * 100);
  const debtCapacity = inputs.monthlyIncomePaise * 6;
  const debt = debtCapacity <= 0
    ? (inputs.liabilitiesPaise > 0 ? 0 : 100)
    : clamp(100 - (inputs.liabilitiesPaise / debtCapacity) * 100);
  const stability = clamp((1 - inputs.incomeCV) * 100);

  const components = [
    { label: "Savings rate", score: Math.round(savings), weightPct: 35, detail: `${inputs.savingRatePct}% of income saved` },
    { label: "Emergency buffer", score: Math.round(buffer), weightPct: 25, detail: `${inputs.monthsBuffer.toFixed(1)} months of expenses in cash` },
    { label: "Debt load", score: Math.round(debt), weightPct: 20, detail: inputs.liabilitiesPaise > 0 ? "carrying card/loan balances" : "no outstanding debt" },
    { label: "Income stability", score: Math.round(stability), weightPct: 20, detail: inputs.incomeCV < 0.15 ? "very steady income" : "variable income" },
  ];
  const score = Math.round(components.reduce((s, c) => s + (c.score * c.weightPct) / 100, 0));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";
  return { score, grade, components };
}

// ---------- DB-backed assembly ----------

/** Trailing monthly income/expense series ending at (and including) `endKey`. */
async function monthlySeries(
  db: Db,
  userId: string,
  endKey: string,
  months: number,
): Promise<Array<{ month: string; incomePaise: number; expensePaise: number }>> {
  const out: Array<{ month: string; incomePaise: number; expensePaise: number }> = [];
  let key = endKey;
  const keys: string[] = [];
  for (let i = 0; i < months; i += 1) {
    keys.unshift(key);
    key = prevPeriodKey("monthly", key);
  }
  for (const k of keys) {
    const { from, to } = periodRange("monthly", k);
    const ie = await incomeExpense(db, userId, from, to);
    out.push({ month: k, incomePaise: ie.incomePaise, expensePaise: ie.expensePaise });
  }
  return out;
}

async function cashAndLiabilities(
  db: Db,
  userId: string,
  asOf: string,
): Promise<{ cashPaise: number; liabilitiesPaise: number }> {
  const res = await db.execute(sql`
    select a.type, coalesce(sum(a.opening_balance_paise + coalesce(t.total, 0)), 0)::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null
    group by a.type
  `);
  const byType = new Map((res.rows as Array<{ type: string; balance: string }>).map((r) => [r.type, Number(r.balance)]));
  const cash = (byType.get("bank") ?? 0) + (byType.get("cash") ?? 0);
  const liabilities =
    Math.max(0, -(byType.get("credit_card") ?? 0)) +
    Math.max(0, -(byType.get("loan") ?? 0)) +
    Math.max(0, -(byType.get("overdraft") ?? 0)) +
    Math.max(0, -(byType.get("home_loan_od") ?? 0));
  return { cashPaise: cash, liabilitiesPaise: liabilities };
}

async function topMerchants(
  db: Db,
  userId: string,
  from: string,
  to: string,
  limit: number,
): Promise<Array<{ merchant: string; spentPaise: number; n: number }>> {
  const res = await db.execute(sql`
    select t.merchant, coalesce(sum(-t.amount_paise), 0)::bigint as spent, count(*)::int as n
    from transactions t
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to} and t.amount_paise < 0 and t.merchant <> ''
      and not t.is_opening
      and not exists (select 1 from transfer_links tl where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    group by t.merchant order by spent desc limit ${limit}
  `);
  return (res.rows as Array<{ merchant: string; spent: string; n: number }>).map((r) => ({
    merchant: r.merchant,
    spentPaise: Number(r.spent),
    n: r.n,
  }));
}

export async function getInsights(db: Db, userId: string, periodKey: string): Promise<Insights> {
  const { from, to } = periodRange("monthly", periodKey);
  const series = await monthlySeries(db, userId, periodKey, 13); // 12 trailing + current
  const current = series[series.length - 1]!;
  const prevKey = prevPeriodKey("monthly", periodKey);
  const prev = series[series.length - 2] ?? { incomePaise: 0, expensePaise: 0, month: prevKey };

  const cards: InsightCard[] = [];
  const expenseSpark = series.slice(-6).map((m) => m.expensePaise);

  // saving rate
  const rate = savingRatePct(current.incomePaise, current.expensePaise);
  const prevRate = savingRatePct(prev.incomePaise, prev.expensePaise);
  cards.push({
    id: "saving-rate",
    kind: "saving_rate",
    title: "Savings rate",
    detail:
      rate >= 20
        ? `You saved ${rate}% of income this month — healthy.`
        : rate <= 0
          ? `You spent more than you earned this month.`
          : `You saved ${rate}% of income this month.`,
    sentiment: rate >= 20 ? "positive" : rate <= 0 ? "warning" : "neutral",
    valuePaise: current.incomePaise - current.expensePaise,
    deltaPct: prevRate !== 0 ? Math.round((rate - prevRate) * 10) / 10 : null,
    spark: series.slice(-6).map((m) => m.incomePaise - m.expensePaise),
    link: `/transactions?from=${from}&to=${to}`,
  });

  // largest expense
  const largest = await db.execute(sql`
    select t.id, t.merchant, -t.amount_paise as amt, t.date from transactions t
    where t.user_id = ${userId} and t.deleted_at is null and t.date >= ${from} and t.date <= ${to}
      and t.amount_paise < 0
      and not t.is_opening
      and not exists (select 1 from transfer_links tl where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    order by t.amount_paise asc limit 1
  `);
  const lg = largest.rows[0] as { id: string; merchant: string; amt: string; date: string } | undefined;
  if (lg) {
    cards.push({
      id: "largest-expense",
      kind: "largest_expense",
      title: "Largest expense",
      detail: `${lg.merchant || "Uncategorized"} on ${lg.date}`,
      sentiment: "neutral",
      valuePaise: Number(lg.amt),
      deltaPct: null,
      spark: [],
      link: `/transactions?from=${from}&to=${to}`,
    });
  }

  // top merchant by spend
  const merchants = await topMerchants(db, userId, from, to, 1);
  if (merchants[0]) {
    const m = merchants[0];
    cards.push({
      id: "top-merchant",
      kind: "top_merchant",
      title: "Top merchant",
      detail: `${m.merchant} — ${m.n} transaction${m.n === 1 ? "" : "s"} this month.`,
      sentiment: "neutral",
      valuePaise: m.spentPaise,
      deltaPct: null,
      spark: [],
      link: `/transactions?q=${encodeURIComponent(m.merchant)}`,
    });
  }

  // year-over-year expense
  const yoyKey = `${Number(periodKey.slice(0, 4)) - 1}${periodKey.slice(4)}`;
  const yoyRange = periodRange("monthly", yoyKey);
  const yoy = await incomeExpense(db, userId, yoyRange.from, yoyRange.to);
  if (yoy.expensePaise > 0) {
    const deltaPct = Math.round(((current.expensePaise - yoy.expensePaise) / yoy.expensePaise) * 1000) / 10;
    cards.push({
      id: "yoy",
      kind: "yoy",
      title: "Year over year",
      detail: `Spending is ${Math.abs(deltaPct)}% ${deltaPct >= 0 ? "higher" : "lower"} than ${yoyKey}.`,
      sentiment: deltaPct > 15 ? "warning" : "neutral",
      valuePaise: current.expensePaise,
      deltaPct,
      spark: expenseSpark,
      link: `/trends`,
    });
  }

  // income stability
  const incomeCV = coefficientOfVariation(series.slice(0, -1).map((m) => m.incomePaise));
  cards.push({
    id: "income-stability",
    kind: "income_stability",
    title: "Income stability",
    detail: incomeCV < 0.15 ? "Your income is very steady." : incomeCV < 0.4 ? "Your income varies moderately." : "Your income is quite variable.",
    sentiment: incomeCV < 0.15 ? "positive" : incomeCV < 0.4 ? "neutral" : "warning",
    valuePaise: null,
    deltaPct: Math.round(incomeCV * 1000) / 10,
    spark: series.slice(-6).map((m) => m.incomePaise),
    link: null,
  });

  // lifestyle inflation
  const inflation = lifestyleInflationPct(series.slice(0, -1).map((m) => m.expensePaise));
  if (Math.abs(inflation) >= 5) {
    cards.push({
      id: "lifestyle-inflation",
      kind: "lifestyle_inflation",
      title: "Lifestyle inflation",
      detail:
        inflation > 0
          ? `Your recent average spend is ${inflation}% above your earlier baseline.`
          : `Your recent average spend is ${Math.abs(inflation)}% below your earlier baseline.`,
      sentiment: inflation > 10 ? "warning" : "neutral",
      valuePaise: null,
      deltaPct: inflation,
      spark: expenseSpark,
      link: `/trends`,
    });
  }

  // health score
  const { cashPaise, liabilitiesPaise } = await cashAndLiabilities(db, userId, to);
  const avgExpense =
    series.slice(-3).reduce((s, m) => s + m.expensePaise, 0) / Math.max(1, series.slice(-3).length);
  const monthsBuffer = avgExpense > 0 ? cashPaise / avgExpense : 0;
  const avgIncome = series.slice(-3).reduce((s, m) => s + m.incomePaise, 0) / Math.max(1, series.slice(-3).length);
  const health = computeHealthScore({
    savingRatePct: rate,
    monthsBuffer,
    liabilitiesPaise,
    monthlyIncomePaise: avgIncome,
    incomeCV,
  });

  return { periodKey, health, cards };
}
