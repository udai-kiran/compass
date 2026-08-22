/**
 * Pantry management routes (task 11.1). Registered under the `/api/shopping`
 * prefix (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET    /pantry                           → GET    /api/shopping/pantry
 *   POST   /pantry/:catalogItemId/replenish  → POST   /api/shopping/pantry/:catalogItemId/replenish
 *   POST   /pantry/:catalogItemId/correct    → POST   /api/shopping/pantry/:catalogItemId/correct
 *   POST   /pantry/decay                     → POST   /api/shopping/pantry/decay
 *
 * All routes are session-authenticated.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CorrectPantrySchema,
  PantryListResponseSchema,
  ReplenishPantrySchema,
} from "@compass/shared";
import { and, eq } from "drizzle-orm";
import { catalogItems, habitProfiles, pantryItems } from "../schema.ts";
import { correctPantry, decayAllPantryItems, replenishPantry } from "../services/pantry-management.ts";

const PantryParams = z.object({ catalogItemId: z.uuid() });
const DecayResponseSchema = z.object({ decayed: z.number().int().nonnegative() });

export async function shoppingPantryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /pantry — list all pantry items with habit profile and catalog info.
  r.get(
    "/pantry",
    {
      schema: {
        response: { 200: PantryListResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      const rows = await app.db.query.pantryItems.findMany({
        where: eq(pantryItems.userId, userId),
      });

      const items = await Promise.all(
        rows.map(async (p) => {
          const catalogRow = await app.db.query.catalogItems.findFirst({
            where: and(eq(catalogItems.id, p.catalogItemId), eq(catalogItems.userId, userId)),
            columns: { canonicalName: true, brand: true },
          });

          const habitRow = await app.db.query.habitProfiles.findFirst({
            where: and(
              eq(habitProfiles.userId, userId),
              eq(habitProfiles.catalogItemId, p.catalogItemId),
            ),
          });

          return {
            id: p.id,
            catalogItemId: p.catalogItemId,
            canonicalName: catalogRow?.canonicalName ?? "",
            brand: catalogRow?.brand ?? null,
            quantityBase: p.quantityBase ?? null,
            unit: (p.unit as "g" | "ml" | "piece" | null) ?? null,
            lastPurchasedAt: p.lastPurchasedAt ?? null,
            expectedDepletionAt: p.expectedDepletionAt ?? null,
            consumptionBasePerMonth: habitRow?.consumptionBasePerMonth ?? null,
            consumptionUnit: (habitRow?.unit as "g" | "ml" | "piece" | null) ?? null,
            observationCount: habitRow?.observationCount ?? 0,
            lastComputedAt: habitRow?.lastComputedAt ?? null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          };
        }),
      );

      return { items };
    },
  );

  // POST /pantry/:catalogItemId/replenish — replenish stock on confirmed purchase.
  r.post(
    "/pantry/:catalogItemId/replenish",
    {
      schema: {
        params: PantryParams,
        body: ReplenishPantrySchema,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await replenishPantry(
        app.db,
        req.session!.userId,
        req.params.catalogItemId,
        req.body.quantityBase,
        req.body.unit,
      );
      return reply.code(204).send();
    },
  );

  // POST /pantry/:catalogItemId/correct — apply user correction to stock level.
  r.post(
    "/pantry/:catalogItemId/correct",
    {
      schema: {
        params: PantryParams,
        body: CorrectPantrySchema,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await correctPantry(
        app.db,
        req.session!.userId,
        req.params.catalogItemId,
        req.body.quantityBase,
        req.body.unit,
      );
      return reply.code(204).send();
    },
  );

  // POST /pantry/decay — decay all pantry items by learned consumption rate.
  r.post(
    "/pantry/decay",
    {
      schema: {
        response: { 200: DecayResponseSchema },
      },
    },
    async (req) => {
      const decayed = await decayAllPantryItems(app.db, req.session!.userId);
      return { decayed };
    },
  );
}
