import { formatINR } from "@compass/shared";
import type { RebalancingAction, DriftAnalysis } from "@compass/shared";

/** Human-readable description of a rebalancing action. */
export function actionLabel(action: RebalancingAction): string {
  if (action.type === "redirect_contributions") {
    return `Redirect ${formatINR(action.monthlyAmountPaise)}/mo: ${action.fromLeg} → ${action.toLeg} (closes in ~${action.estimatedClosureMonths} mo)`;
  }
  // switch_corpus
  return `Switch ${formatINR(action.amountPaise)}: ${action.fromLeg} → ${action.toLeg}`;
}

/**
 * Simple drift severity: "high" when |drift| > 10% of funded corpus.
 */
export function driftSeverity(drift: DriftAnalysis): "low" | "high" {
  const total = drift.equityCurrentPaise + drift.debtCurrentPaise;
  if (total <= 0) return "low";
  return Math.abs(drift.driftPaise) / total > 0.10 ? "high" : "low";
}
