/**
 * Price History, Buy-Now-vs-Wait & Honesty Check services (task 10.7).
 *
 * Three analysis functions over `price_observations`:
 *
 *   - `getPriceHistory`   — fetch observations for an item/source, sorted asc,
 *                           with computed unit price.
 *   - `analyzeTrend`      — linear regression over pricePaise vs time; refuses
 *                           to advise below MIN_OBSERVATIONS=5 AND
 *                           MIN_DISTINCT_DAYS=3.
 *   - `checkPriceHonesty` — compares claimed MRP against observed history for
 *                           the same pack size in the last 30 days; flags
 *                           inflated reference prices (>INFLATION_THRESHOLD_PCT).
 *
 * All DB-bound functions are user_id-scoped. `analyzeTrend` is pure (no DB)
 * and injectable for tests via the optional `now` parameter.
 */

import { and, asc, eq, gte } from "drizzle-orm";
import type {
  BuyNowVsWait,
  PriceHistoryPoint,
  PriceHonestyResult,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { priceObservations } from "../schema.ts";

/** Minimum number of observations required before trend analysis fires. */
export const MIN_OBSERVATIONS = 5;

/** Minimum number of distinct calendar days (UTC) required before trend analysis fires. */
export const MIN_DISTINCT_DAYS = 3;

/**
 * Claimed MRP is flagged when it exceeds max observed price by more than this
 * percentage. Value 110 means "claimed MRP may be up to 110% of observed max".
 */
export const INFLATION_THRESHOLD_PCT = 110;

// ─── helpers ─────────────────────────────────────────────────────────────────

type ObsRow = typeof priceObservations.$inferSelect;

function toPoint(r: ObsRow): PriceHistoryPoint {
  const unitPricePaisePerBase =
    r.packQuantityBase !== null && r.packQuantityBase > 0
      ? r.pricePaise / r.packQuantityBase
      : null;
  return {
    pricePaise: r.pricePaise,
    unitPricePaisePerBase,
    packQuantityBase: r.packQuantityBase ?? null,
    unit: (r.unit as PriceHistoryPoint["unit"]) ?? null,
    sourceId: r.priceSourceId,
    observedAt: r.observedAt,
  };
}

// ─── getPriceHistory ─────────────────────────────────────────────────────────

/**
 * Fetch price history for a catalog item, optionally filtered by source.
 * Results are ordered ascending by `observedAt` so callers can chart them
 * without re-sorting.
 */
export async function getPriceHistory(
  db: Db,
  userId: string,
  catalogItemId: string,
  sourceId?: string,
): Promise<PriceHistoryPoint[]> {
  const conditions = [
    eq(priceObservations.userId, userId),
    eq(priceObservations.catalogItemId, catalogItemId),
  ];
  if (sourceId !== undefined) {
    conditions.push(eq(priceObservations.priceSourceId, sourceId));
  }

  const rows = await db
    .select()
    .from(priceObservations)
    .where(and(...conditions))
    .orderBy(asc(priceObservations.observedAt));

  return rows.map(toPoint);
}

// ─── analyzeTrend ────────────────────────────────────────────────────────────

/**
 * Analyse a series of price history points and return a buy-now-vs-wait
 * recommendation.
 *
 * Requires:
 *   - at least MIN_OBSERVATIONS=5 points, AND
 *   - at least MIN_DISTINCT_DAYS=3 distinct UTC calendar days.
 *
 * When either threshold is not met, returns `trend: "insufficient_data"` and
 * `recommendationPaise: null`.
 *
 * For sufficient data:
 *   - Fits a linear regression of pricePaise (y) against elapsed days (x),
 *     where x=0 is the first observation's timestamp.
 *   - slope > 1 paise/day  → "rising"  (buy now)
 *   - slope < -1 paise/day → "falling" (wait)
 *   - else                 → "stable"  (no urgency)
 *   - confidence: 5-9 → "low", 10-19 → "medium", ≥20 → "high"
 *   - recommendationPaise for "rising": latest observed pricePaise (buy now
 *     at the current price); for "falling": projected price 7 days from now
 *     (last x + 7 days); for "stable": null (no urgency).
 *
 * The `now` parameter is injectable for deterministic unit tests.
 */
export function analyzeTrend(points: PriceHistoryPoint[], now = new Date()): BuyNowVsWait {
  const n = points.length;

  // Count distinct UTC calendar days (YYYY-MM-DD strings).
  const daySet = new Set(
    points.map((p) => p.observedAt.toISOString().slice(0, 10)),
  );
  const distinctDayCount = daySet.size;

  if (n < MIN_OBSERVATIONS || distinctDayCount < MIN_DISTINCT_DAYS) {
    return {
      trend: "insufficient_data",
      confidence: "insufficient_data",
      minObservationsRequired: 5,
      observationCount: n,
      distinctDaysRequired: 3,
      distinctDayCount,
      recommendationPaise: null,
    };
  }

  // Confidence by observation count.
  const confidence =
    n >= 20 ? "high" : n >= 10 ? "medium" : "low";

  // Linear regression: x = elapsed days from first observation, y = pricePaise.
  const msPerDay = 24 * 60 * 60 * 1000;
  const firstMs = points[0]!.observedAt.getTime();

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const p of points) {
    const x = (p.observedAt.getTime() - firstMs) / msPerDay;
    const y = p.pricePaise;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  // When all points are on the same timestamp (denom=0), slope is undefined →
  // treat as stable (already caught by distinct-days check, but guard for safety).
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

  let trend: BuyNowVsWait["trend"];
  if (slope > 1) {
    trend = "rising";
  } else if (slope < -1) {
    trend = "falling";
  } else {
    trend = "stable";
  }

  let recommendationPaise: number | null = null;
  if (trend === "rising") {
    // Buy now at the latest observed price.
    recommendationPaise = points[n - 1]!.pricePaise;
  } else if (trend === "falling") {
    // Project price 7 days from now: y = slope * (nowX + 7) + intercept
    // where nowX is elapsed days from the first observation to now.
    const intercept = (sumY - slope * sumX) / n;
    const nowX = (now.getTime() - firstMs) / msPerDay;
    const projected = slope * (nowX + 7) + intercept;
    recommendationPaise = Math.max(0, Math.round(projected));
  }
  // stable → null

  return {
    trend,
    confidence,
    minObservationsRequired: 5,
    observationCount: n,
    distinctDaysRequired: 3,
    distinctDayCount,
    recommendationPaise,
  };
}

// ─── checkPriceHonesty ───────────────────────────────────────────────────────

/**
 * Compare a claimed MRP (e.g. from a product label) against the highest price
 * Compass has observed for the same item + pack size in the last 30 days.
 *
 * `flagged` is true when:
 *   maxObservedPricePaise !== null AND
 *   claimedMrpPaise > maxObservedPricePaise × INFLATION_THRESHOLD_PCT / 100
 *
 * When no observations exist in the window, `flagged` is false and
 * `maxObservedPricePaise` is null.
 *
 * Filters:
 *   - Only observations within the last 30 days.
 *   - If `packQuantityBase` and `unit` are provided: only observations with
 *     the same (packQuantityBase, unit) pair.
 *   - If `sourceId` is provided: only observations from that source.
 */
export async function checkPriceHonesty(
  db: Db,
  userId: string,
  catalogItemId: string,
  sourceId: string | undefined,
  claimedMrpPaise: number,
  packQuantityBase?: number,
  unit?: string,
): Promise<PriceHonestyResult> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(priceObservations.userId, userId),
    eq(priceObservations.catalogItemId, catalogItemId),
    gte(priceObservations.observedAt, thirtyDaysAgo),
  ];
  if (sourceId !== undefined) {
    conditions.push(eq(priceObservations.priceSourceId, sourceId));
  }

  const rows = await db
    .select()
    .from(priceObservations)
    .where(and(...conditions))
    .orderBy(asc(priceObservations.observedAt));

  // Filter to same pack size if caller supplied pack info.
  const filtered =
    packQuantityBase !== undefined && unit !== undefined
      ? rows.filter(
          (r) =>
            r.packQuantityBase !== null &&
            r.packQuantityBase === packQuantityBase &&
            r.unit === unit,
        )
      : rows;

  const evidence = filtered.map(toPoint);

  let maxObservedPricePaise: number | null = null;
  for (const r of filtered) {
    if (maxObservedPricePaise === null || r.pricePaise > maxObservedPricePaise) {
      maxObservedPricePaise = r.pricePaise;
    }
  }

  const flagged =
    maxObservedPricePaise !== null &&
    claimedMrpPaise > (maxObservedPricePaise * INFLATION_THRESHOLD_PCT) / 100;

  return {
    catalogItemId,
    sourceId: sourceId ?? null,
    claimedMrpPaise,
    maxObservedPricePaise,
    inflationThresholdPct: 110,
    flagged,
    evidence,
  };
}
