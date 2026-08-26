/**
 * windfall-allocator.ts — Windfall allocation engine (task 15.2).
 *
 * Routes a one-off lump sum through the multi-goal allocation engine and
 * compares competing uses: emergency fund, high-interest debt, loan prepayment,
 * or goal investment — expressed as months pulled forward per goal.
 *
 * Pure — no DB, no clock. Deterministic, integer paise throughout.
 */

import { findTenureForEmi } from "../../credit/services/prepay-vs-invest.ts";
import { amortize } from "../../credit/services/emis.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WindfallGoalInput {
  id: string;
  name: string;
  goalType: string;
  monthsToTarget: number | null;
  targetPaise: number | null;
  fundedPaise: number;
  blendedReturnBps: number;
  requiredMonthlyPaise: number | null;
  sortOrder: number;
}

export interface WindfallEmiInput {
  templateId: string;
  name: string;
  outstandingPaise: number;
  annualRateBps: number;
  installmentPaise: number;
  remainingInstallments: number;
}

export interface WindfallInput {
  windfallPaise: number;
  goals: WindfallGoalInput[];
  emis: WindfallEmiInput[];
  highInterestDebtPaise: number;
  /** Whether the windfall itself is taxable (e.g. bonus vs gift) */
  isWindfallTaxable: boolean;
}

export interface WindfallGoalImpact {
  goalId: string;
  goalName: string;
  goalType: string;
  allocatedPaise: number;
  monthsPulledForward: number | null;
  reason: string;
}

export interface WindfallDebtOption {
  emiTemplateId: string;
  emiName: string;
  outstandingPaise: number;
  annualRateBps: number;
  interestSavedPaise: number;
  tenureSavedInstallments: number;
}

export interface WindfallAllocationResult {
  windfallPaise: number;
  emergencyFundTopUp: WindfallGoalImpact | null;
  highInterestDebtPayoff: { totalRevolvingPaise: number; allocatedPaise: number } | null;
  debtPrepayOptions: WindfallDebtOption[];
  goalAllocations: WindfallGoalImpact[];
  unallocatedPaise: number;
  recommendation: "emergency_fund_first" | "clear_revolving_debt" | "mixed_allocation" | "invest_in_goals" | "no_goals";
  recommendationSummary: string;
  assumptions: string[];
  taxNote: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Effective monthly rate from annual BPS. */
function monthlyRate(annualBps: number): number {
  return (1 + annualBps / 10_000) ** (1 / 12) - 1;
}

/**
 * How many months a lump-sum top-up pulls a goal forward vs its current trajectory.
 * Returns null if goal has no target or is unreachable.
 */
function monthsPulledForward(
  fundedPaise: number,
  targetPaise: number | null,
  monthsToTarget: number | null,
  blendedReturnBps: number,
  requiredMonthlyPaise: number | null,
  topUpPaise: number,
): number | null {
  if (targetPaise === null || monthsToTarget === null) return null;
  if (fundedPaise >= targetPaise) return 0;

  const rm = monthlyRate(blendedReturnBps);
  const monthly = requiredMonthlyPaise ?? 0;

  // Months to target WITHOUT the top-up
  const monthsWithout = estimateMonths(fundedPaise, targetPaise, monthly, rm);
  // Months to target WITH the top-up
  const monthsWith = estimateMonths(fundedPaise + topUpPaise, targetPaise, monthly, rm);

  if (monthsWithout === null) return null;
  if (monthsWith === null) return null;

  return Math.max(0, Math.round(monthsWithout - monthsWith));
}

/** Binary search for months to reach target. */
function estimateMonths(
  corpus: number,
  target: number,
  monthly: number,
  rm: number,
): number | null {
  if (corpus >= target) return 0;

  const fvAt = (T: number): number => {
    const compound = (1 + rm) ** T;
    const corpusFV = corpus * compound;
    const annuityFV = Math.abs(rm) < 1e-9 ? monthly * T : (monthly * (compound - 1)) / rm;
    return corpusFV + annuityFV;
  };

  const hi = 12000;
  if (fvAt(hi) < target) return null;

  let lo = 0;
  let hiSearch = hi;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hiSearch) / 2;
    if (fvAt(mid) >= target) hiSearch = mid;
    else lo = mid;
    if (hiSearch - lo < 0.5) break;
  }
  return hiSearch;
}

/**
 * Compute interest saved and tenure reduction from prepaying a lump sum on a loan.
 */
function computeDebtPrepayOption(emi: WindfallEmiInput, lumpSumPaise: number): WindfallDebtOption {
  const newOutstanding = Math.max(0, emi.outstandingPaise - lumpSumPaise);

  // Baseline remaining interest
  const baseline = amortize(
    emi.outstandingPaise, emi.annualRateBps,
    emi.installmentPaise, emi.remainingInstallments, 0,
  );

  if (newOutstanding === 0) {
    return {
      emiTemplateId: emi.templateId,
      emiName: emi.name,
      outstandingPaise: emi.outstandingPaise,
      annualRateBps: emi.annualRateBps,
      interestSavedPaise: baseline.totalInterestPaise,
      tenureSavedInstallments: emi.remainingInstallments,
    };
  }

  const newTenure = findTenureForEmi(newOutstanding, emi.annualRateBps, emi.installmentPaise);
  const afterPrepay = amortize(
    newOutstanding, emi.annualRateBps,
    emi.installmentPaise, newTenure, 0,
  );

  return {
    emiTemplateId: emi.templateId,
    emiName: emi.name,
    outstandingPaise: emi.outstandingPaise,
    annualRateBps: emi.annualRateBps,
    interestSavedPaise: baseline.totalInterestPaise - afterPrepay.totalInterestPaise,
    tenureSavedInstallments: emi.remainingInstallments - newTenure,
  };
}

// ── Main allocation ───────────────────────────────────────────────────────────

export function allocateWindfall(input: WindfallInput): WindfallAllocationResult {
  const { windfallPaise, goals, emis, highInterestDebtPaise, isWindfallTaxable } = input;
  let remaining = windfallPaise;

  const assumptions: string[] = [];
  let emergencyFundTopUp: WindfallGoalImpact | null = null;
  let highInterestDebtPayoff: WindfallAllocationResult["highInterestDebtPayoff"] = null;
  const goalAllocations: WindfallGoalImpact[] = [];

  // ── Step 1: Emergency fund ──────────────────────────────────────────────
  const emergencyGoal = goals.find((g) => g.goalType === "emergency_fund");
  if (emergencyGoal && emergencyGoal.targetPaise !== null && emergencyGoal.fundedPaise < emergencyGoal.targetPaise) {
    const shortfall = emergencyGoal.targetPaise - emergencyGoal.fundedPaise;
    const allocated = Math.min(remaining, shortfall);
    remaining -= allocated;

    emergencyFundTopUp = {
      goalId: emergencyGoal.id,
      goalName: emergencyGoal.name,
      goalType: emergencyGoal.goalType,
      allocatedPaise: allocated,
      monthsPulledForward: null, // emergency fund is a threshold, not a timeline goal
      reason: allocated >= shortfall
        ? "Tops up emergency fund to its target."
        : `Partially tops up emergency fund (${shortfall - allocated} paise shortfall remains).`,
    };
  }

  // ── Step 2: High-interest revolving debt ────────────────────────────────
  if (highInterestDebtPaise > 0 && remaining > 0) {
    const allocated = Math.min(remaining, highInterestDebtPaise);
    remaining -= allocated;
    highInterestDebtPayoff = {
      totalRevolvingPaise: highInterestDebtPaise,
      allocatedPaise: allocated,
    };
  }

  // ── Step 3: Debt prepayment options (informational, not deducted) ───────
  const debtPrepayOptions: WindfallDebtOption[] = emis
    .filter((e) => e.outstandingPaise > 0)
    .map((e) => computeDebtPrepayOption(e, remaining))
    .sort((a, b) => b.interestSavedPaise - a.interestSavedPaise);

  // ── Step 4: Goal allocation — proportional to funding gap ───────────────
  // Unlike monthly surplus allocation (which caps at requiredMonthlyPaise),
  // a windfall is a lump sum distributed proportionally across each goal's
  // remaining funding gap (target − funded). Goals without a target or
  // already fully funded get nothing.
  const nonEmergencyGoals = goals.filter((g) => g.goalType !== "emergency_fund");
  if (nonEmergencyGoals.length > 0 && remaining > 0) {
    const goalsWithGap = nonEmergencyGoals
      .filter((g) => g.targetPaise !== null && g.fundedPaise < g.targetPaise)
      .map((g) => ({ goal: g, gap: g.targetPaise! - g.fundedPaise }));

    const totalGap = goalsWithGap.reduce((s, g) => s + g.gap, 0);

    if (totalGap > 0) {
      // Distribute proportionally, capped at each goal's gap
      let distributed = 0;
      for (const { goal, gap } of goalsWithGap) {
        const share = Math.min(gap, Math.round((gap / totalGap) * remaining));
        if (share <= 0) continue;

        const pulled = monthsPulledForward(
          goal.fundedPaise, goal.targetPaise, goal.monthsToTarget,
          goal.blendedReturnBps, goal.requiredMonthlyPaise,
          share,
        );

        goalAllocations.push({
          goalId: goal.id,
          goalName: goal.name,
          goalType: goal.goalType,
          allocatedPaise: share,
          monthsPulledForward: pulled,
          reason: pulled !== null && pulled > 0
            ? `Pulls this goal forward by ${pulled} months.`
            : "Contributes toward this goal.",
        });

        distributed += share;
      }
      remaining -= distributed;
    }
  }

  // ── Recommendation ──────────────────────────────────────────────────────
  let recommendation: WindfallAllocationResult["recommendation"];
  let recommendationSummary: string;

  if (emergencyFundTopUp && emergencyFundTopUp.allocatedPaise === windfallPaise) {
    recommendation = "emergency_fund_first";
    recommendationSummary = "The entire windfall should go to your emergency fund, which is below its target.";
  } else if (highInterestDebtPayoff && highInterestDebtPayoff.allocatedPaise > 0) {
    recommendation = "clear_revolving_debt";
    recommendationSummary = "Priority: clear high-interest revolving debt before optimising other allocations.";
  } else if (goals.length === 0 || (nonEmergencyGoals.length === 0 && !emergencyFundTopUp)) {
    recommendation = "no_goals";
    recommendationSummary = "No goals are set up. Consider creating goals to guide allocation of this windfall.";
  } else if (goalAllocations.length > 1 || (emergencyFundTopUp && goalAllocations.length > 0)) {
    recommendation = "mixed_allocation";
    recommendationSummary = "The windfall is split across multiple priorities — emergency fund, debt, and goals.";
  } else {
    recommendation = "invest_in_goals";
    recommendationSummary = "The windfall can be directed toward your investment goals.";
  }

  // ── Assumptions ─────────────────────────────────────────────────────────
  assumptions.push(
    "Emergency fund and high-interest debt are prioritised ahead of goal optimisation.",
    "Months pulled forward are estimates based on current return assumptions.",
    "Debt prepay options show interest saved via tenure reduction (the more efficient strategy).",
  );

  // ── Tax note ────────────────────────────────────────────────────────────
  let taxNote: string | null = null;
  if (isWindfallTaxable) {
    taxNote = "This windfall may be taxable (e.g. bonus, arrears). " +
      "The allocation amounts shown are pre-tax — set aside an appropriate portion for tax.";
  }

  return {
    windfallPaise,
    emergencyFundTopUp,
    highInterestDebtPayoff,
    debtPrepayOptions,
    goalAllocations,
    unallocatedPaise: Math.max(0, remaining),
    recommendation,
    recommendationSummary,
    assumptions,
    taxNote,
  };
}
