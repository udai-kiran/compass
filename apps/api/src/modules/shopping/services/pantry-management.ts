/**
 * Pantry management services (task 11.1).
 *
 * Pure functions: `computeDecayedQuantity`, `computeExpectedDepletionMs`.
 * DB operations: `replenishPantry`, `correctPantry`, `decayAllPantryItems`.
 *
 * Integer arithmetic throughout — all division uses Math.floor.
 */

import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { HttpError } from "../../../lib/errors.ts";
import { catalogItems, habitProfiles, pantryItems } from "../schema.ts";
import { assertOwnedCatalogItem } from "./ownership.ts";
import { learnConsumptionRate, MS_PER_DAY } from "./consumption-rate.ts";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Apply consumption decay to a stock quantity over elapsed time.
 *
 * @param currentQty         Current stock in base units (integer).
 * @param consumptionPerMonth  Consumption rate in base units per 30-day month (integer).
 * @param elapsedMs          Elapsed milliseconds since last update (may be negative for clock skew).
 * @returns                  Decayed quantity (integer, clamped to 0).
 */
export function computeDecayedQuantity(
  currentQty: number,
  consumptionPerMonth: number,
  elapsedMs: number,
): number {
  if (elapsedMs <= 0) return currentQty;
  const consumed = Math.floor((consumptionPerMonth * elapsedMs) / (30 * MS_PER_DAY));
  return Math.max(0, currentQty - consumed);
}

/**
 * Compute the expected depletion time from now given a stock level and rate.
 *
 * @param stockQty            Current stock in base units.
 * @param consumptionPerMonth Consumption rate in base units per 30-day month.
 * @returns                   Integer milliseconds until depletion, or null if
 *                            rate is 0 (never depletes).
 */
export function computeExpectedDepletionMs(
  stockQty: number,
  consumptionPerMonth: number,
): number | null {
  if (consumptionPerMonth <= 0) return null;
  return Math.floor((stockQty * 30 * MS_PER_DAY) / consumptionPerMonth);
}

// ─── DB operations ────────────────────────────────────────────────────────────

/**
 * Replenish a pantry item on confirmed purchase.
 *
 * 1. Assert ownership of catalog item.
 * 2. Validate unit matches the catalog item's unit (or catalog unit is null).
 * 3. Load existing pantry item and decay its stock to now.
 * 4. Add the purchased quantity to the decayed stock.
 * 5. Upsert the pantry item with new stock, unit, lastPurchasedAt, expectedDepletionAt.
 * 6. Trigger habit learning (fire-and-forget from caller).
 */
export async function replenishPantry(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
  quantityBase: number,
  unit: string,
): Promise<void> {
  await assertOwnedCatalogItem(db, userId, catalogItemId);

  // Fetch catalog item unit for validation.
  const catalogRow = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)),
    columns: { unit: true },
  });

  if (catalogRow?.unit !== null && catalogRow?.unit !== undefined && catalogRow.unit !== unit) {
    throw new HttpError(400, `Unit mismatch: catalog item uses '${catalogRow.unit}', got '${unit}'`);
  }

  // Load existing pantry item.
  const existing = await db.query.pantryItems.findFirst({
    where: and(eq(pantryItems.userId, userId), eq(pantryItems.catalogItemId, catalogItemId)),
  });

  // Also validate against any unit already recorded on the pantry row.
  if (existing?.unit !== null && existing?.unit !== undefined && existing.unit !== unit) {
    throw new HttpError(400, `Unit mismatch: existing pantry uses '${existing.unit}', got '${unit}'`);
  }

  // Load habit profile for decay computation.
  const habit = await db.query.habitProfiles.findFirst({
    where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, catalogItemId)),
  });

  const now = new Date();
  let currentStock = 0;

  if (existing && existing.quantityBase !== null) {
    if (habit && habit.consumptionBasePerMonth !== null) {
      // Decay existing stock from last update to now.
      const elapsedMs = now.getTime() - existing.updatedAt.getTime();
      currentStock = computeDecayedQuantity(
        existing.quantityBase,
        habit.consumptionBasePerMonth,
        elapsedMs,
      );
    } else {
      currentStock = existing.quantityBase;
    }
  }

  const newStock = currentStock + quantityBase;

  // Compute expected depletion time.
  let expectedDepletionAt: Date | null = null;
  if (habit && habit.consumptionBasePerMonth !== null && habit.consumptionBasePerMonth > 0) {
    const msUntilDepletion = computeExpectedDepletionMs(newStock, habit.consumptionBasePerMonth);
    if (msUntilDepletion !== null) {
      expectedDepletionAt = new Date(now.getTime() + msUntilDepletion);
    }
  }

  await db
    .insert(pantryItems)
    .values({
      userId,
      catalogItemId,
      quantityBase: newStock,
      unit: unit as typeof pantryItems.$inferInsert["unit"],
      lastPurchasedAt: now,
      expectedDepletionAt,
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.catalogItemId],
      set: {
        quantityBase: newStock,
        unit: unit as typeof pantryItems.$inferInsert["unit"],
        lastPurchasedAt: now,
        expectedDepletionAt,
        updatedAt: now,
      },
    });

  // Trigger habit learning after replenish (caller may fire-and-forget).
  await learnConsumptionRate(db, userId, catalogItemId);
}

/**
 * Apply a user correction to pantry stock level.
 *
 * 1. Assert ownership.
 * 2. Validate unit matches existing pantry/catalog unit.
 * 3. Update pantry stock to the corrected quantity.
 * 4. If a habit profile exists: apply 80/20 dampening blend and decrease observationCount by 1.
 * 5. Recompute expectedDepletionAt.
 */
export async function correctPantry(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
  quantityBase: number,
  unit: string,
): Promise<void> {
  await assertOwnedCatalogItem(db, userId, catalogItemId);

  // Validate unit against existing pantry and catalog.
  const existingPantry = await db.query.pantryItems.findFirst({
    where: and(eq(pantryItems.userId, userId), eq(pantryItems.catalogItemId, catalogItemId)),
  });

  const catalogRow = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)),
    columns: { unit: true },
  });

  // Check against existing pantry unit (if set).
  if (existingPantry?.unit !== null && existingPantry?.unit !== undefined && existingPantry.unit !== unit) {
    throw new HttpError(400, `Unit mismatch: existing pantry uses '${existingPantry.unit}', got '${unit}'`);
  }

  // Check against catalog unit (if set and pantry had no unit).
  if (
    (existingPantry?.unit === null || existingPantry?.unit === undefined) &&
    catalogRow?.unit !== null &&
    catalogRow?.unit !== undefined &&
    catalogRow.unit !== unit
  ) {
    throw new HttpError(400, `Unit mismatch: catalog item uses '${catalogRow.unit}', got '${unit}'`);
  }

  const now = new Date();

  // Load habit profile for rate adjustment.
  const habit = await db.query.habitProfiles.findFirst({
    where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, catalogItemId)),
  });

  let adjustedRate: number | null = null;
  let adjustedCount: number | null = null;

  if (habit && habit.consumptionBasePerMonth !== null && habit.consumptionBasePerMonth > 0) {
    // Compute the implied rate from the difference between expected and actual stock.
    // If we have an expected depletion and current stock, imply rate from current state.
    // Simple approach: if the existing pantry has a quantity, use the difference
    // between expected and corrected as an implied signal.
    let impliedRate = habit.consumptionBasePerMonth; // default to existing rate
    if (existingPantry?.quantityBase !== null && existingPantry?.quantityBase !== undefined) {
      // The user corrected downward or upward — infer what rate would produce this correction.
      // Use the elapsed time since last purchase to compute implied consumption.
      if (existingPantry.lastPurchasedAt !== null) {
        const elapsedMs = now.getTime() - existingPantry.lastPurchasedAt.getTime();
        if (elapsedMs > 0) {
          const consumed = existingPantry.quantityBase - quantityBase;
          if (consumed >= 0) {
            // impliedRate = consumed / elapsed * 30 days (integer floor)
            impliedRate = Math.floor((consumed * 30 * MS_PER_DAY) / elapsedMs);
          }
        }
      }
    }

    // Dampening: 80% existing rate + 20% implied rate (integer arithmetic).
    adjustedRate = Math.floor((habit.consumptionBasePerMonth * 80 + impliedRate * 20) / 100);
    // Decrease observation count by 1 (min 1) to give correction more weight in future blending.
    adjustedCount = Math.max(1, habit.observationCount - 1);
  }

  // Compute new expected depletion.
  let expectedDepletionAt: Date | null = null;
  if (adjustedRate !== null && adjustedRate > 0) {
    const msUntilDepletion = computeExpectedDepletionMs(quantityBase, adjustedRate);
    if (msUntilDepletion !== null) {
      expectedDepletionAt = new Date(now.getTime() + msUntilDepletion);
    }
  }

  // Update pantry stock.
  await db
    .insert(pantryItems)
    .values({
      userId,
      catalogItemId,
      quantityBase,
      unit: unit as typeof pantryItems.$inferInsert["unit"],
      lastPurchasedAt: existingPantry?.lastPurchasedAt ?? null,
      expectedDepletionAt,
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.catalogItemId],
      set: {
        quantityBase,
        unit: unit as typeof pantryItems.$inferInsert["unit"],
        expectedDepletionAt,
        updatedAt: now,
      },
    });

  // Update habit profile with dampened rate.
  if (habit && adjustedRate !== null && adjustedCount !== null) {
    await db
      .update(habitProfiles)
      .set({
        consumptionBasePerMonth: adjustedRate,
        observationCount: adjustedCount,
        updatedAt: now,
      })
      .where(and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, catalogItemId)));
  }
}

/**
 * Decay all pantry items for a user by their learned consumption rate.
 *
 * Skips items with no habit profile or null consumption rate.
 *
 * @returns Number of items updated.
 */
export async function decayAllPantryItems(
  db: DbOrTx,
  userId: string,
): Promise<number> {
  const items = await db.query.pantryItems.findMany({
    where: eq(pantryItems.userId, userId),
  });

  const habitRows = await db.query.habitProfiles.findMany({
    where: eq(habitProfiles.userId, userId),
  });

  const habitMap = new Map(habitRows.map((h) => [h.catalogItemId, h]));

  const now = new Date();
  let updated = 0;

  for (const item of items) {
    if (item.quantityBase === null) continue;
    const habit = habitMap.get(item.catalogItemId);
    if (!habit || habit.consumptionBasePerMonth === null) continue;

    const elapsedMs = now.getTime() - item.updatedAt.getTime();
    const decayed = computeDecayedQuantity(item.quantityBase, habit.consumptionBasePerMonth, elapsedMs);

    const msUntilDepletion = computeExpectedDepletionMs(decayed, habit.consumptionBasePerMonth);
    const expectedDepletionAt = msUntilDepletion !== null
      ? new Date(now.getTime() + msUntilDepletion)
      : null;

    await db
      .update(pantryItems)
      .set({ quantityBase: decayed, expectedDepletionAt, updatedAt: now })
      .where(and(eq(pantryItems.userId, userId), eq(pantryItems.catalogItemId, item.catalogItemId)));

    updated += 1;
  }

  return updated;
}
