/**
 * Habit-profile routes (task 11.1). Registered under the `/api/shopping`
 * prefix (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET   /habits                           → GET  /api/shopping/habits
 *   POST  /habits/:catalogItemId/recompute  → POST /api/shopping/habits/:catalogItemId/recompute
 *
 * All routes are session-authenticated.
 * Demo sessions are automatically rejected on mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  type HabitProfile,
  HabitProfileListResponseSchema,
  RecomputeHabitResponseSchema,
} from "@compass/shared";
import { and, eq } from "drizzle-orm";
import { habitProfiles, shoppingListItems, shoppingLists } from "../schema.ts";
import { assertOwnedCatalogItem } from "../services/ownership.ts";
import { learnConsumptionRate } from "../services/consumption-rate.ts";

const HabitParams = z.object({ catalogItemId: z.uuid() });

export async function shoppingHabitProfileRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /habits — list all habit profiles for the user.
  r.get(
    "/habits",
    {
      schema: {
        response: { 200: HabitProfileListResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const rows = await app.db.query.habitProfiles.findMany({
        where: eq(habitProfiles.userId, userId),
      });

      const profiles = rows.map((h) => ({
        id: h.id,
        catalogItemId: h.catalogItemId,
        consumptionBasePerMonth: h.consumptionBasePerMonth ?? null,
        unit: (h.unit as "g" | "ml" | "piece" | null) ?? null,
        observationCount: h.observationCount,
        lastComputedAt: h.lastComputedAt ?? null,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      }));

      return { profiles };
    },
  );

  // POST /habits/:catalogItemId/recompute — recompute habit profile from purchase history.
  r.post(
    "/habits/:catalogItemId/recompute",
    {
      schema: {
        params: HabitParams,
        response: { 200: RecomputeHabitResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const { catalogItemId } = req.params;

      await assertOwnedCatalogItem(app.db, userId, catalogItemId);

      // Count bought purchases for response.
      const rows = await app.db
        .select({ id: shoppingListItems.id })
        .from(shoppingListItems)
        .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
        .where(
          and(
            eq(shoppingListItems.catalogItemId, catalogItemId),
            eq(shoppingListItems.status, "bought"),
            eq(shoppingLists.userId, userId),
          ),
        );
      const purchaseCount = rows.length;

      const profileRow = await learnConsumptionRate(app.db, userId, catalogItemId);

      // If no profile could be computed, load the existing one (or return null).
      let profile: HabitProfile | null;
      if (profileRow !== null) {
        profile = {
          id: profileRow.id,
          catalogItemId: profileRow.catalogItemId,
          consumptionBasePerMonth: profileRow.consumptionBasePerMonth ?? null,
          unit: (profileRow.unit as "g" | "ml" | "piece" | null) ?? null,
          observationCount: profileRow.observationCount,
          lastComputedAt: profileRow.lastComputedAt ?? null,
          createdAt: profileRow.createdAt,
          updatedAt: profileRow.updatedAt,
        };
      } else {
        // No rate computed — load whatever exists (may have been created earlier).
        const existing = await app.db.query.habitProfiles.findFirst({
          where: and(
            eq(habitProfiles.userId, userId),
            eq(habitProfiles.catalogItemId, catalogItemId),
          ),
        });
        if (!existing) {
          // No profile at all and insufficient data to compute one — return null.
          return { profile: null, purchaseCount };
        }
        profile = {
          id: existing.id,
          catalogItemId: existing.catalogItemId,
          consumptionBasePerMonth: existing.consumptionBasePerMonth ?? null,
          unit: (existing.unit as "g" | "ml" | "piece" | null) ?? null,
          observationCount: existing.observationCount,
          lastComputedAt: existing.lastComputedAt ?? null,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        };
      }

      return { profile, purchaseCount };
    },
  );
}
