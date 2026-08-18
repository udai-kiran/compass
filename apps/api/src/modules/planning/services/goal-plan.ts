import type { GoalPlan } from "@compass/shared";

// ---------------------------------------------------------------------------
// Glide-path schedule — forward allocation from today to target date
// ---------------------------------------------------------------------------

/** Thresholds (months-before-target) where targetAllocation() changes band. */
const GLIDE_THRESHOLDS_MONTHS = [120, 84, 60, 36, 12] as const;

export interface GlideStep {
  /** ISO date string (YYYY-MM-DD) when this step's allocation takes effect */
  fromDate: string;
  /** ISO date string when the next step begins (== target date for the final step) */
  toDate: string;
  equityPct: number;
  debtPct: number;
  /** months remaining to target at the START of this step (integer) */
  monthsRemaining: number;
  /**
   * Monthly contribution needed to reach targetPaise from the projected corpus
   * at this step's start.  0 = already funded.  null = targetPaise was null.
   */
  requiredMonthlyPaise: number | null;
  /**
   * Current estimated corpus (paise) at the START of this step.
   * The first step's value equals `fundedPaise`; subsequent steps are the
   * projected corpus after growing the prior step's corpus through its duration.
   */
  projectedCorpusPaise: number;
}

export interface GlidePathInput {
  goalType: string;
  /** null → undated goal → returns [] */
  monthsToTarget: number | null;
  /** total target corpus, paise; null → requiredMonthlyPaise is null on each step */
  targetPaise: number | null;
  /** current corpus mapped to this goal, paise */
  fundedPaise: number;
  /** existing committed monthly inflow (SIPs), paise — used to project corpus forward */
  monthlyInflowPaise: number;
  equityReturnBps: number;
  debtReturnBps: number;
  /** defaults to new Date() — accept for testability */
  today?: Date;
}

/** Add an integer number of months to a Date, returning a new Date. */
function addMonthsToDate(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + Math.round(months));
  return r;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monthly rate from annual basis points. */
function monthlyRateFrom(annualBps: number): number {
  return (1 + annualBps / 10_000) ** (1 / 12) - 1;
}

/** Future value of `n` months of `monthly` contributions at monthly rate `rm`. */
function annuityFV(monthly: number, n: number, rm: number): number {
  if (monthly <= 0 || n <= 0) return 0;
  return Math.abs(rm) < 1e-9 ? monthly * n : monthly * (((1 + rm) ** n - 1) / rm);
}

/**
 * Required monthly contribution to grow `funded` to `target` in `n` months
 * at blended annual `annualBps`.  Returns 0 when already funded.
 */
function computeRequiredMonthlyPaise(
  funded: number,
  target: number,
  n: number,
  annualBps: number,
): number {
  if (n <= 0 || target <= 0) return 0;
  const rm = monthlyRateFrom(annualBps);
  const corpusFV = funded * (1 + annualBps / 10_000) ** (n / 12);
  if (corpusFV >= target) return 0;
  const factor = Math.abs(rm) < 1e-9 ? n : ((1 + rm) ** n - 1) / rm;
  return Math.max(0, Math.ceil((target - corpusFV) / factor));
}

/**
 * Produce the full forward allocation schedule for a goal from today to its
 * target date.  Returns [] for emergency funds and undated goals (no glide).
 *
 * Each step covers one allocation band.  The `requiredMonthlyPaise` per step
 * projects the current corpus forward to that step's start (using the step's
 * blended return + the existing committed monthly inflow) and then computes
 * the additional monthly needed to reach `targetPaise` in the remaining months.
 */
export function buildGlidePathSchedule(input: GlidePathInput): GlideStep[] {
  const { goalType, monthsToTarget, targetPaise, fundedPaise, monthlyInflowPaise,
    equityReturnBps, debtReturnBps } = input;
  const today = input.today ?? new Date();

  // No schedule for emergency funds or undated goals.
  if (goalType === "emergency_fund" || monthsToTarget === null) return [];

  // Build the list of distinct allocation bands from today to the target.
  // At each threshold T (months-before-target), the transition INTO the next
  // lower-equity band happens when remaining drops BELOW T.  The new allocation
  // is targetAllocation(T - 1) — one month inside the threshold — which matches
  // the band that applies when remaining < T.  Only add a band when the
  // allocation actually changes (deduplicate thresholds that don't shift the mix
  // for this particular starting horizon, e.g. T=84 for a 90-month goal still
  // starts in the 70/30 band — the real change is at T=60).
  type Band = { offset: number; remaining: number; equityPct: number; debtPct: number };

  const startAlloc = targetAllocation(goalType, monthsToTarget);
  const bands: Band[] = [{
    offset: 0,
    remaining: monthsToTarget,
    equityPct: startAlloc.equityPct,
    debtPct: startAlloc.debtPct,
  }];

  let prevEquity = startAlloc.equityPct;
  let prevDebt = startAlloc.debtPct;

  for (const T of GLIDE_THRESHOLDS_MONTHS) {
    if (T >= monthsToTarget) continue;
    const newAlloc = targetAllocation(goalType, T - 1); // allocation inside the threshold
    if (newAlloc.equityPct !== prevEquity || newAlloc.debtPct !== prevDebt) {
      bands.push({
        offset: monthsToTarget - T,
        remaining: T,
        equityPct: newAlloc.equityPct,
        debtPct: newAlloc.debtPct,
      });
      prevEquity = newAlloc.equityPct;
      prevDebt = newAlloc.debtPct;
    }
  }

  // Convert bands to steps, projecting the corpus forward through each.
  const steps: GlideStep[] = [];
  let corpusAtStep = fundedPaise;

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const nextOffset = i + 1 < bands.length ? bands[i + 1]!.offset : monthsToTarget;
    const stepDuration = nextOffset - band.offset;
    const total = band.equityPct + band.debtPct || 100;
    const blendedBps = Math.round((band.equityPct * equityReturnBps + band.debtPct * debtReturnBps) / total);

    const fromDate = toISODate(addMonthsToDate(today, band.offset));
    const toDate = toISODate(addMonthsToDate(today, nextOffset));

    let req: number | null = null;
    if (targetPaise !== null) {
      req = computeRequiredMonthlyPaise(corpusAtStep, targetPaise, band.remaining, blendedBps);
    }

    const corpusAtStepStart = corpusAtStep; // snapshot before projection
    steps.push({
      fromDate, toDate,
      equityPct: band.equityPct, debtPct: band.debtPct,
      monthsRemaining: band.remaining,
      requiredMonthlyPaise: req,
      projectedCorpusPaise: corpusAtStepStart,
    });

    // Project corpus to next step.
    const rm = monthlyRateFrom(blendedBps);
    corpusAtStep =
      corpusAtStep * (1 + blendedBps / 10_000) ** (stepDuration / 12) +
      annuityFV(monthlyInflowPaise, stepDuration, rm);
  }

  return steps;
}

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
  /** sum of the goal's active SIPs funding equity targets, paise/month */
  committedEquityPaise: number;
  /** sum of the goal's active SIPs funding debt targets, paise/month */
  committedDebtPaise: number;
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
 * between equity and debt per the target mix. `committedEquityPaise` /
 * `committedDebtPaise` (the goal's active SIPs, split by target) are compared
 * against that split to report the gap — what the SIPs don't yet cover, floored
 * at 0 per leg (an over-committed SIP doesn't produce a negative "gap").
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

  const committedEquityPaise = Math.max(0, input.committedEquityPaise);
  const committedDebtPaise = Math.max(0, input.committedDebtPaise);
  const committedMonthlyPaise = committedEquityPaise + committedDebtPaise;
  const gapEquityPaise = Math.max(0, monthlyEquityPaise - committedEquityPaise);
  const gapDebtPaise = Math.max(0, monthlyDebtPaise - committedDebtPaise);

  return {
    status,
    targetEquityPct: target.equityPct,
    targetDebtPct: target.debtPct,
    allocationDrifted,
    recommendedMonthlyPaise: req,
    monthlyEquityPaise,
    monthlyDebtPaise,
    committedMonthlyPaise,
    committedEquityPaise,
    committedDebtPaise,
    gapMonthlyPaise: gapEquityPaise + gapDebtPaise,
    gapEquityPaise,
    gapDebtPaise,
  };
}
