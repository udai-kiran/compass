import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { recurringTemplates, sips } from "../../../db/schema.ts";
import { LIABILITY_TYPES_SQL } from "../../../lib/periods.ts";
import { hasCategoryDimension } from "../../../lib/ledger-sql.ts";

export interface MonthlyIncome {
  /** "YYYY-MM" period key */
  month: string;
  /** gross income postings that month, paise */
  incomePaise: number;
  /** whether this month looks like a bonus month (income > 2× median of other months) */
  likelyBonus: boolean;
}

export interface CommittedOutflow {
  /** normalised to monthly paise (approximate for non-monthly frequencies) */
  monthlyPaise: number;
  kind: "recurring" | "sip";
  label: string;
}

export interface IncomeSurplusResult {
  /** months of history available */
  historyMonths: number;
  /** monthly income data, oldest first */
  months: MonthlyIncome[];
  /** monthly recurring outflows (recurring_templates + active SIPs) */
  committedOutflows: CommittedOutflow[];
  /** sum of committed outflow monthlyPaise */
  totalCommittedPaise: number;
  /**
   * Conservative surplus: median non-bonus monthly income minus total committed outflows.
   * null when historyMonths < 3.
   */
  conservativeSurplusPaise: number | null;
  /**
   * Optimistic surplus: 75th-percentile non-bonus monthly income minus total committed outflows.
   * null when historyMonths < 3.
   */
  optimisticSurplusPaise: number | null;
  /**
   * "low" when < 6 months history; "medium" when 6–11 months; "high" when ≥ 12 months.
   */
  confidence: "low" | "medium" | "high";
}

export interface IncomeSurplusComputation {
  months: MonthlyIncome[];
  committedOutflows: CommittedOutflow[];
}

/** Linear interpolation percentile over a sorted array. p is 0–100. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * Computes surplus statistics from pre-fetched monthly income data and committed
 * outflows. Pure function — no DB access. Exported for unit testing.
 */
export function computeIncomeSurplus(
  data: IncomeSurplusComputation,
): Omit<IncomeSurplusResult, "months" | "committedOutflows"> {
  const { months, committedOutflows } = data;
  const historyMonths = months.length;

  const totalCommittedPaise = committedOutflows.reduce((s, o) => s + o.monthlyPaise, 0);

  const confidence: "low" | "medium" | "high" =
    historyMonths >= 12 ? "high" : historyMonths >= 6 ? "medium" : "low";

  if (historyMonths < 3) {
    return {
      historyMonths,
      totalCommittedPaise,
      conservativeSurplusPaise: null,
      optimisticSurplusPaise: null,
      confidence,
    };
  }

  const nonBonusIncomes = months
    .filter((m) => !m.likelyBonus)
    .map((m) => m.incomePaise)
    .sort((a, b) => a - b);

  const medianIncome = percentile(nonBonusIncomes, 50);
  const p75Income = percentile(nonBonusIncomes, 75);

  return {
    historyMonths,
    totalCommittedPaise,
    conservativeSurplusPaise: Math.round(medianIncome) - totalCommittedPaise,
    optimisticSurplusPaise: Math.round(p75Income) - totalCommittedPaise,
    confidence,
  };
}

/** Add N months to a "YYYY-MM" key. */
function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → "YYYY-MM-DD" last day of that month. */
function lastDayOf(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Compute monthly income and investable surplus from the user's ledger.
 *
 * @param lookbackMonths Number of calendar months to look back (default 12).
 */
export async function getIncomeSurplus(
  db: Db,
  userId: string,
  lookbackMonths = 12,
): Promise<IncomeSurplusResult> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Current month key e.g. "2026-08"
  const currentMonth = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;

  // Oldest month in the window (lookbackMonths - 1 months before current)
  const startMonth = addMonths(currentMonth, -(lookbackMonths - 1));
  const from = `${startMonth}-01`;
  const to = lastDayOf(currentMonth);

  // Step 1 — query monthly income from ledger
  const incomeRes = await db.execute(sql`
    select to_char(t.date, 'YYYY-MM') as month,
      coalesce(sum(case when p.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL})
        then p.amount_paise else 0 end), 0)::bigint as income
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and a.system_kind is null
      and ${hasCategoryDimension()}
    group by 1
    order by 1
  `);

  // Build a map from the DB result
  const incomeByMonth = new Map<string, number>();
  for (const row of incomeRes.rows as Array<{ month: string; income: string }>) {
    const income = Number(row.income);
    incomeByMonth.set(row.month, income);
  }

  // Fill in all months, including those with 0 income
  const rawMonths: Array<{ month: string; incomePaise: number }> = [];
  for (let i = 0; i < lookbackMonths; i++) {
    const key = addMonths(startMonth, i);
    rawMonths.push({ month: key, incomePaise: incomeByMonth.get(key) ?? 0 });
  }

  // Step 2 — bonus detection: a month is bonus if income > 2× median of other months
  const incomeValues = rawMonths.map((m) => m.incomePaise);
  const months: MonthlyIncome[] = rawMonths.map((m, idx) => {
    const others = incomeValues.filter((_, j) => j !== idx).sort((a, b) => a - b);
    const otherMedian = percentile(others, 50);
    const likelyBonus = otherMedian > 0 && m.incomePaise > 2 * otherMedian;
    return { month: m.month, incomePaise: m.incomePaise, likelyBonus };
  });

  // Step 3a — active recurring templates
  const templates = await db
    .select({
      merchant: recurringTemplates.merchant,
      amountPaise: recurringTemplates.amountPaise,
      frequency: recurringTemplates.frequency,
      interval: recurringTemplates.interval,
    })
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.userId, userId),
        isNull(recurringTemplates.pausedAt),
        or(isNull(recurringTemplates.endDate), gte(recurringTemplates.endDate, todayStr)),
      ),
    );

  const committedOutflows: CommittedOutflow[] = [];

  for (const t of templates) {
    let monthlyPaise: number;
    switch (t.frequency) {
      case "daily":
        monthlyPaise = t.amountPaise * 30;
        break;
      case "weekly":
        monthlyPaise = t.amountPaise * 4;
        break;
      case "monthly":
        monthlyPaise = t.interval === 1 ? t.amountPaise : Math.floor(t.amountPaise / t.interval);
        break;
      case "yearly":
        monthlyPaise = Math.floor(t.amountPaise / 12);
        break;
      default:
        monthlyPaise = t.amountPaise;
    }
    committedOutflows.push({ monthlyPaise, kind: "recurring", label: t.merchant });
  }

  // Step 3b — active SIPs (skip payroll-funded ones)
  const activeSips = await db
    .select({
      amountPaise: sips.amountPaise,
      frequency: sips.frequency,
      fundingSource: sips.fundingSource,
      goalId: sips.goalId,
    })
    .from(sips)
    .where(
      and(
        eq(sips.userId, userId),
        eq(sips.status, "active"),
        or(isNull(sips.endDate), gte(sips.endDate, todayStr)),
      ),
    );

  for (const s of activeSips) {
    if (s.fundingSource === "payroll") continue;
    let monthlyPaise: number;
    switch (s.frequency) {
      case "monthly":
        monthlyPaise = s.amountPaise;
        break;
      case "quarterly":
        monthlyPaise = Math.floor(s.amountPaise / 3);
        break;
      case "yearly":
        monthlyPaise = Math.floor(s.amountPaise / 12);
        break;
      default:
        monthlyPaise = s.amountPaise;
    }
    committedOutflows.push({ monthlyPaise, kind: "sip", label: `SIP (goal ${s.goalId})` });
  }

  const computation = computeIncomeSurplus({ months, committedOutflows });

  return {
    ...computation,
    months,
    committedOutflows,
  };
}
