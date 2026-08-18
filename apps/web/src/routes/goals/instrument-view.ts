import type { SuitabilityTier } from "@compass/shared";

/** Human-readable tier label. */
export function tierLabel(tier: SuitabilityTier): string {
  if (tier === "ideal") return "Best fit";
  if (tier === "suitable") return "Suitable";
  return "Use with caution";
}

/** Tailwind color classes for the tier badge bg + text. */
export function tierBadgeClass(tier: SuitabilityTier): string {
  if (tier === "ideal") return "bg-emerald-50 text-emerald-700";
  if (tier === "suitable") return "bg-blue-50 text-blue-700";
  return "bg-amber-50 text-amber-700";
}
