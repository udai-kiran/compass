/**
 * Catalog canonicalization service (task 9.3).
 *
 * Provides:
 * - `matchCatalog` — owner-scoped case-insensitive exact match.
 *   Unique hit → `matched`; 2+ hits → `ambiguous`; 0 → `none`. Never creates.
 * - Catalog CRUD (`createCatalogItem`, `listCatalogItems`, `getCatalogItem`,
 *   `updateCatalogItem`, `deleteCatalogItem`) — all owner-scoped.
 * - `canonicalizeItem` — single tx that locks list row then item row FOR UPDATE,
 *   reads rawText under the item lock (closes stale-match race), auto-links
 *   on unique match, bumps item+list updatedAt on link. No write on ambiguous/none.
 *
 * Match discipline mirrors `matchAccount` (extract.ts) — only a unique hit wins;
 * ambiguous hits are surfaced for human review and never auto-resolved.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import type {
  CatalogItem,
  CatalogMatchResult,
  CanonicalizeItemResponse,
  CreateCatalogItem,
  ShoppingListItem,
  UpdateCatalogItem,
} from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { catalogItems, shoppingListItems, shoppingLists } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { assertOwnedCatalogItem } from "./ownership.ts";
import { assertOwnedCategory } from "../../../lib/ownership.ts";

type CatalogRow = typeof catalogItems.$inferSelect;
type ItemRow = typeof shoppingListItems.$inferSelect;

function toCatalogItem(r: CatalogRow): CatalogItem {
  return {
    id: r.id,
    canonicalName: r.canonicalName,
    brand: r.brand ?? null,
    categoryId: r.categoryId ?? null,
    packQuantityBase: r.packQuantityBase ?? null,
    unit: (r.unit as CatalogItem["unit"]) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toItem(r: ItemRow): ShoppingListItem {
  return {
    id: r.id,
    listId: r.listId,
    catalogItemId: r.catalogItemId ?? null,
    rawText: r.rawText,
    quantityBase: r.quantityBase ?? null,
    unit: (r.unit as ShoppingListItem["unit"]) ?? null,
    status: r.status,
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── Match ────────────────────────────────────────────────────────────────────

/**
 * Case-insensitive exact match on `canonical_name` within the user's catalog.
 * Empty/whitespace-only rawText → `none` without querying.
 *
 * Because the DB unique index is case-SENSITIVE, two rows "Atta" and "atta"
 * can coexist and a case-insensitive lookup will return both → `ambiguous`.
 * Never fuzzy-matches, never creates a catalog row.
 */
export async function matchCatalog(
  db: DbOrTx,
  userId: string,
  rawText: string,
): Promise<CatalogMatchResult> {
  const want = rawText.trim();
  if (!want) return { status: "none" };

  const rows = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.userId, userId),
        sql`lower(${catalogItems.canonicalName}) = lower(${want})`,
      ),
    );

  if (rows.length === 0) return { status: "none" };
  if (rows.length === 1) return { status: "matched", catalogItemId: rows[0]!.id };
  return { status: "ambiguous", candidateIds: rows.map((r) => r.id) };
}

// ─── Catalog CRUD ─────────────────────────────────────────────────────────────

export async function createCatalogItem(
  db: Db,
  userId: string,
  input: CreateCatalogItem,
): Promise<CatalogItem> {
  // Validate category ownership (null categoryId is a no-op).
  await assertOwnedCategory(db, userId, input.categoryId);

  try {
    const rows = await db
      .insert(catalogItems)
      .values({
        userId,
        canonicalName: input.canonicalName.trim(),
        brand: input.brand ?? null,
        categoryId: input.categoryId ?? null,
        packQuantityBase: input.packQuantityBase ?? null,
        unit: (input.unit as typeof catalogItems.$inferInsert["unit"]) ?? null,
      })
      .returning();
    return toCatalogItem(rows[0]!);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505") {
      throw new HttpError(409, "A catalog item with this name already exists");
    }
    throw err;
  }
}

export async function listCatalogItems(
  db: Db,
  userId: string,
): Promise<CatalogItem[]> {
  const rows = await db.query.catalogItems.findMany({
    where: eq(catalogItems.userId, userId),
    orderBy: [asc(catalogItems.canonicalName), asc(catalogItems.id)],
  });
  return rows.map(toCatalogItem);
}

export async function getCatalogItem(
  db: Db,
  userId: string,
  catalogItemId: string,
): Promise<CatalogItem> {
  const row = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Catalog item not found");
  return toCatalogItem(row);
}

export async function updateCatalogItem(
  db: Db,
  userId: string,
  catalogItemId: string,
  input: UpdateCatalogItem,
): Promise<CatalogItem> {
  // Validate ownership of the item (throws 404 if not found or cross-owner).
  await assertOwnedCatalogItem(db, userId, catalogItemId);
  // Validate category ownership (null categoryId is a no-op).
  await assertOwnedCategory(db, userId, input.categoryId);

  try {
    const rows = await db
      .update(catalogItems)
      .set({
        canonicalName: input.canonicalName.trim(),
        brand: input.brand ?? null,
        categoryId: input.categoryId ?? null,
        packQuantityBase: input.packQuantityBase ?? null,
        unit: (input.unit as typeof catalogItems.$inferInsert["unit"]) ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)))
      .returning();
    if (rows.length === 0) throw new HttpError(404, "Catalog item not found");
    return toCatalogItem(rows[0]!);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const pg = pgError(err);
    if (pg?.code === "23505") {
      throw new HttpError(409, "A catalog item with this name already exists");
    }
    throw err;
  }
}

export async function deleteCatalogItem(
  db: Db,
  userId: string,
  catalogItemId: string,
): Promise<void> {
  const rows = await db
    .delete(catalogItems)
    .where(and(eq(catalogItems.id, catalogItemId), eq(catalogItems.userId, userId)))
    .returning({ id: catalogItems.id });
  if (rows.length === 0) throw new HttpError(404, "Catalog item not found");
}

// ─── Canonicalize item ────────────────────────────────────────────────────────

/**
 * Auto-link a shopping list item to a catalog entry by matching its rawText.
 *
 * One DB transaction:
 * 1. Lock the `shopping_lists` row FOR UPDATE (deadlock-safe order: list first).
 * 2. Lock the `shopping_list_items` row FOR UPDATE.
 * 3. Read rawText under the item lock (closes stale-match race vs concurrent
 *    updateItem, which is a plain UPDATE with no list-level lock — see
 *    lists.ts:217/222 and review-1 B1).
 * 4. `matchCatalog(rawText)`:
 *    - `matched` → set catalogItemId, bump item.updatedAt + list.updatedAt.
 *    - `ambiguous`/`none` → no write, no bump.
 * 5. Return `{ item (updated or unchanged), match }`.
 *
 * Never creates a catalog entry. Ambiguous candidates are returned for human
 * review — never auto-resolved.
 */
export async function canonicalizeItem(
  db: Db,
  userId: string,
  listId: string,
  itemId: string,
): Promise<CanonicalizeItemResponse> {
  return db.transaction(async (tx) => {
    // 1. Lock list row first (deadlock-safe acquisition order).
    const listRows = await tx
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .for("update");
    if (listRows.length === 0) throw new HttpError(404, "Shopping list not found");

    // 2. Lock item row (id + listId together prevents cross-list IDOR).
    const itemRows = await tx
      .select()
      .from(shoppingListItems)
      .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)))
      .for("update");
    if (itemRows.length === 0) throw new HttpError(404, "Shopping list item not found");

    const itemRow = itemRows[0]!;

    // 3. Match rawText under the item lock — prevents stale-match race.
    const match = await matchCatalog(tx, userId, itemRow.rawText);

    if (match.status === "matched") {
      // 4. Unique match: set catalogItemId and bump timestamps.
      const now = new Date();
      await tx
        .update(shoppingListItems)
        .set({ catalogItemId: match.catalogItemId, updatedAt: now })
        .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)));

      await tx
        .update(shoppingLists)
        .set({ updatedAt: now })
        .where(eq(shoppingLists.id, listId));

      // Re-read the item to return its updated state.
      const updatedRow = await tx.query.shoppingListItems.findFirst({
        where: and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)),
      });
      return { item: toItem(updatedRow!), match };
    }

    // 5. Ambiguous or none: no write, return item unchanged.
    return { item: toItem(itemRow), match };
  });
}
