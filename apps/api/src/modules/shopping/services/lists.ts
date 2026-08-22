/**
 * Shopping-list CRUD services (task 9.2).
 *
 * All functions are owner-scoped by `userId` (not household-scoped; see the
 * OWNER-ONLY decision in `services/pantry.ts` and TASK.md Design decisions).
 *
 * Concurrency safety for item-set-changing operations:
 * `addItem`, `deleteItem`, and `reorderItems` all open a DB transaction that
 * first acquires a `SELECT … FOR UPDATE` row lock on the owning `shopping_lists`
 * row (pattern from `modules/ledger/services/transfers.ts:122`). This serialises
 * concurrent add/delete/reorder pairings without needing a `(list_id, position)`
 * unique constraint — so no migration is required.
 *
 * `updatedAt` is bumped on every write (list and item).
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  CreateShoppingList,
  CreateShoppingListItem,
  ReorderItems,
  ShoppingList,
  ShoppingListItem,
  ShoppingListWithItems,
  UpdateShoppingList,
  UpdateShoppingListItem,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { shoppingListItems, shoppingLists } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import {
  assertOwnedCatalogItem,
  assertOwnedList,
  assertOwnedListItem,
} from "./ownership.ts";
import { replenishPantry } from "./pantry-management.ts";

type ListRow = typeof shoppingLists.$inferSelect;
type ItemRow = typeof shoppingListItems.$inferSelect;

function toList(r: ListRow): ShoppingList {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    note: r.note ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toItem(r: ItemRow): ShoppingListItem {
  // The quantityBase/unit pairing is enforced at the DB level; cast is safe.
  const quantityBase = r.quantityBase ?? null;
  const unit = (r.unit as ShoppingListItem["unit"]) ?? null;
  return {
    id: r.id,
    listId: r.listId,
    catalogItemId: r.catalogItemId ?? null,
    rawText: r.rawText,
    quantityBase,
    unit,
    status: r.status,
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export async function createList(
  db: Db,
  userId: string,
  input: CreateShoppingList,
): Promise<ShoppingList> {
  const rows = await db
    .insert(shoppingLists)
    .values({
      userId,
      name: input.name.trim(),
      note: input.note ?? null,
    })
    .returning();
  return toList(rows[0]!);
}

export async function listLists(
  db: Db,
  userId: string,
  statusFilter?: "active" | "archived",
): Promise<ShoppingList[]> {
  const rows = await db.query.shoppingLists.findMany({
    where: statusFilter
      ? and(eq(shoppingLists.userId, userId), eq(shoppingLists.status, statusFilter))
      : eq(shoppingLists.userId, userId),
    orderBy: [asc(shoppingLists.status), desc(shoppingLists.updatedAt), asc(shoppingLists.id)],
  });
  return rows.map(toList);
}

export async function getList(
  db: Db,
  userId: string,
  listId: string,
): Promise<ShoppingListWithItems> {
  await assertOwnedList(db, userId, listId);
  const list = await db.query.shoppingLists.findFirst({
    where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
  });
  if (!list) throw new HttpError(404, "Shopping list not found");
  const items = await db.query.shoppingListItems.findMany({
    where: eq(shoppingListItems.listId, listId),
    orderBy: [asc(shoppingListItems.position), asc(shoppingListItems.id)],
  });
  return { ...toList(list), items: items.map(toItem) };
}

export async function updateList(
  db: Db,
  userId: string,
  listId: string,
  input: UpdateShoppingList,
): Promise<ShoppingList> {
  await assertOwnedList(db, userId, listId);
  await db
    .update(shoppingLists)
    .set({
      name: input.name.trim(),
      note: input.note ?? null,
      status: input.status,
      updatedAt: new Date(),
    })
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)));
  const row = await db.query.shoppingLists.findFirst({
    where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Shopping list not found");
  return toList(row);
}

export async function deleteList(
  db: Db,
  userId: string,
  listId: string,
): Promise<void> {
  const rows = await db
    .delete(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .returning({ id: shoppingLists.id });
  if (rows.length === 0) throw new HttpError(404, "Shopping list not found");
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function addItem(
  db: Db,
  userId: string,
  listId: string,
  input: CreateShoppingListItem,
): Promise<ShoppingListWithItems> {
  return db.transaction(async (tx) => {
    // Lock the parent list row to serialise concurrent add/delete/reorder.
    const lockRows = await tx
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .for("update");
    if (lockRows.length === 0) throw new HttpError(404, "Shopping list not found");

    // Validate catalog item FK inside the tx.
    await assertOwnedCatalogItem(tx, userId, input.catalogItemId);

    // Compute next position = max(position) + 1, or 0 for the first item.
    const maxResult = await tx
      .select({ maxPos: sql<number>`COALESCE(MAX(${shoppingListItems.position}), -1)` })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId));
    const nextPosition = (maxResult[0]?.maxPos ?? -1) + 1;

    const now = new Date();
    await tx
      .insert(shoppingListItems)
      .values({
        listId,
        catalogItemId: input.catalogItemId ?? null,
        rawText: input.rawText.trim(),
        quantityBase: input.quantityBase ?? null,
        unit: (input.unit as typeof shoppingListItems.$inferInsert["unit"]) ?? null,
        position: nextPosition,
      })
      .returning();

    // Bump list updatedAt.
    await tx
      .update(shoppingLists)
      .set({ updatedAt: now })
      .where(eq(shoppingLists.id, listId));

    const items = await tx.query.shoppingListItems.findMany({
      where: eq(shoppingListItems.listId, listId),
      orderBy: [asc(shoppingListItems.position), asc(shoppingListItems.id)],
    });
    const list = (await tx.query.shoppingLists.findFirst({
      where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
    }))!;
    return { ...toList(list), items: items.map(toItem) };
  });
}

export async function updateItem(
  db: Db,
  userId: string,
  listId: string,
  itemId: string,
  input: UpdateShoppingListItem,
): Promise<ShoppingListWithItems> {
  // Validate both list and item ownership (no tx needed for PUT — no position change).
  await assertOwnedListItem(db, userId, listId, itemId);
  await assertOwnedCatalogItem(db, userId, input.catalogItemId);

  // Read the current status BEFORE the update so we can detect a real transition.
  const existingItem = await db.query.shoppingListItems.findFirst({
    where: and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)),
    columns: { status: true },
  });
  const previousStatus = existingItem?.status ?? null;

  const now = new Date();
  await db
    .update(shoppingListItems)
    .set({
      rawText: input.rawText.trim(),
      catalogItemId: input.catalogItemId ?? null,
      quantityBase: input.quantityBase ?? null,
      unit: (input.unit as typeof shoppingListItems.$inferInsert["unit"]) ?? null,
      status: input.status,
      updatedAt: now,
    })
    .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)));

  // Bump list updatedAt.
  await db
    .update(shoppingLists)
    .set({ updatedAt: now })
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)));

  // Fire-and-forget pantry replenishment ONLY on a genuine bought transition
  // (previous status was not 'bought'). Must not fail the list update.
  if (
    input.status === "bought" &&
    previousStatus !== "bought" &&
    input.catalogItemId != null &&
    input.quantityBase != null &&
    input.unit != null
  ) {
    void replenishPantry(db, userId, input.catalogItemId, input.quantityBase, input.unit).catch(
      () => { /* fire-and-forget: pantry errors must not block list update */ },
    );
  }

  return getList(db, userId, listId);
}

export async function deleteItem(
  db: Db,
  userId: string,
  listId: string,
  itemId: string,
): Promise<ShoppingListWithItems> {
  return db.transaction(async (tx) => {
    // Lock the parent list row to serialise concurrent delete/reorder.
    const lockRows = await tx
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .for("update");
    if (lockRows.length === 0) throw new HttpError(404, "Shopping list not found");

    // Validate item membership inside the tx.
    await assertOwnedListItem(tx, userId, listId, itemId);

    await tx
      .delete(shoppingListItems)
      .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, listId)));

    const now = new Date();
    await tx
      .update(shoppingLists)
      .set({ updatedAt: now })
      .where(eq(shoppingLists.id, listId));

    const items = await tx.query.shoppingListItems.findMany({
      where: eq(shoppingListItems.listId, listId),
      orderBy: [asc(shoppingListItems.position), asc(shoppingListItems.id)],
    });
    const list = (await tx.query.shoppingLists.findFirst({
      where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
    }))!;
    return { ...toList(list), items: items.map(toItem) };
  });
}

export async function reorderItems(
  db: Db,
  userId: string,
  listId: string,
  input: ReorderItems,
): Promise<ShoppingListWithItems> {
  return db.transaction(async (tx) => {
    // Lock the parent list row to serialise concurrent add/delete/reorder.
    const lockRows = await tx
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
      .for("update");
    if (lockRows.length === 0) throw new HttpError(404, "Shopping list not found");

    // Read current items under the lock.
    const currentItems = await tx.query.shoppingListItems.findMany({
      where: eq(shoppingListItems.listId, listId),
      columns: { id: true },
    });
    const currentIds = new Set(currentItems.map((i) => i.id));

    const { orderedIds } = input;

    // Validate: ordered set must be EXACTLY the list's current item ids.
    if (orderedIds.length !== currentIds.size) {
      throw new HttpError(
        400,
        `orderedIds has ${orderedIds.length} ids but the list has ${currentIds.size} items`,
      );
    }
    for (const id of orderedIds) {
      if (!currentIds.has(id)) {
        throw new HttpError(404, `Item ${id} not found in this list`);
      }
    }

    // Set positions to array index 0..n-1.
    const now = new Date();
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(shoppingListItems)
        .set({ position: i, updatedAt: now })
        .where(and(eq(shoppingListItems.id, orderedIds[i]!), eq(shoppingListItems.listId, listId)));
    }

    // Bump list updatedAt.
    await tx
      .update(shoppingLists)
      .set({ updatedAt: now })
      .where(eq(shoppingLists.id, listId));

    const items = await tx.query.shoppingListItems.findMany({
      where: eq(shoppingListItems.listId, listId),
      orderBy: [asc(shoppingListItems.position), asc(shoppingListItems.id)],
    });
    const list = (await tx.query.shoppingLists.findFirst({
      where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
    }))!;
    return { ...toList(list), items: items.map(toItem) };
  });
}
