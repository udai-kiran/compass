/**
 * Shopping-local ownership guards (task 9.2).
 *
 * Mirrors the pattern in `lib/ownership.ts`: a foreign key proves a row exists,
 * not that the caller owns it. Each guard throws `HttpError(404)` when the
 * referenced row is absent or belongs to a different user — the caller cannot
 * distinguish "not found" from "not yours", which prevents information leaks.
 *
 * These are kept in the shopping module rather than in `lib/ownership.ts` to
 * avoid coupling the shared ownership library to the shopping schema (see the
 * CROSS-OWNER FOREIGN KEYS comment in `modules/shopping/schema.ts`).
 *
 * All guards accept `DbOrTx` so they can run inside a Drizzle transaction.
 * Null/undefined FK values are treated as "no reference" and are a no-op.
 */

import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { catalogItems, priceObservations, priceSources, shoppingListItems, shoppingLists } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

/**
 * Assert that `listId` exists and belongs to `userId`.
 * Cross-owner or non-existent → `HttpError(404)`.
 */
export async function assertOwnedList(
  db: DbOrTx,
  userId: string,
  listId: string,
): Promise<void> {
  const row = await db.query.shoppingLists.findFirst({
    where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Shopping list not found");
}

/**
 * Assert that `catalogItemId` (when non-null/undefined) exists and belongs to
 * `userId`. Null/undefined is a valid "no link" and is silently accepted.
 */
export async function assertOwnedCatalogItem(
  db: DbOrTx,
  userId: string,
  catalogItemId: string | null | undefined,
): Promise<void> {
  if (!catalogItemId) return;
  const row = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Catalog item not found");
}

/**
 * Assert that `sourceId` exists and belongs to `userId`.
 * Cross-owner or non-existent → `HttpError(404)`.
 */
export async function assertOwnedPriceSource(
  db: DbOrTx,
  userId: string,
  sourceId: string,
): Promise<void> {
  const row = await db.query.priceSources.findFirst({
    where: and(eq(priceSources.id, sourceId), eq(priceSources.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Price source not found");
}

/**
 * Assert that `obsId` exists and belongs to `userId`.
 * Cross-owner or non-existent → `HttpError(404)`.
 */
export async function assertOwnedPriceObservation(
  db: DbOrTx,
  userId: string,
  obsId: string,
): Promise<void> {
  const row = await db.query.priceObservations.findFirst({
    where: and(eq(priceObservations.id, obsId), eq(priceObservations.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Price observation not found");
}

/**
 * Assert that the item identified by `itemId` exists, belongs to `listId`, and
 * that the list itself belongs to `userId`. Constraining BOTH `item.id` AND
 * `item.listId` prevents cross-list IDOR where an item from list B is targeted
 * via list A's URL.
 */
export async function assertOwnedListItem(
  db: DbOrTx,
  userId: string,
  listId: string,
  itemId: string,
): Promise<void> {
  // First verify list ownership, then verify item membership.
  await assertOwnedList(db, userId, listId);
  const row = await db.query.shoppingListItems.findFirst({
    where: and(
      eq(shoppingListItems.id, itemId),
      eq(shoppingListItems.listId, listId),
    ),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Shopping list item not found");
}
