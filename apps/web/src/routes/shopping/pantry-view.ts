import { formatINR } from "@compass/shared";

const DAY_MS = 86_400_000;

/** Format depletion estimate as human-readable string. */
export function formatDepletionEstimate(expectedDepletionAt: Date | null, now: Date): string {
  if (expectedDepletionAt === null) return "depleted";

  const days = Math.floor((expectedDepletionAt.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return "depleted";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** Format consumption rate for display. */
export function formatConsumptionRate(rate: number | null, unit: string | null): string {
  return rate === null || unit === null ? "—" : `${rate} ${unit}/month`;
}

/** Prepare chart data from price-history points. */
export function chartDataFromPoints(points: Array<{ pricePaise: number; observedAt: Date }>): {
  labels: string[];
  values: number[];
} {
  const sorted = [...points].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  return {
    labels: sorted.map((point) => point.observedAt.toISOString().slice(0, 10)),
    values: sorted.map((point) => point.pricePaise),
  };
}

/** Human-readable trend label. */
export function trendLabel(trend: string, confidence: string): string {
  if (trend === "insufficient_data") return "Not enough data";
  if (trend === "stable") return "Stable";

  const label = trend === "rising" ? "Rising" : trend === "falling" ? "Falling" : trend;
  const confidenceLabel =
    confidence === "insufficient_data" ? "insufficient data" : `${confidence} confidence`;
  return `${label} (${confidenceLabel})`;
}

/** Honesty check verdict string. */
export function honestyVerdict(
  flagged: boolean,
  maxObservedPricePaise: number | null,
  claimedMrpPaise: number,
): string {
  if (!flagged || maxObservedPricePaise === null) return "✓ Price appears fair";
  if (maxObservedPricePaise === 0) return "⚠ No valid price baseline to compare";

  const abovePct = Math.round(
    ((claimedMrpPaise - maxObservedPricePaise) / maxObservedPricePaise) * 100,
  );
  return `⚠ Claimed ${formatINR(claimedMrpPaise)} is ${abovePct}% above highest observed ${formatINR(maxObservedPricePaise)}`;
}
