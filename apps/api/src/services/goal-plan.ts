import type { GoalPlan } from "@compass/shared";

/**
 * Goal asset-allocation planning: what equity/debt mix a goal *should* hold, and
 * the monthly investment that keeps it on track — the prescriptive counterpart to
 * goal-allocation.ts (which reports the *current* mix). Pure and DB-free so the
 * glide-path and split math are unit-testable; the weekly Autopilot goal review
 * and the goal progress endpoint both consume it.
 */

export interface AllocationTarget {
  equityPct: number;
  debtPct: number;
}

/** Current equity may drift this far from target before a rebalance is suggested. */
export const DRIFT_BAND_PCT = 10;

/**
 * Above this share, a goal is *majority* parked in "other" (cash/gold) rather than
 * its equity/debt target — a rebalance signal in its own right, even when the small
 * invested slice happens to match the target ratio. Only applied to goals that
 * should hold equity (target equity > 0): for an emergency fund or a sub-1-year
 * goal, sitting in cash *is* the right place, so "other" there is never flagged.
 */
export const OTHER_BAND_PCT = 50;

/**
 * Horizon-based glide path: the further a goal's target date, the more equity it
 * can carry (time to ride out volatility); as the date nears, it de-risks into
 * debt. Emergency funds stay fully liquid/debt regardless of horizon. An undated
 * goal can't glide, so it gets a balanced default.
 */
export function targetAllocation(goalType: string, monthsToTarget: number | null): AllocationTarget {
  if (goalType === "emergency_fund") return { equityPct: 0, debtPct: 100 };
  if (monthsToTarget === null) return { equityPct: 60, debtPct: 40 };
  const years = monthsToTarget / 12;
  if (years >= 10) return { equityPct: 75, debtPct: 25 };
  if (years >= 7) return { equityPct: 70, debtPct: 30 };
  if (years >= 5) return { equityPct: 60, debtPct: 40 };
  if (years >= 3) return { equityPct: 40, debtPct: 60 };
  if (years >= 1) return { equityPct: 20, debtPct: 80 };
  return { equityPct: 0, debtPct: 100 }; // under a year: protect capital
}

export interface GoalPlanInput {
  goalType: string;
  monthsToTarget: number | null;
  /** from the projection: null = undated goal, true/false = on/behind pace */
  onTrack: boolean | null;
  /** from the projection: monthly inflow needed to hit the target by its date */
  requiredMonthlyPaise: number | null;
  /** current equity share of *all* mapped assets, % (equity + debt + other = 100) */
  currentEquityPct: number;
  /** current debt share of *all* mapped assets, % */
  currentDebtPct: number;
  /** current "other" (cash/gold) share of *all* mapped assets, % */
  currentOtherPct: number;
  /** current market value of the mapped assets, paise */
  fundedPaise: number;
}

/** Equity share of just the equity+debt portion — the basis the target mix is on.
 * "Other" assets (cash, insurance, gold) don't count toward an equity/debt target,
 * so a balanced 60/40 diluted by cash must not read as underweight equity. */
export function equityShareOfInvestable(equityPct: number, debtPct: number): number {
  const investable = equityPct + debtPct;
  return investable > 0 ? (equityPct / investable) * 100 : 0;
}

/**
 * Build the recommended allocation and monthly investment split for a goal.
 * The proposed contribution is the projection's `requiredMonthlyPaise` divided
 * between equity and debt per the target mix.
 *
 * Drift (only when the goal is funded) fires on either of two conditions:
 *  1. the equity/debt *ratio* of the invested portion drifts past the band — a
 *     cash buffer alongside a balanced core doesn't distort this, since "other"
 *     is excluded from the ratio; but
 *  2. the goal is majority parked in "other" (cash/gold) when it should be
 *     invested (target equity > 0) — so a 10-year goal sitting 99% in cash is
 *     still flagged even though its tiny equity/debt slice can't drift.
 */
export function buildGoalPlan(input: GoalPlanInput): GoalPlan {
  const target = targetAllocation(input.goalType, input.monthsToTarget);
  const status: GoalPlan["status"] =
    input.onTrack === null ? "no_target" : input.onTrack ? "on_track" : "behind";

  const req = input.requiredMonthlyPaise;
  const monthlyEquityPaise = req && req > 0 ? Math.round((req * target.equityPct) / 100) : 0;
  // Derive debt from the remainder so the two halves always sum back to `req`.
  const monthlyDebtPaise = req && req > 0 ? req - monthlyEquityPaise : 0;

  const investablePct = input.currentEquityPct + input.currentDebtPct;
  const ratioDrifted =
    investablePct > 0 &&
    Math.abs(equityShareOfInvestable(input.currentEquityPct, input.currentDebtPct) - target.equityPct) >
      DRIFT_BAND_PCT;
  const overweightOther = target.equityPct > 0 && input.currentOtherPct > OTHER_BAND_PCT;
  const allocationDrifted = input.fundedPaise > 0 && (ratioDrifted || overweightOther);

  return {
    status,
    targetEquityPct: target.equityPct,
    targetDebtPct: target.debtPct,
    allocationDrifted,
    recommendedMonthlyPaise: req,
    monthlyEquityPaise,
    monthlyDebtPaise,
  };
}
