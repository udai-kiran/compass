/**
 * Income adequacy & lever advisor (Task 6.5).
 *
 * Pure service — no DB, no Fastify, no clock calls.
 *
 * Given a shortfall between what goals need and what the surplus provides,
 * it quantifies 4 actionable levers and returns a structured report.
 */

export interface UnderfundedGoal {
  goalId: string;
  goalName: string;
  monthsToTarget: number | null;
  targetPaise: number | null;
  fundedPaise: number;
  blendedReturnBps: number;
  allocatedMonthlyPaise: number; // what the multi-goal engine allocated
  shortfallPaise: number; // required - allocated (>= 0)
  slipMonths: number | null; // from GoalAllocationResult
}

export interface CategorySpend {
  categoryName: string;
  monthlyPaise: number;
}

export interface ExtendTimelineLever {
  type: "extend_timeline";
  perGoal: Array<{
    goalId: string;
    goalName: string;
    originalMonthsToTarget: number | null;
    /** originalMonthsToTarget + slipMonths; null if unreachable (slipMonths===null) */
    newMonthsToTarget: number | null;
    slipMonths: number | null;
  }>;
}

export interface ReduceTargetLever {
  type: "reduce_target";
  perGoal: Array<{
    goalId: string;
    goalName: string;
    originalTargetPaise: number | null;
    /** FV at allocatedMonthlyPaise over original horizon; null if monthsToTarget/targetPaise null */
    achievableTargetPaise: number | null;
    /** (originalTarget - achievable) / originalTarget × 100; null if either is null */
    reductionPct: number | null;
  }>;
}

export interface CutExpensesLever {
  type: "cut_expenses";
  /** shortfall = sum of all goals' shortfallPaise */
  requiredMonthlyReductionPaise: number;
  /** Ranked by monthlyPaise desc; only present if topExpenseCategories was passed */
  opportunities: Array<{
    categoryName: string;
    monthlySpendPaise: number;
    /** monthlySpendPaise / requiredMonthlyReductionPaise × 100 — how much of the gap this covers */
    coversPct: number;
  }>;
}

export interface IncomeIncreaseLever {
  type: "increase_income";
  requiredMonthlyIncreasePaise: number;
  /** requiredMonthlyIncreasePaise / medianMonthlyIncomePaise × 100; 0 if medianMonthlyIncomePaise <= 0 */
  pctOfCurrentIncome: number;
}

export type AdequacyLever =
  | ExtendTimelineLever
  | ReduceTargetLever
  | CutExpensesLever
  | IncomeIncreaseLever;

export interface IncomeAdequacyInput {
  underfundedGoals: UnderfundedGoal[];
  conservativeSurplusPaise: number | null;
  optimisticSurplusPaise: number | null;
  medianMonthlyIncomePaise: number;
  topExpenseCategories?: CategorySpend[];
}

export interface IncomeAdequacyReport {
  totalShortfallPaise: number;
  hasShortfall: boolean;
  conservativeSurplusPaise: number | null;
  optimisticSurplusPaise: number | null;
  levers: AdequacyLever[]; // empty when hasShortfall=false
}

/** Effective monthly rate from an annual rate in basis points. */
function monthlyRate(annualBps: number): number {
  return (1 + annualBps / 10_000) ** (1 / 12) - 1;
}

/**
 * Future value of a lump-sum + regular contributions after n months.
 *   FV = funded × (1+r)^n + monthly × ((1+r)^n - 1) / r
 * Falls back to simple addition when r ≈ 0.
 */
function futureValue(
  fundedPaise: number,
  monthlyPaise: number,
  n: number,
  r: number,
): number {
  if (Math.abs(r) < 1e-9) {
    return fundedPaise + monthlyPaise * n;
  }
  const compound = (1 + r) ** n;
  return fundedPaise * compound + monthlyPaise * ((compound - 1) / r);
}

function buildExtendTimelineLever(
  underfundedGoals: UnderfundedGoal[],
): ExtendTimelineLever {
  const perGoal = underfundedGoals
    .filter(
      (g) => (g.slipMonths !== null && g.slipMonths > 0) || g.slipMonths === null,
    )
    .map((g) => ({
      goalId: g.goalId,
      goalName: g.goalName,
      originalMonthsToTarget: g.monthsToTarget,
      newMonthsToTarget:
        g.slipMonths === null
          ? null
          : g.monthsToTarget !== null
            ? g.monthsToTarget + g.slipMonths
            : null,
      slipMonths: g.slipMonths,
    }));

  return { type: "extend_timeline", perGoal };
}

function buildReduceTargetLever(
  underfundedGoals: UnderfundedGoal[],
): ReduceTargetLever {
  const perGoal = underfundedGoals.map((g) => {
    if (g.monthsToTarget === null || g.targetPaise === null) {
      return {
        goalId: g.goalId,
        goalName: g.goalName,
        originalTargetPaise: g.targetPaise,
        achievableTargetPaise: null as number | null,
        reductionPct: null as number | null,
      };
    }

    if (g.fundedPaise >= g.targetPaise) {
      return {
        goalId: g.goalId,
        goalName: g.goalName,
        originalTargetPaise: g.targetPaise,
        achievableTargetPaise: g.targetPaise,
        reductionPct: 0,
      };
    }

    const r = monthlyRate(g.blendedReturnBps);
    const fv = futureValue(g.fundedPaise, g.allocatedMonthlyPaise, g.monthsToTarget, r);
    const achievable = Math.round(Math.max(0, fv));

    const reductionPct =
      g.targetPaise > 0
        ? Math.round(((g.targetPaise - achievable) / g.targetPaise) * 100 * 10) / 10
        : null;

    return {
      goalId: g.goalId,
      goalName: g.goalName,
      originalTargetPaise: g.targetPaise,
      achievableTargetPaise: achievable,
      reductionPct,
    };
  });

  return { type: "reduce_target", perGoal };
}

function buildCutExpensesLever(
  totalShortfallPaise: number,
  topExpenseCategories?: CategorySpend[],
): CutExpensesLever {
  if (!topExpenseCategories || topExpenseCategories.length === 0) {
    return {
      type: "cut_expenses",
      requiredMonthlyReductionPaise: totalShortfallPaise,
      opportunities: [],
    };
  }

  const sorted = [...topExpenseCategories].sort(
    (a, b) => b.monthlyPaise - a.monthlyPaise,
  );

  const opportunities = sorted.map((c) => ({
    categoryName: c.categoryName,
    monthlySpendPaise: c.monthlyPaise,
    coversPct:
      totalShortfallPaise > 0
        ? Math.round((c.monthlyPaise / totalShortfallPaise) * 100)
        : 0,
  }));

  return {
    type: "cut_expenses",
    requiredMonthlyReductionPaise: totalShortfallPaise,
    opportunities,
  };
}

function buildIncomeIncreaseLever(
  totalShortfallPaise: number,
  medianMonthlyIncomePaise: number,
): IncomeIncreaseLever {
  const pctOfCurrentIncome =
    medianMonthlyIncomePaise > 0
      ? Math.round((totalShortfallPaise / medianMonthlyIncomePaise) * 100 * 10) / 10
      : 0;

  return {
    type: "increase_income",
    requiredMonthlyIncreasePaise: totalShortfallPaise,
    pctOfCurrentIncome,
  };
}

export function buildIncomeAdequacyReport(
  input: IncomeAdequacyInput,
): IncomeAdequacyReport {
  const {
    underfundedGoals,
    conservativeSurplusPaise,
    optimisticSurplusPaise,
    medianMonthlyIncomePaise,
    topExpenseCategories,
  } = input;

  const totalShortfallPaise = underfundedGoals.reduce(
    (sum, g) => sum + g.shortfallPaise,
    0,
  );

  const hasShortfall = totalShortfallPaise > 0;

  if (!hasShortfall) {
    return {
      totalShortfallPaise,
      hasShortfall: false,
      conservativeSurplusPaise,
      optimisticSurplusPaise,
      levers: [],
    };
  }

  const levers: AdequacyLever[] = [
    buildExtendTimelineLever(underfundedGoals),
    buildReduceTargetLever(underfundedGoals),
    buildCutExpensesLever(totalShortfallPaise, topExpenseCategories),
    buildIncomeIncreaseLever(totalShortfallPaise, medianMonthlyIncomePaise),
  ];

  return {
    totalShortfallPaise,
    hasShortfall: true,
    conservativeSurplusPaise,
    optimisticSurplusPaise,
    levers,
  };
}
