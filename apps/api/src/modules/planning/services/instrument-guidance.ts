/**
 * Instrument-category guidance: maps each allocation leg (equity/debt) to ranked
 * candidate instrument categories for the Indian context, with the attributes that
 * actually decide suitability — lock-in, tax treatment, liquidity, horizon fit.
 *
 * Hard rule: categories only, never named schemes or AMCs. Tested explicitly.
 * Pure, deterministic, no model calls, no DB, no Fastify.
 */

import type { InstrumentCategory, AllocationLeg, InstrumentRule } from "../../../lib/instrument-rules.ts";
import { getInstrumentRule, listSuitableCategories } from "../../../lib/instrument-rules.ts";

export type { InstrumentCategory, AllocationLeg };

/**
 * Human-readable label for an instrument category — these are the ONLY strings
 * that may appear in the UI for category names.  No scheme/fund/AMC names ever.
 */
export const CATEGORY_LABELS: Record<InstrumentCategory, string> = {
  elss: "ELSS (Tax-saving equity fund)",
  ppf: "PPF (Public Provident Fund)",
  epf_vpf: "EPF / VPF",
  ssy: "SSY (Sukanya Samriddhi Yojana)",
  nsc: "NSC (National Savings Certificate)",
  tax_saver_fd: "Tax-saver Fixed Deposit",
  sgb: "SGB (Sovereign Gold Bond)",
  equity_mf: "Equity mutual fund",
  debt_mf: "Debt mutual fund",
  liquid_mf: "Liquid / overnight fund",
  fd: "Fixed Deposit",
  rd: "Recurring Deposit",
  direct_stock: "Direct equity (stocks)",
  equity_etf: "Equity ETF",
  nps: "NPS (National Pension System)",
};

/** Suitability tier for a suggested category. */
export type SuitabilityTier = "ideal" | "suitable" | "caution";

/** One instrument category suggestion for an allocation leg. */
export interface InstrumentSuggestion {
  category: InstrumentCategory;
  label: string;         // from CATEGORY_LABELS
  tier: SuitabilityTier;
  /** One-sentence stated rationale — no product names. */
  rationale: string;
  /** True when lockIn.months > horizonMonths — a warning, not a disqualifier here */
  lockInConflict: boolean;
  /** Summary of lock-in constraints if present, else null. */
  lockInSummary: string | null;
  /** e.g. "80C deduction", "LTCG 12.5% after 1 year", "Tax-free at maturity" */
  taxSummary: string;
  /** One-sentence liquidity description. */
  liquiditySummary: string;
  /** Whether the user already holds this category (set by caller) */
  alreadyHeld: boolean;
}

export interface InstrumentGuidance {
  leg: AllocationLeg;
  horizonMonths: number;
  suggestions: InstrumentSuggestion[];
}

// ---------------------------------------------------------------------------
// Private constants
// ---------------------------------------------------------------------------

const RATIONALE: Record<InstrumentCategory, string> = {
  elss: "Combines 80C tax deduction with equity growth; three-year per-instalment lock-in suits goals with at least a 3-year horizon.",
  ppf: "Sovereign-backed, EEE-exempt debt with a 15-year tenure — suits long-term debt allocation for capital preservation.",
  epf_vpf: "Employer-matched, EEE-exempt with government-backed returns; voluntary top-up (VPF) extends its utility.",
  ssy: "EEE-exempt, high-rate government scheme; restricted to girl-child beneficiaries with a 21-year horizon.",
  nsc: "Fixed-return 5-year government bond with 80C benefit; interest is taxable but qualifies for 80C reinvestment.",
  tax_saver_fd: "Simplest 80C instrument; returns are lower than PPF/ELSS but fully capital-safe for a 5-year commitment.",
  sgb: "Government gold bond; earns interest and tracks gold price, with maturity-exempt gains — suits the 5-8 year range.",
  equity_mf: "Broad equity exposure through a diversified fund; no lock-in, LTCG applies after one year.",
  debt_mf: "Bond or money-market fund; gains taxed as income after the Finance Act 2023 change, but highly liquid.",
  liquid_mf: "T+1 redemption, minimal duration risk; optimal for an emergency reserve or cash parking up to 11 months.",
  fd: "Bank-guaranteed fixed return; premature exit permitted with a small penalty — reliable for 1-5 year debt needs.",
  rd: "Monthly instalment FD; suits systematic short-to-medium debt allocation with predictable maturity.",
  direct_stock: "Individual company ownership; highest volatility, lowest fees — suited only to 5+ year goals with active oversight.",
  equity_etf: "Exchange-traded index exposure; lower cost than active funds, same tax treatment, intraday liquidity.",
  nps: "Retirement-focused pension; additional 80CCD(1B) deduction of ₹50k; mandatory 40% annuitisation at maturity.",
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function taxSummaryFor(rule: InstrumentRule): string {
  const { tax } = rule;

  if (tax.gainsAsIncome) {
    return "Gains taxed as income (no LTCG/STCG distinction)";
  }

  if (tax.maturityExempt && tax.deductionSection !== null) {
    return `${tax.deductionSection} deduction; tax-free at maturity (EEE)`;
  }

  if (tax.maturityExempt) {
    return "Tax-free at maturity";
  }

  if (tax.deductionSection !== null && tax.ltcgRatePct !== null) {
    let summary = `${tax.deductionSection} deduction; LTCG ${tax.ltcgRatePct}% after ${tax.holdingMonthsForLtcg}m`;
    if (tax.exemptionLimitPaise !== null && tax.exemptionLimitPaise >= 1_25_00_000) {
      summary += "; ₹1.25L/yr exempt";
    } else if (tax.exemptionLimitPaise !== null && tax.exemptionLimitPaise >= 1_00_00_000) {
      summary += "; ₹1L/yr exempt";
    }
    return summary;
  }

  if (tax.deductionSection !== null) {
    return `${tax.deductionSection} deduction`;
  }

  if (tax.ltcgRatePct !== null) {
    let summary = `LTCG ${tax.ltcgRatePct}% after ${tax.holdingMonthsForLtcg}m`;
    if (tax.exemptionLimitPaise !== null && tax.exemptionLimitPaise >= 1_25_00_000) {
      summary += "; ₹1.25L/yr exempt";
    } else if (tax.exemptionLimitPaise !== null && tax.exemptionLimitPaise >= 1_00_00_000) {
      summary += "; ₹1L/yr exempt";
    }
    return summary;
  }

  return "No special tax treatment";
}

function lockInSummaryFor(rule: InstrumentRule): string | null {
  const { lockIn } = rule;
  if (lockIn === null) return null;

  if (lockIn.perInstalment) {
    return `${lockIn.months / 12}-year lock-in per instalment`;
  }

  if (lockIn.earlyExitWindowMonths !== undefined) {
    return `${lockIn.months / 12}-year term; exit possible from year ${lockIn.earlyExitWindowMonths / 12}`;
  }

  return `${lockIn.months / 12}-year lock-in`;
}

function liquiditySummaryFor(rule: InstrumentRule): string {
  const { liquidity } = rule;

  if (liquidity.prematureExitPermitted && liquidity.penaltyDescription !== null) {
    return liquidity.penaltyDescription;
  }

  if (liquidity.prematureExitPermitted) {
    return "Redeemable before maturity";
  }

  return "No early exit permitted";
}

function assignTier(
  category: InstrumentCategory,
  rule: InstrumentRule,
  lockInConflict: boolean,
): SuitabilityTier {
  if (lockInConflict || category === "nps") return "caution";
  const hasTaxAdvantage = rule.tax.deductionSection !== null || rule.tax.maturityExempt;
  return hasTaxAdvantage ? "ideal" : "suitable";
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Build instrument guidance for one allocation leg given the goal's horizon.
 *
 * `alreadyHeldCategories` — categories the user currently holds in any account
 *   mapped to this goal.  Those categories are moved to the front of the list
 *   and marked alreadyHeld=true.  Categories that are already-held but would
 *   normally be excluded (lock-in > horizon) are still included with
 *   lockInConflict=true so the user can see the constraint.
 *
 * `onDate` — the date to use for rule lookup (defaults to today).
 */
export function buildInstrumentGuidance(
  leg: AllocationLeg,
  horizonMonths: number,
  alreadyHeldCategories: InstrumentCategory[],
  onDate?: Date,
): InstrumentGuidance {
  const date = onDate ?? new Date();

  // 1. Categories that fit the horizon without lock-in conflict
  const suitable = listSuitableCategories(leg, horizonMonths, date);

  // 2. Held but not suitable (lock-in too long or not matching leg)
  // (variable kept for clarity; the Set below handles deduplication)

  // 3. Held categories first, then remaining suitable — deduplicated
  const allCategories = [...new Set([...alreadyHeldCategories, ...suitable])];

  // 4. Build suggestions
  const suggestions: InstrumentSuggestion[] = allCategories.map((category) => {
    const rule = getInstrumentRule(category, date);
    const lockInConflict = rule.lockIn !== null && rule.lockIn.months > horizonMonths;
    const alreadyHeld = alreadyHeldCategories.includes(category);
    const tier = assignTier(category, rule, lockInConflict);

    return {
      category,
      label: CATEGORY_LABELS[category],
      tier,
      rationale: RATIONALE[category],
      lockInConflict,
      lockInSummary: lockInSummaryFor(rule),
      taxSummary: taxSummaryFor(rule),
      liquiditySummary: liquiditySummaryFor(rule),
      alreadyHeld,
    };
  });

  return { leg, horizonMonths, suggestions };
}
