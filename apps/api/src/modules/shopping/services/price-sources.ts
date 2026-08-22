/**
 * Price-source CRUD services (task 10.1).
 *
 * All functions are owner-scoped by `userId`. Soft-delete: `deletePriceSource`
 * sets `isActive = false` rather than hard-deleting, so historical observations
 * retain their source link.
 *
 * Duplicate name (user_id, name unique index) → 409 via pgError check.
 */

import { and, asc, eq } from "drizzle-orm";
import type { CreatePriceSource, PriceSource, UpdatePriceSource } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { priceSources } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { assertOwnedPriceSource } from "./ownership.ts";

type SourceRow = typeof priceSources.$inferSelect;

function toPriceSource(r: SourceRow): PriceSource {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as PriceSource["kind"],
    url: r.url ?? null,
    isActive: r.isActive,
    deliveryFeePaise: r.deliveryFeePaise ?? null,
    minCartPaise: r.minCartPaise ?? null,
    deliveryEtaBand: (r.deliveryEtaBand as PriceSource["deliveryEtaBand"]) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** List all price sources for the user, ordered by name. */
export async function listPriceSources(db: Db, userId: string): Promise<PriceSource[]> {
  const rows = await db.query.priceSources.findMany({
    where: eq(priceSources.userId, userId),
    orderBy: [asc(priceSources.name)],
  });
  return rows.map(toPriceSource);
}

/**
 * Create a price source for the user.
 * Throws `HttpError(409)` if the (user_id, name) unique index is violated.
 */
export async function createPriceSource(
  db: Db,
  userId: string,
  data: CreatePriceSource,
): Promise<PriceSource> {
  try {
    const rows = await db
      .insert(priceSources)
      .values({
        userId,
        name: data.name.trim(),
        kind: data.kind,
        url: data.url ?? null,
        isActive: data.isActive ?? true,
      })
      .returning();
    return toPriceSource(rows[0]!);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505") {
      throw new HttpError(409, "A price source with this name already exists");
    }
    throw err;
  }
}

/**
 * Full-replace update of a price source. Asserts ownership first.
 * Throws `HttpError(409)` if the new name collides with another source.
 */
export async function updatePriceSource(
  db: Db,
  userId: string,
  sourceId: string,
  data: UpdatePriceSource,
): Promise<PriceSource> {
  await assertOwnedPriceSource(db, userId, sourceId);
  try {
    const rows = await db
      .update(priceSources)
      .set({
        name: data.name.trim(),
        kind: data.kind,
        url: data.url ?? null,
        isActive: data.isActive,
        updatedAt: new Date(),
      })
      .where(and(eq(priceSources.id, sourceId), eq(priceSources.userId, userId)))
      .returning();
    if (!rows[0]) throw new HttpError(404, "Price source not found");
    return toPriceSource(rows[0]);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const pg = pgError(err);
    if (pg?.code === "23505") {
      throw new HttpError(409, "A price source with this name already exists");
    }
    throw err;
  }
}

/**
 * Soft-delete a price source by setting `isActive = false`.
 * Asserts ownership first.
 */
export async function deletePriceSource(
  db: Db,
  userId: string,
  sourceId: string,
): Promise<void> {
  await assertOwnedPriceSource(db, userId, sourceId);
  await db
    .update(priceSources)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(priceSources.id, sourceId), eq(priceSources.userId, userId)));
}
