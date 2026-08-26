/**
 * prepay-view.ts — Pure formatting/classification for the prepay panel.
 * No React, no hooks. Testable with node --test.
 */
import { formatINR } from "@compass/shared";

/**
 * Format a basis-points rate as "X.XX% p.a."
 */
export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}% p.a.`;
}

/**
 * One-line summary for rate-reset impact on tenure (same-EMI scenario).
 * e.g. "8.50% → 9.00%: EMI unchanged, tenure +14 months, ₹4.2L extra interest."
 */
export function rateResetSummary(
  currentRateBps: number,
  newRateBps: number,
  tenureChangedBy: number,
  interestDeltaPaise: number,
): string {
  const direction = tenureChangedBy > 0 ? "+" : "";
  const interestWord = interestDeltaPaise > 0 ? "extra" : "less";
  return (
    `${formatRate(currentRateBps)} → ${formatRate(newRateBps)}: ` +
    `EMI unchanged, tenure ${direction}${tenureChangedBy} months, ` +
    `${formatINR(Math.abs(interestDeltaPaise))} ${interestWord} interest.`
  );
}

export type RecommendationKind = "prepay" | "invest" | "emergency_fund_first" | "high_interest_debt_first";

/**
 * Map a recommendation to a UI-safe label and semantic color class.
 */
export function recommendationLabel(rec: RecommendationKind): { label: string; colorClass: string } {
  switch (rec) {
    case "prepay":
      return { label: "Prepay the loan", colorClass: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    case "invest":
      return { label: "Invest instead", colorClass: "text-blue-700 bg-blue-50 border-blue-200" };
    case "emergency_fund_first":
      return { label: "Build emergency fund first", colorClass: "text-amber-700 bg-amber-50 border-amber-200" };
    case "high_interest_debt_first":
      return { label: "Clear high-interest debt first", colorClass: "text-red-700 bg-red-50 border-red-200" };
  }
}

/**
 * Format "X months saved" or "X months longer" for a tenure change.
 */
export function tenureChangeLabel(months: number): string {
  if (months === 0) return "No change";
  if (months > 0) return `${months} months saved`;
  return `${Math.abs(months)} months longer`;
}

/**
 * Risk-asymmetry annotation for comparing certain vs uncertain returns.
 */
export function riskLabel(isCertain: boolean): string {
  return isCertain ? "Certain (guaranteed saving)" : "Projected (market-linked, not guaranteed)";
}
