/**
 * Serviceability services (task 10.2).
 *
 * Records whether a price source delivers to a given pincode. The check is
 * keyed on (priceSourceId, pincode) with an upsert so repeated calls update
 * the record rather than creating duplicates.
 *
 * STALE_HOURS = 24: a serviceability check older than 24 hours is considered
 * stale and flagged with `isStale: true` in responses. Computed in-process
 * (not in SQL) so it is unit-testable with an injectable clock.
 *
 * PRIVACY: pincode is stored locally only. It MUST NEVER be sent to AI
 * providers or any external service.
 *
 * `isServiceable` is 3-valued:
 *   - true  = source delivers to the pincode
 *   - false = source does not deliver to the pincode
 *   - null  = unknown — NEVER assumed true
 */

import { and, asc, eq } from "drizzle-orm";
import type { ServiceabilityCheck } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { serviceabilityChecks } from "../schema.ts";
import { assertOwnedPriceSource } from "./ownership.ts";

/** A serviceability check older than STALE_HOURS hours is flagged as stale. */
export const SERVICEABILITY_STALE_HOURS = 24;

/**
 * Returns true when `observedAt` is more than STALE_HOURS hours before `now`.
 * The `now` parameter is injectable for deterministic unit tests.
 * Uses strict > so an observation exactly at the boundary is NOT stale.
 */
export function isStaleCheck(observedAt: Date, now = new Date()): boolean {
  return (
    now.getTime() - observedAt.getTime() >
    SERVICEABILITY_STALE_HOURS * 60 * 60 * 1000
  );
}

type CheckRow = typeof serviceabilityChecks.$inferSelect;

function toServiceabilityCheck(r: CheckRow, now: Date): ServiceabilityCheck {
  return {
    id: r.id,
    priceSourceId: r.priceSourceId,
    pincode: r.pincode,
    isServiceable: r.isServiceable ?? null,
    isStale: isStaleCheck(r.observedAt, now),
    observedAt: r.observedAt,
    createdAt: r.createdAt,
  };
}

/**
 * Upsert a serviceability check for a price source × pincode.
 * Asserts that `sourceId` belongs to `userId` before writing.
 * ON CONFLICT (priceSourceId, pincode) DO UPDATE — updates `isServiceable`,
 * `observedAt`, and `userId` on conflict.
 *
 * PRIVACY: `pincode` is stored locally only and MUST NEVER be forwarded to
 * AI providers or external APIs.
 */
export async function upsertServiceabilityCheck(
  db: Db,
  userId: string,
  sourceId: string,
  pincode: string,
  isServiceable: boolean | null,
  now = new Date(),
): Promise<ServiceabilityCheck> {
  await assertOwnedPriceSource(db, userId, sourceId);

  const rows = await db
    .insert(serviceabilityChecks)
    .values({
      userId,
      priceSourceId: sourceId,
      pincode,
      isServiceable,
      observedAt: now,
    })
    .onConflictDoUpdate({
      target: [serviceabilityChecks.priceSourceId, serviceabilityChecks.pincode],
      set: {
        isServiceable,
        observedAt: now,
        userId,
      },
    })
    .returning();

  return toServiceabilityCheck(rows[0]!, now);
}

/**
 * List all serviceability checks for a specific price source, ordered by
 * pincode. Asserts ownership before querying.
 * The `now` parameter is injectable for deterministic unit tests.
 */
export async function listServiceabilityForSource(
  db: Db,
  userId: string,
  sourceId: string,
  now = new Date(),
): Promise<ServiceabilityCheck[]> {
  await assertOwnedPriceSource(db, userId, sourceId);

  const rows = await db
    .select()
    .from(serviceabilityChecks)
    .where(
      and(
        eq(serviceabilityChecks.priceSourceId, sourceId),
        eq(serviceabilityChecks.userId, userId),
      ),
    )
    .orderBy(asc(serviceabilityChecks.pincode));

  return rows.map((r) => toServiceabilityCheck(r, now));
}

/**
 * Get a single serviceability check for a source × pincode, or null if none.
 * Asserts ownership before querying.
 * The `now` parameter is injectable for deterministic unit tests.
 */
export async function getServiceabilityForSource(
  db: Db,
  userId: string,
  sourceId: string,
  pincode: string,
  now = new Date(),
): Promise<ServiceabilityCheck | null> {
  await assertOwnedPriceSource(db, userId, sourceId);

  const row = await db.query.serviceabilityChecks.findFirst({
    where: and(
      eq(serviceabilityChecks.priceSourceId, sourceId),
      eq(serviceabilityChecks.pincode, pincode),
      eq(serviceabilityChecks.userId, userId),
    ),
  });

  if (!row) return null;
  return toServiceabilityCheck(row, now);
}

/**
 * List serviceability checks for a user across all their sources,
 * optionally filtered by pincode. Computes `isStale` per row.
 * The `now` parameter is injectable for deterministic unit tests.
 */
export async function listServiceabilityForUser(
  db: Db,
  userId: string,
  pincode?: string,
  now = new Date(),
): Promise<ServiceabilityCheck[]> {
  const rows = await db
    .select()
    .from(serviceabilityChecks)
    .where(
      pincode
        ? and(
            eq(serviceabilityChecks.userId, userId),
            eq(serviceabilityChecks.pincode, pincode),
          )
        : eq(serviceabilityChecks.userId, userId),
    )
    .orderBy(asc(serviceabilityChecks.pincode));

  return rows.map((r) => toServiceabilityCheck(r, now));
}
