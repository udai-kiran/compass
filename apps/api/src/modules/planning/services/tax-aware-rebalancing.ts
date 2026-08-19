import type { RebalancingPlan, CorpusSwitchAction } from "./rebalancing-plan.ts";
import type { InstrumentCategory, InstrumentRule } from "../../../lib/instrument-rules.ts";
import { getInstrumentRule } from "../../../lib/instrument-rules.ts";

/** Budget 2024: annual LTCG exemption raised to ₹1.25L = 1_25_00_000 paise */
export const LTCG_ANNUAL_EXEMPTION_PAISE = 1_25_00_000;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Pre-computed gain data for a prospective switch in the overweight leg.
 * The caller (DB-backed route) runs realizeGains per holding and aggregates
 * these values before calling buildTaxAwareRebalancingPlan.
 */
export interface SwitchGainData {
  /**
   * Sum of long-term gains from all lots that would be sold.
   * Uses existing FIFO from tax-lots.ts — caller provides this.
   */
  estimatedLtcgPaise: number;
  /** Sum of short-term gains (may be negative — losses reduce tax) */
  estimatedStcgPaise: number;
  /** Exempt gains (e.g. SGB redeemed at RBI maturity) */
  estimatedExemptPaise: number;
  /**
   * ISO date of the earliest lot that is currently STCG but would become LTCG
   * if the switch is delayed. null if all lots are already LTCG or no STCG.
   */
  earliestStcgFlipDate: string | null;
  /**
   * Instrument categories that have a lock-in constraint in the overweight leg.
   * Caller derives these from the actual holdings.
   */
  lockedCategories: InstrumentCategory[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SwitchTaxAnnotation {
  /** Which action in plan.actions this annotation covers (0-based index) */
  actionIndex: number;
  /** The original switch action (copied from plan.actions[actionIndex]) */
  action: CorpusSwitchAction;
  estimatedLtcgPaise: number;
  estimatedStcgPaise: number;
  estimatedExemptPaise: number;
  /** LTCG headroom remaining BEFORE this switch is applied */
  ltcgHeadroomBeforePaise: number;
  /** LTCG headroom remaining AFTER this switch (may go negative) */
  ltcgHeadroomAfterPaise: number;
  /** True when estimatedLtcgPaise <= ltcgHeadroomBeforePaise */
  ltcgFitsInHeadroom: boolean;
  /** Lock-in summaries from the instrument registry for each locked category */
  lockedCategoryDetails: Array<{
    category: InstrumentCategory;
    lockInSummary: string;
  }>;
  earliestStcgFlipDate: string | null;
  /**
   * True when contribution redirection is available as a zero-tax alternative
   * (i.e., plan.actions contains a redirect_contributions action with the same fromLeg).
   */
  redirectionAvailable: boolean;
  /** Whether the holding-period consequences make switching inadvisable right now */
  notRecommendedNow: boolean;
  /** Human-readable explanation when notRecommendedNow is true */
  notRecommendedReason: string | null;
}

export interface TaxAwarePlanInput {
  plan: RebalancingPlan;
  /**
   * One entry per CorpusSwitchAction in plan.actions, in the same order.
   * If plan.actions has no switch_corpus entries, this is empty.
   */
  switchGainData: SwitchGainData[];
  /**
   * LTCG already realized in the current financial year (paise).
   * The remaining headroom = LTCG_ANNUAL_EXEMPTION_PAISE - fyLtcgAlreadyRealizedPaise.
   */
  fyLtcgAlreadyRealizedPaise: number;
  onDate?: Date;
}

export interface TaxAwareRebalancingPlan {
  plan: RebalancingPlan;          // original, unchanged
  switchAnnotations: SwitchTaxAnnotation[];
  /**
   * Remaining LTCG headroom at the start (before any switches).
   * = max(0, LTCG_ANNUAL_EXEMPTION_PAISE - fyLtcgAlreadyRealizedPaise)
   */
  ltcgHeadroomPaise: number;
  /**
   * Standard note about contribution redirection. Always present.
   * "Redirecting contributions avoids realising gains entirely — no tax event occurs."
   */
  redirectionNote: string;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function lockInSummaryFor(rule: InstrumentRule): string {
  if (rule.lockIn === null) return "";
  if (rule.lockIn.perInstalment) {
    return `${rule.lockIn.months / 12}-year lock-in per instalment`;
  }
  if (rule.lockIn.earlyExitWindowMonths !== undefined) {
    return `${rule.lockIn.months / 12}-year term; exit from year ${rule.lockIn.earlyExitWindowMonths / 12}`;
  }
  return `${rule.lockIn.months / 12}-year lock-in`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildTaxAwareRebalancingPlan(
  input: TaxAwarePlanInput,
): TaxAwareRebalancingPlan {
  const {
    plan,
    switchGainData,
    fyLtcgAlreadyRealizedPaise,
    onDate = new Date(),
  } = input;

  // 1. Compute initial LTCG headroom for the FY
  const ltcgHeadroomPaise = Math.max(
    0,
    LTCG_ANNUAL_EXEMPTION_PAISE - fyLtcgAlreadyRealizedPaise,
  );

  let runningHeadroom = ltcgHeadroomPaise;
  let switchIndex = 0;
  const switchAnnotations: SwitchTaxAnnotation[] = [];

  // 2. Walk all actions; process only switch_corpus entries
  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    if (action.type !== "switch_corpus") continue;

    const switchAction = action as CorpusSwitchAction;
    const gainData = switchGainData[switchIndex]!;
    switchIndex++;

    const {
      estimatedLtcgPaise,
      estimatedStcgPaise,
      estimatedExemptPaise,
      earliestStcgFlipDate,
      lockedCategories,
    } = gainData;

    // 3. Headroom bookkeeping
    const ltcgHeadroomBeforePaise = runningHeadroom;
    const ltcgHeadroomAfterPaise = ltcgHeadroomBeforePaise - estimatedLtcgPaise;
    const ltcgFitsInHeadroom = estimatedLtcgPaise <= ltcgHeadroomBeforePaise;

    // 4. Lock-in detail for each locked category
    const lockedCategoryDetails = lockedCategories.map((category) => {
      const rule = getInstrumentRule(category, onDate);
      return {
        category,
        lockInSummary: lockInSummaryFor(rule),
      };
    });

    // 5. Redirection availability — any redirect_contributions action with the same fromLeg
    const redirectionAvailable = plan.actions.some(
      (a) => a.type === "redirect_contributions" && a.fromLeg === switchAction.fromLeg,
    );

    // 6. notRecommendedNow logic
    let notRecommendedNow = false;
    let notRecommendedReason: string | null = null;

    if (lockedCategories.length > 0) {
      notRecommendedNow = true;
      notRecommendedReason =
        "Some holdings in the overweight leg are locked in — an exit is not currently possible";
    } else if (estimatedStcgPaise > 0 && earliestStcgFlipDate !== null) {
      const flipDate = new Date(earliestStcgFlipDate);
      const diffMs = flipDate.getTime() - onDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays >= 0 && diffDays <= 90) {
        notRecommendedNow = true;
        notRecommendedReason = `Waiting until ${earliestStcgFlipDate} converts these short-term gains to long-term, reducing the holding-period consequence`;
      }
    }

    switchAnnotations.push({
      actionIndex: i,
      action: switchAction,
      estimatedLtcgPaise,
      estimatedStcgPaise,
      estimatedExemptPaise,
      ltcgHeadroomBeforePaise,
      ltcgHeadroomAfterPaise,
      ltcgFitsInHeadroom,
      lockedCategoryDetails,
      earliestStcgFlipDate,
      redirectionAvailable,
      notRecommendedNow,
      notRecommendedReason,
    });

    // 5. Decrement running headroom for the next switch annotation
    runningHeadroom -= estimatedLtcgPaise;
  }

  return {
    plan,
    switchAnnotations,
    ltcgHeadroomPaise,
    redirectionNote:
      "Redirecting contributions avoids realising gains entirely — no tax event occurs.",
  };
}
