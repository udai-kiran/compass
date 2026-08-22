/**
 * Price-observation services (task 10.1).
 *
 * STALE_DAYS = 7: an observation older than 7 days is considered stale and
 * flagged with `isStale: true`. The staleness check is computed in service
 * code (not SQL) so it is unit-testable with an injectable clock.
 *
 * Ownership is double-checked on write paths:
 *   - `createObservation` asserts both the catalogItemId and priceSourceId
 *     belong to the caller before inserting.
 *   - `deleteObservation` asserts the observation belongs to the caller.
 */

import { and, desc, eq } from "drizzle-orm";
import type { CreatePriceObservation, PriceObservation, PriceObservationWithSource } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { priceObservations, priceSources } from "../schema.ts";
import { assertOwnedCatalogItem, assertOwnedPriceObservation, assertOwnedPriceSource } from "./ownership.ts";

/** An observation older than STALE_DAYS days is flagged as stale. */
export const STALE_DAYS = 7;

/**
 * Returns true when `observedAt` is more than STALE_DAYS days before `now`.
 * The `now` parameter is injectable for deterministic unit tests.
 */
export function isStaleObservation(observedAt: Date, now = new Date()): boolean {
  return now.getTime() - observedAt.getTime() > STALE_DAYS * 24 * 60 * 60 * 1000;
}

type ObsRow = typeof priceObservations.$inferSelect;

function toPriceObservation(r: ObsRow): PriceObservation {
  return {
    id: r.id,
    catalogItemId: r.catalogItemId,
    priceSourceId: r.priceSourceId,
    pricePaise: r.pricePaise,
    mrpPaise: r.mrpPaise ?? null,
    packQuantityBase: r.packQuantityBase ?? null,
    unit: (r.unit as PriceObservation["unit"]) ?? null,
    observedAt: r.observedAt,
    createdAt: r.createdAt,
  };
}

/**
 * List observations for a catalog item, joined with their source metadata,
 * ordered by most recent first. `isStale` is computed in-process.
 *
 * The `now` parameter is injectable for tests.
 */
export async function listObservations(
  db: Db,
  userId: string,
  catalogItemId: string,
  now?: Date,
): Promise<PriceObservationWithSource[]> {
  const actualNow = now ?? new Date();

  const rows = await db
    .select({
      id: priceObservations.id,
      catalogItemId: priceObservations.catalogItemId,
      priceSourceId: priceObservations.priceSourceId,
      pricePaise: priceObservations.pricePaise,
      mrpPaise: priceObservations.mrpPaise,
      packQuantityBase: priceObservations.packQuantityBase,
      unit: priceObservations.unit,
      observedAt: priceObservations.observedAt,
      createdAt: priceObservations.createdAt,
      sourceName: priceSources.name,
      sourceKind: priceSources.kind,
    })
    .from(priceObservations)
    .innerJoin(priceSources, eq(priceObservations.priceSourceId, priceSources.id))
    .where(
      and(
        eq(priceObservations.userId, userId),
        eq(priceObservations.catalogItemId, catalogItemId),
      ),
    )
    .orderBy(desc(priceObservations.observedAt));

  return rows.map((r) => ({
    id: r.id,
    catalogItemId: r.catalogItemId,
    priceSourceId: r.priceSourceId,
    pricePaise: r.pricePaise,
    mrpPaise: r.mrpPaise ?? null,
    packQuantityBase: r.packQuantityBase ?? null,
    unit: (r.unit as PriceObservation["unit"]) ?? null,
    observedAt: r.observedAt,
    createdAt: r.createdAt,
    sourceName: r.sourceName,
    sourceKind: r.sourceKind as PriceObservationWithSource["sourceKind"],
    isStale: isStaleObservation(r.observedAt, actualNow),
  }));
}

/**
 * Create a price observation. Asserts both catalogItemId and priceSourceId
 * belong to the caller before inserting.
 */
export async function createObservation(
  db: Db,
  userId: string,
  data: CreatePriceObservation,
): Promise<PriceObservation> {
  // Ownership guards — both throw HttpError(404) on cross-user or missing FK.
  await assertOwnedCatalogItem(db, userId, data.catalogItemId);
  await assertOwnedPriceSource(db, userId, data.priceSourceId);

  const rows = await db
    .insert(priceObservations)
    .values({
      userId,
      catalogItemId: data.catalogItemId,
      priceSourceId: data.priceSourceId,
      pricePaise: data.pricePaise,
      mrpPaise: data.mrpPaise ?? null,
      packQuantityBase: data.packQuantityBase ?? null,
      unit: data.unit ?? null,
      observedAt: data.observedAt,
    })
    .returning();
  return toPriceObservation(rows[0]!);
}

/**
 * Delete a price observation. Asserts ownership first.
 */
export async function deleteObservation(
  db: Db,
  userId: string,
  obsId: string,
): Promise<void> {
  await assertOwnedPriceObservation(db, userId, obsId);
  await db
    .delete(priceObservations)
    .where(and(eq(priceObservations.id, obsId), eq(priceObservations.userId, userId)));
}
