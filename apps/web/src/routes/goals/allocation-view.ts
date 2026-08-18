import type { AdequacyLever } from "@compass/shared";

/** One-line title per lever type. */
export function leverTitle(lever: AdequacyLever): string {
  if (lever.type === "extend_timeline") return "Extend timeline";
  if (lever.type === "reduce_target") return "Reduce target amount";
  if (lever.type === "cut_expenses") return "Cut monthly expenses";
  return "Increase income";
}

/**
 * One-line plain-text summary. Uses compact amounts inline.
 * NOTE: import formatINR from @compass/shared for paise → rupee display.
 */
import { formatINR } from "@compass/shared";

export function leverSummary(lever: AdequacyLever): string {
  if (lever.type === "extend_timeline") {
    const unreachable = lever.perGoal.filter((g) => g.slipMonths === null).length;
    const slipping = lever.perGoal.filter((g) => g.slipMonths !== null && g.slipMonths > 0).length;
    if (unreachable > 0) return `${unreachable} goal${unreachable > 1 ? "s are" : " is"} unreachable at the current contribution rate.`;
    if (slipping === 0) return "Goals are on track with the current timeline.";
    return `${slipping} goal${slipping > 1 ? "s need" : " needs"} a later target date.`;
  }
  if (lever.type === "reduce_target") {
    const count = lever.perGoal.filter((g) => g.reductionPct !== null && g.reductionPct > 0).length;
    if (count === 0) return "All goals are achievable at current targets.";
    return `${count} goal${count > 1 ? "s" : ""} would benefit from a reduced target.`;
  }
  if (lever.type === "cut_expenses") {
    return `Reduce spending by ${formatINR(lever.requiredMonthlyReductionPaise)}/mo to cover all goals.`;
  }
  // increase_income
  return `Increase income by ${formatINR(lever.requiredMonthlyIncreasePaise)}/mo (${lever.pctOfCurrentIncome}% of median income).`;
}
