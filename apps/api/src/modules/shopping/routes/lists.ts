/**
 * Shopping-list routes (task 9.2). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET    /lists              → GET /api/shopping/lists
 *   POST   /lists              → POST /api/shopping/lists
 *   GET    /lists/:id          → GET /api/shopping/lists/:id
 *   PUT    /lists/:id          → PUT /api/shopping/lists/:id
 *   DELETE /lists/:id          → DELETE /api/shopping/lists/:id
 *   POST   /lists/:id/items    → POST /api/shopping/lists/:id/items
 *   PUT    /lists/:id/items/:itemId    → PUT /api/shopping/lists/:id/items/:itemId
 *   DELETE /lists/:id/items/:itemId   → DELETE /api/shopping/lists/:id/items/:itemId
 *   PUT    /lists/:id/items/reorder   → PUT /api/shopping/lists/:id/items/reorder
 *
 * All routes are session-authenticated (the auth plugin rejects unauthenticated
 * requests unless a route has `config: { public: true }` — none of these do).
 * Demo sessions are automatically rejected on all mutating methods by the single
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateShoppingListItemSchema,
  CreateShoppingListSchema,
  ReorderItemsSchema,
  ShoppingListSchema,
  ShoppingListWithItemsSchema,
  UpdateShoppingListItemSchema,
  UpdateShoppingListSchema,
} from "@compass/shared";
import {
  addItem,
  createList,
  deleteItem,
  deleteList,
  getList,
  listLists,
  reorderItems,
  updateItem,
  updateList,
} from "../services/lists.ts";

const ListParams = z.object({ id: z.uuid() });
const ItemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const StatusQuery = z.object({ status: z.enum(["active", "archived"]).optional() });

export async function shoppingListRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /lists — list all lists for the current user, optionally filtered by status.
  r.get(
    "/lists",
    {
      schema: {
        querystring: StatusQuery,
        response: { 200: z.array(ShoppingListSchema) },
      },
    },
    async (req) => listLists(app.db, req.session!.userId, req.query.status),
  );

  // POST /lists — create a new shopping list.
  r.post(
    "/lists",
    {
      schema: {
        body: CreateShoppingListSchema,
        response: { 200: ShoppingListSchema },
      },
    },
    async (req) => createList(app.db, req.session!.userId, req.body),
  );

  // GET /lists/:id — fetch a single list with its items.
  r.get(
    "/lists/:id",
    {
      schema: {
        params: ListParams,
        response: { 200: ShoppingListWithItemsSchema },
      },
    },
    async (req) => getList(app.db, req.session!.userId, req.params.id),
  );

  // PUT /lists/:id — full-replace update of the list (name, note, status).
  r.put(
    "/lists/:id",
    {
      schema: {
        params: ListParams,
        body: UpdateShoppingListSchema,
        response: { 200: ShoppingListSchema },
      },
    },
    async (req) => updateList(app.db, req.session!.userId, req.params.id, req.body),
  );

  // DELETE /lists/:id — delete the list (cascades to items).
  r.delete(
    "/lists/:id",
    {
      schema: {
        params: ListParams,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteList(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  // POST /lists/:id/items — add an item to the list.
  r.post(
    "/lists/:id/items",
    {
      schema: {
        params: ListParams,
        body: CreateShoppingListItemSchema,
        response: { 200: ShoppingListWithItemsSchema },
      },
    },
    async (req) => addItem(app.db, req.session!.userId, req.params.id, req.body),
  );

  // PUT /lists/:id/items/reorder — reorder all items of the list.
  // IMPORTANT: this must be registered BEFORE /lists/:id/items/:itemId so
  // Fastify does not interpret "reorder" as an :itemId value.
  r.put(
    "/lists/:id/items/reorder",
    {
      schema: {
        params: ListParams,
        body: ReorderItemsSchema,
        response: { 200: ShoppingListWithItemsSchema },
      },
    },
    async (req) => reorderItems(app.db, req.session!.userId, req.params.id, req.body),
  );

  // PUT /lists/:id/items/:itemId — full-replace update of a single item.
  r.put(
    "/lists/:id/items/:itemId",
    {
      schema: {
        params: ItemParams,
        body: UpdateShoppingListItemSchema,
        response: { 200: ShoppingListWithItemsSchema },
      },
    },
    async (req) =>
      updateItem(app.db, req.session!.userId, req.params.id, req.params.itemId, req.body),
  );

  // DELETE /lists/:id/items/:itemId — remove an item from the list.
  r.delete(
    "/lists/:id/items/:itemId",
    {
      schema: {
        params: ItemParams,
        response: { 200: ShoppingListWithItemsSchema },
      },
    },
    async (req) =>
      deleteItem(app.db, req.session!.userId, req.params.id, req.params.itemId),
  );
}
