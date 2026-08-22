/**
 * Price-source routes (task 10.1). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET    /sources        → GET  /api/shopping/sources
 *   POST   /sources        → POST /api/shopping/sources
 *   PUT    /sources/:id    → PUT  /api/shopping/sources/:id
 *   DELETE /sources/:id    → DELETE /api/shopping/sources/:id
 *
 * GET /sources calls `ensurePlatformSeeds` before listing — idempotent
 * (ON CONFLICT DO NOTHING), so the 11 platform rows appear on first visit
 * without any migration or admin step.
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreatePriceSourceSchema,
  PriceSourceSchema,
  UpdatePriceSourceSchema,
} from "@compass/shared";
import {
  createPriceSource,
  deletePriceSource,
  listPriceSources,
  updatePriceSource,
} from "../services/price-sources.ts";
import { ensurePlatformSeeds } from "../services/platform-seeds.ts";

const SourceParams = z.object({ id: z.uuid() });

export async function shoppingPriceSourceRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /sources — seed platforms idempotently, then list all sources.
  r.get(
    "/sources",
    {
      schema: {
        response: { 200: z.array(PriceSourceSchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      await ensurePlatformSeeds(app.db, userId);
      return listPriceSources(app.db, userId);
    },
  );

  // POST /sources — create a new price source.
  r.post(
    "/sources",
    {
      schema: {
        body: CreatePriceSourceSchema,
        response: { 200: PriceSourceSchema },
      },
    },
    async (req) => createPriceSource(app.db, req.session!.userId, req.body),
  );

  // PUT /sources/:id — full-replace update.
  r.put(
    "/sources/:id",
    {
      schema: {
        params: SourceParams,
        body: UpdatePriceSourceSchema,
        response: { 200: PriceSourceSchema },
      },
    },
    async (req) => updatePriceSource(app.db, req.session!.userId, req.params.id, req.body),
  );

  // DELETE /sources/:id — soft-delete (sets isActive=false), returns 204.
  r.delete(
    "/sources/:id",
    {
      schema: {
        params: SourceParams,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await deletePriceSource(app.db, req.session!.userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
