import { DRIFT_BAND_PCT, OTHER_BAND_PCT } from "./goal-plan.ts";
import type { GlideStep } from "./goal-plan.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftAnalysis {
  equityCurrentPaise: number;
  equityTargetPaise: number;
  debtCurrentPaise: number;
  debtTargetPaise: number;
  /** "equity" | "debt" | "none" */
  overweightLeg: "equity" | "debt" | "none";
  /** absolute magnitude of drift in paise; 0 when overweightLeg is "none" */
  driftPaise: number;
}

export interface ContributionRedirectionAction {
  type: "redirect_contributions";
  fromLeg: "equity" | "debt";
  toLeg: "equity" | "debt";
  /** monthly amount to redirect from the overweight leg's SIPs */
  monthlyAmountPaise: number;
  /** how many months until drift closes at this redirection rate */
  estimatedClosureMonths: number;
}

export interface CorpusSwitchAction {
  type: "switch_corpus";
  fromLeg: "equity" | "debt";
  toLeg: "equity" | "debt";
  amountPaise: number;
}

export type RebalancingAction = ContributionRedirectionAction | CorpusSwitchAction;

/**
 * One upcoming de-risking event derived from the glide-path schedule.
 * Fires when consecutive steps differ in equity allocation.
 */
export interface DeRiskingEvent {
  /** ISO date string — when the allocation shift takes effect */
  fromDate: string;
  fromEquityPct: number;
  fromDebtPct: number;
  toEquityPct: number;
  toDebtPct: number;
  /**
   * Estimated corpus switch amount (paise): the projected corpus at `fromDate`
   * × the absolute equity-percentage change / 100.
   * 0 when the projected corpus is zero.
   */
  equityToSwitchPaise: number;
}

export interface RebalancingPlanInput {
  /** Total current market value of goal-mapped assets, paise */
  fundedPaise: number;
  /** Current allocation — percentages out of 100; equity+debt+other=100 */
  currentEquityPct: number;
  currentDebtPct: number;
  /** Target allocation from targetAllocation() */
  targetEquityPct: number;
  targetDebtPct: number;
  /** Active equity SIPs committed to this goal, paise/month (used to size redirection) */
  currentEquitySipPaise: number;
  /** Active debt SIPs committed to this goal, paise/month */
  currentDebtSipPaise: number;
  /** Goal type — emergency funds never get corpus-switch actions */
  goalType: string;
  /** Glide-path steps from buildGlidePathSchedule (empty for emergency funds / undated) */
  glideSteps: GlideStep[];
}

export interface RebalancingPlan {
  drift: DriftAnalysis;
  /**
   * Ordered correction actions. Empty when drift is within the band or the
   * goal is an emergency fund.
   * If contribution redirection can close the gap in ≤ CONTRIBUTION_CORRECTION_MONTHS,
   * that action is listed; otherwise a corpus switch is listed.
   */
  actions: RebalancingAction[];
  /**
   * Upcoming planned de-risking events derived from the glide path.
   * Empty when glideSteps has fewer than 2 elements.
   */
  deRiskingSchedule: DeRiskingEvent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * If drift can be closed by redirecting contributions within this many months,
 * prefer redirection over a corpus switch (no tax event, no exit load).
 */
export const CONTRIBUTION_CORRECTION_MONTHS = 18;

// Re-export drift-band constants so callers have a single import point.
export { DRIFT_BAND_PCT, OTHER_BAND_PCT };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function buildRebalancingPlan(input: RebalancingPlanInput): RebalancingPlan {
  const {
    fundedPaise,
    currentEquityPct,
    currentDebtPct,
    targetEquityPct,
    targetDebtPct,
    currentEquitySipPaise,
    currentDebtSipPaise,
    goalType,
    glideSteps,
  } = input;

  // ── Drift analysis ──────────────────────────────────────────────────────

  const equityCurrentPaise = Math.round((fundedPaise * currentEquityPct) / 100);
  const debtCurrentPaise   = Math.round((fundedPaise * currentDebtPct) / 100);
  const equityTargetPaise  = Math.round((fundedPaise * targetEquityPct) / 100);
  const debtTargetPaise    = Math.round((fundedPaise * targetDebtPct) / 100);

  let overweightLeg: "equity" | "debt" | "none" = "none";
  let driftPaise = 0;

  if (equityCurrentPaise > equityTargetPaise) {
    overweightLeg = "equity";
    driftPaise = equityCurrentPaise - equityTargetPaise;
  } else if (debtCurrentPaise > debtTargetPaise) {
    overweightLeg = "debt";
    driftPaise = debtCurrentPaise - debtTargetPaise;
  }

  const drift: DriftAnalysis = {
    equityCurrentPaise,
    equityTargetPaise,
    debtCurrentPaise,
    debtTargetPaise,
    overweightLeg,
    driftPaise,
  };

  // ── Correction actions ───────────────────────────────────────────────────

  const actions: RebalancingAction[] = [];

  // Emergency funds: sitting in cash/debt is correct — never produce a switch.
  // For other goals: only act when the drift is outside the band.
  const isDrifted = overweightLeg !== "none" && driftPaise > 0 &&
    goalType !== "emergency_fund";

  if (isDrifted) {
    const fromLeg = overweightLeg as "equity" | "debt";
    const toLeg: "equity" | "debt" = fromLeg === "equity" ? "debt" : "equity";
    const availableMonthlyPaise =
      fromLeg === "equity" ? currentEquitySipPaise : currentDebtSipPaise;

    if (availableMonthlyPaise > 0) {
      const closureMonths = Math.ceil(driftPaise / availableMonthlyPaise);
      if (closureMonths <= CONTRIBUTION_CORRECTION_MONTHS) {
        actions.push({
          type: "redirect_contributions",
          fromLeg,
          toLeg,
          monthlyAmountPaise: availableMonthlyPaise,
          estimatedClosureMonths: closureMonths,
        });
      } else {
        actions.push({
          type: "switch_corpus",
          fromLeg,
          toLeg,
          amountPaise: driftPaise,
        });
      }
    } else {
      // No SIPs to redirect — must switch corpus
      actions.push({
        type: "switch_corpus",
        fromLeg,
        toLeg,
        amountPaise: driftPaise,
      });
    }
  }

  // ── De-risking schedule ──────────────────────────────────────────────────

  const deRiskingSchedule: DeRiskingEvent[] = [];

  for (let i = 0; i + 1 < glideSteps.length; i++) {
    const cur = glideSteps[i]!;
    const next = glideSteps[i + 1]!;
    if (cur.equityPct === next.equityPct && cur.debtPct === next.debtPct) continue;

    const equityChangePct = Math.abs(cur.equityPct - next.equityPct);
    const equityToSwitchPaise = Math.round(
      (next.projectedCorpusPaise * equityChangePct) / 100,
    );

    deRiskingSchedule.push({
      fromDate: next.fromDate,
      fromEquityPct: cur.equityPct,
      fromDebtPct: cur.debtPct,
      toEquityPct: next.equityPct,
      toDebtPct: next.debtPct,
      equityToSwitchPaise,
    });
  }

  return { drift, actions, deRiskingSchedule };
}
