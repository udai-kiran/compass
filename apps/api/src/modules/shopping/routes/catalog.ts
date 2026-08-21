/**
 * Catalog routes (task 9.3). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   POST   /catalog                                 → POST /api/shopping/catalog
 *   GET    /catalog                                 → GET  /api/shopping/catalog
 *   GET    /catalog/match                           → GET  /api/shopping/catalog/match
 *   GET    /catalog/:id                             → GET  /api/shopping/catalog/:id
 *   PUT    /catalog/:id                             → PUT  /api/shopping/catalog/:id
 *   DELETE /catalog/:id                             → DELETE /api/shopping/catalog/:id
 *   POST   /lists/:listId/items/:itemId/canonicalize → POST /api/shopping/lists/:listId/items/:itemId/canonicalize
 *
 * IMPORTANT: `/catalog/match` is registered BEFORE `/catalog/:id` so Fastify
 * does not interpret "match" as a value for :id.
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CatalogItemSchema,
  CatalogMatchResultSchema,
  CanonicalizeItemResponseSchema,
  CreateCatalogItemSchema,
  UpdateCatalogItemSchema,
} from "@compass/shared";
import {
  createCatalogItem,
  deleteCatalogItem,
  getCatalogItem,
  listCatalogItems,
  matchCatalog,
  updateCatalogItem,
  canonicalizeItem,
} from "../services/canonicalize.ts";

const CatalogParams = z.object({ id: z.uuid() });
const CanonicalizeParams = z.object({ listId: z.uuid(), itemId: z.uuid() });
const MatchQuery = z.object({ q: z.string().default("") });

export async function shoppingCatalogRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /catalog — create a new catalog item.
  r.post(
    "/catalog",
    {
      schema: {
        body: CreateCatalogItemSchema,
        response: { 200: CatalogItemSchema },
      },
    },
    async (req) => createCatalogItem(app.db, req.session!.userId, req.body),
  );

  // GET /catalog — list all catalog items for the current user.
  r.get(
    "/catalog",
    {
      schema: {
        response: { 200: z.array(CatalogItemSchema) },
      },
    },
    async (req) => listCatalogItems(app.db, req.session!.userId),
  );

  // GET /catalog/match — case-insensitive exact match by ?q=.
  // MUST be registered before /catalog/:id (static path before param path).
  r.get(
    "/catalog/match",
    {
      schema: {
        querystring: MatchQuery,
        response: { 200: CatalogMatchResultSchema },
      },
    },
    async (req) => matchCatalog(app.db, req.session!.userId, req.query.q),
  );

  // GET /catalog/:id — fetch a single catalog item.
  r.get(
    "/catalog/:id",
    {
      schema: {
        params: CatalogParams,
        response: { 200: CatalogItemSchema },
      },
    },
    async (req) => getCatalogItem(app.db, req.session!.userId, req.params.id),
  );

  // PUT /catalog/:id — full-replace update of a catalog item.
  r.put(
    "/catalog/:id",
    {
      schema: {
        params: CatalogParams,
        body: UpdateCatalogItemSchema,
        response: { 200: CatalogItemSchema },
      },
    },
    async (req) => updateCatalogItem(app.db, req.session!.userId, req.params.id, req.body),
  );

  // DELETE /catalog/:id — delete a catalog item (sets catalogItemId null on linked items).
  r.delete(
    "/catalog/:id",
    {
      schema: {
        params: CatalogParams,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteCatalogItem(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  // POST /lists/:listId/items/:itemId/canonicalize — attempt to auto-link an item.
  r.post(
    "/lists/:listId/items/:itemId/canonicalize",
    {
      schema: {
        params: CanonicalizeParams,
        response: { 200: CanonicalizeItemResponseSchema },
      },
    },
    async (req) =>
      canonicalizeItem(app.db, req.session!.userId, req.params.listId, req.params.itemId),
  );
}
