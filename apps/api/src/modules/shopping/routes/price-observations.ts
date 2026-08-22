/**
 * Price-observation routes (task 10.1). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET    /observations              → GET  /api/shopping/observations
 *   POST   /observations              → POST /api/shopping/observations
 *   DELETE /observations/:id          → DELETE /api/shopping/observations/:id
 *
 * GET /observations requires `?catalogItemId=<uuid>` — observations are always
 * scoped to a single catalog item. The service computes `isStale` in-process
 * (> 7 days from observedAt to now).
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreatePriceObservationSchema,
  PriceObservationSchema,
  PriceObservationsResponseSchema,
} from "@compass/shared";
import {
  createObservation,
  deleteObservation,
  listObservations,
} from "../services/price-observations.ts";

const ObsParams = z.object({ id: z.uuid() });
const ObsQuery = z.object({ catalogItemId: z.uuid() });

export async function shoppingPriceObservationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /observations?catalogItemId= — list observations for a catalog item.
  r.get(
    "/observations",
    {
      schema: {
        querystring: ObsQuery,
        response: { 200: PriceObservationsResponseSchema },
      },
    },
    async (req) => {
      const observations = await listObservations(
        app.db,
        req.session!.userId,
        req.query.catalogItemId,
      );
      return { observations };
    },
  );

  // POST /observations — create a new price observation.
  r.post(
    "/observations",
    {
      schema: {
        body: CreatePriceObservationSchema,
        response: { 200: PriceObservationSchema },
      },
    },
    async (req) => createObservation(app.db, req.session!.userId, req.body),
  );

  // DELETE /observations/:id — delete an observation, returns 204.
  r.delete(
    "/observations/:id",
    {
      schema: {
        params: ObsParams,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await deleteObservation(app.db, req.session!.userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
