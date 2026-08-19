import type { GlideStep } from "@compass/shared";

/**
 * Format a glide step's date range and allocation.
 * Example: "Jun 2026 – Dec 2027 · 80% equity / 20% debt"
 */
export function formatGlideStep(step: GlideStep): string {
  const from = fmtYearMonth(step.fromDate);
  const to = fmtYearMonth(step.toDate);
  return `${from} – ${to} · ${step.equityPct}% equity / ${step.debtPct}% debt`;
}

function fmtYearMonth(isoDate: string): string {
  const [year, month] = isoDate.split("-") as [string, string];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

/**
 * Returns true when the steps include at least one allocation shift
 * (equity changes from one step to the next).
 */
export function hasAllocationShift(steps: GlideStep[]): boolean {
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]!.equityPct !== steps[i - 1]!.equityPct) return true;
  }
  return false;
}
