/**
 * Consumption-rate learning engine (task 11.1).
 *
 * `computeConsumptionRate` is a pure function — no DB, no side effects.
 * `learnConsumptionRate` is the DB wrapper that queries bought items and upserts
 * the habit_profiles row.
 *
 * Integer arithmetic throughout — all division uses Math.floor, never float.
 */

import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { catalogItems, habitProfiles, pantryItems, shoppingListItems, shoppingLists } from "../schema.ts";

// ─── Named constants ──────────────────────────────────────────────────────────

export const MIN_PURCHASES = 2;
export const OUTLIER_MULTIPLIER = 3;
export const MS_PER_DAY = 86_400_000;

// ─── Target-unit resolver (P5) ────────────────────────────────────────────────

/**
 * Resolve the learning target unit with precedence: catalog unit → pantry unit → null.
 *
 * Null means "use most-frequent observation unit" (existing computeConsumptionRate
 * behaviour). This prevents mixed-unit receipts from choosing the wrong habit unit
 * when the catalog item has no declared unit but the pantry row does.
 */
export function resolveLearningUnit(
  catalogUnit: string | null,
  pantryUnit: string | null,
): string | null {
  if (catalogUnit !== null) return catalogUnit;
  if (pantryUnit !== null) return pantryUnit;
  return null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Return the middle element of a sorted numeric array (sorted asc). */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  // For even length, take lower median (integer-safe).
  return Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// ─── Pure rate computation ─────────────────────────────────────────────────────

export interface Purchase {
  quantityBase: number;
  unit: string;
  boughtAt: Date;
}

export interface ConsumptionRate {
  consumptionBasePerMonth: number;
  unit: string;
  observationCount: number;
}

/**
 * Compute the consumption rate from a list of purchases.
 *
 * @param purchases  Raw purchase records (may include null-quantity items —
 *                   caller pre-filters; see learnConsumptionRate).
 * @param targetUnit  The catalog item's unit, or null to use most-frequent unit.
 * @returns          Integer rate (base units per 30-day month) or null if
 *                   there is insufficient data.
 */
export function computeConsumptionRate(
  purchases: Purchase[],
  targetUnit: string | null,
): ConsumptionRate | null {
  if (purchases.length === 0) return null;

  // Resolve the target unit: use provided or fall back to most-frequent unit.
  let unit: string;
  if (targetUnit !== null) {
    unit = targetUnit;
  } else {
    const freq: Record<string, number> = {};
    for (const p of purchases) {
      freq[p.unit] = (freq[p.unit] ?? 0) + 1;
    }
    // Pick the unit with the highest frequency (stable sort: first-seen on tie).
    let best = "";
    let bestCount = 0;
    for (const [u, count] of Object.entries(freq)) {
      if (count > bestCount) {
        best = u;
        bestCount = count;
      }
    }
    unit = best;
  }

  // Filter to the target unit.
  const filtered = purchases.filter((p) => p.unit === unit);
  if (filtered.length < MIN_PURCHASES) return null;

  // Sort by boughtAt ascending.
  const sorted = [...filtered].sort((a, b) => a.boughtAt.getTime() - b.boughtAt.getTime());

  // Compute median quantity for outlier detection.
  const quantities = sorted.map((p) => p.quantityBase).sort((a, b) => a - b);
  const medianQty = median(quantities);

  // Exclude outliers: quantity > OUTLIER_MULTIPLIER × median.
  const clean = sorted.filter((p) => p.quantityBase <= OUTLIER_MULTIPLIER * medianQty);
  if (clean.length < MIN_PURCHASES) return null;

  // Compute inter-purchase intervals in integer ms.
  const intervals: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    intervals.push(clean[i]!.boughtAt.getTime() - clean[i - 1]!.boughtAt.getTime());
  }
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianIntervalMs = median(sortedIntervals);

  if (medianIntervalMs <= 0) return null;

  // Compute median quantity of clean set for the rate.
  const cleanQtys = clean.map((p) => p.quantityBase).sort((a, b) => a - b);
  const cleanMedianQty = median(cleanQtys);

  // Rate = median_quantity × 30 days / median_interval (integer).
  const consumptionBasePerMonth = Math.floor(
    (cleanMedianQty * 30 * MS_PER_DAY) / medianIntervalMs,
  );

  return {
    consumptionBasePerMonth,
    unit,
    observationCount: clean.length,
  };
}

// ─── DB wrapper ───────────────────────────────────────────────────────────────

/**
 * Query bought shopping-list items for a catalog item, compute the consumption
 * rate, and upsert the habit_profiles row.
 *
 * Blending formula: if a prior profile exists, blend prior rate with the newly
 * computed rate weighted by observation count. This preserves the influence of
 * manual corrections (which reduce observationCount) so that a recompute does
 * not fully overwrite a correction.
 *
 * @returns The upserted habit profile row or null if there is insufficient data.
 */
export async function learnConsumptionRate(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
): Promise<typeof habitProfiles.$inferSelect | null> {
  // Fetch the catalog item to get the target unit.
  const catalogRow = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)),
    columns: { unit: true },
  });
  const catalogUnit = catalogRow?.unit ?? null;

  // P5: If catalog unit is null, fall back to the user's pantry row unit so that
  // mixed-unit receipts do not cause the learner to pick the wrong habit unit.
  let pantryUnit: string | null = null;
  if (catalogUnit === null) {
    const pantryRow = await db.query.pantryItems.findFirst({
      where: and(eq(pantryItems.catalogItemId, catalogItemId), eq(pantryItems.userId, userId)),
      columns: { unit: true },
    });
    pantryUnit = pantryRow?.unit ?? null;
  }

  const targetUnit = resolveLearningUnit(catalogUnit, pantryUnit);

  // Query all bought items for this catalog item through the user's lists.
  // Use updatedAt as the best available proxy for boughtAt (no boughtAt column).
  const rows = await db
    .select({
      quantityBase: shoppingListItems.quantityBase,
      unit: shoppingListItems.unit,
      boughtAt: shoppingListItems.updatedAt,
    })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
    .where(
      and(
        eq(shoppingListItems.catalogItemId, catalogItemId),
        eq(shoppingListItems.status, "bought"),
        eq(shoppingLists.userId, userId),
      ),
    );

  // Skip items with null quantityBase or null unit.
  const purchases: Purchase[] = [];
  for (const r of rows) {
    if (r.quantityBase !== null && r.unit !== null) {
      purchases.push({
        quantityBase: r.quantityBase,
        unit: r.unit,
        boughtAt: r.boughtAt,
      });
    }
  }

  const result = computeConsumptionRate(purchases, targetUnit);
  if (result === null) return null;

  // Check for existing profile to blend with.
  const existing = await db.query.habitProfiles.findFirst({
    where: and(
      eq(habitProfiles.userId, userId),
      eq(habitProfiles.catalogItemId, catalogItemId),
    ),
  });

  let finalRate: number;
  let finalCount: number;

  if (existing && existing.consumptionBasePerMonth !== null && existing.observationCount > 0) {
    // Blend: weight prior rate by priorCount, new rate by newCount.
    const priorRate = existing.consumptionBasePerMonth;
    const priorCount = existing.observationCount;
    const newRate = result.consumptionBasePerMonth;
    const newCount = result.observationCount;
    finalRate = Math.floor(
      (priorRate * priorCount + newRate * newCount) / (priorCount + newCount),
    );
    finalCount = priorCount + newCount;
  } else {
    finalRate = result.consumptionBasePerMonth;
    finalCount = result.observationCount;
  }

  const now = new Date();
  const upserted = await db
    .insert(habitProfiles)
    .values({
      userId,
      catalogItemId,
      consumptionBasePerMonth: finalRate,
      unit: result.unit as typeof habitProfiles.$inferInsert["unit"],
      observationCount: finalCount,
      lastComputedAt: now,
    })
    .onConflictDoUpdate({
      target: [habitProfiles.userId, habitProfiles.catalogItemId],
      set: {
        consumptionBasePerMonth: finalRate,
        unit: result.unit as typeof habitProfiles.$inferInsert["unit"],
        observationCount: finalCount,
        lastComputedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return upserted[0] ?? null;
}
