/**
 * Basket arbitrage route (task 10.3). Registered under the `/api/shopping` prefix:
 *   POST /lists/:listId/arbitrage → POST /api/shopping/lists/:listId/arbitrage
 *
 * Loads the items for the given shopping list, fetches the most recent price
 * observation per (catalogItemId × sourceId) across all active serviceable
 * sources, and calls the pure optimizeBasket function to find the cheapest split.
 *
 * Source cap: MAX_SOURCES=15. Returns 400 if exceeded.
 * Items with no catalog link or no price observations go in `unpricedItemIds`.
 *
 * Serviceability filter: exclude sources with ANY confirmed isServiceable=false
 * record. Sources with null (unknown) or true records are included.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { BasketArbitrageResultSchema } from "@compass/shared";
import {
  priceObservations,
  priceSources,
  serviceabilityChecks,
  shoppingListItems,
  shoppingLists,
} from "../schema.ts";
import { MAX_SOURCES, optimizeBasket } from "../services/basket-arbitrage.ts";
import { HttpError } from "../../../lib/errors.ts";

const ArbitrageParams = z.object({ listId: z.uuid() });

export async function shoppingArbitrageRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /lists/:listId/arbitrage — compute cheapest split for the list.
  r.post(
    "/lists/:listId/arbitrage",
    {
      schema: {
        params: ArbitrageParams,
        response: { 200: BasketArbitrageResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const { listId } = req.params;

      // 1. Verify list ownership.
      const list = await app.db.query.shoppingLists.findFirst({
        where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
        columns: { id: true },
      });
      if (!list) throw new HttpError(404, "Shopping list not found");

      // 2. Load list items (all statuses — optimizer reports unpriced, not status).
      const items = await app.db.query.shoppingListItems.findMany({
        where: eq(shoppingListItems.listId, listId),
      });

      // 3. Fetch all active price sources for the user.
      const allSources = await app.db.query.priceSources.findMany({
        where: and(eq(priceSources.userId, userId), eq(priceSources.isActive, true)),
      });

      // 4. Exclude sources confirmed not serviceable (isServiceable = false for ANY pincode).
      //    Sources with null (unknown) or true checks are kept.
      const notServiceableSourceIds = new Set(
        (
          await app.db
            .select({ priceSourceId: serviceabilityChecks.priceSourceId })
            .from(serviceabilityChecks)
            .where(
              and(
                eq(serviceabilityChecks.userId, userId),
                eq(serviceabilityChecks.isServiceable, false),
              ),
            )
        ).map((row) => row.priceSourceId),
      );

      const serviceableSources = allSources.filter((s) => !notServiceableSourceIds.has(s.id));

      // 5. Check source cap before building the price map — return 400 early.
      if (serviceableSources.length > MAX_SOURCES) {
        throw new HttpError(
          400,
          `Too many active serviceable sources: ${serviceableSources.length}. Maximum is ${MAX_SOURCES}.`,
        );
      }

      // 6. Build SourceInfo for the optimizer (null deliveryFee → 0).
      const sourceInfos = serviceableSources.map((s) => ({
        sourceId: s.id,
        sourceName: s.name,
        deliveryFeePaise: s.deliveryFeePaise ?? 0,
        minCartPaise: s.minCartPaise ?? null,
      }));

      // 7. Collect catalog item IDs from list items that have a catalog link.
      const itemsWithCatalog = items.filter((i) => i.catalogItemId !== null);
      const catalogItemIds = [...new Set(itemsWithCatalog.map((i) => i.catalogItemId!))];
      const sourceIds = serviceableSources.map((s) => s.id);

      // 8. Fetch the most recent price observation per (catalogItemId, sourceId).
      //    Map to list-item-level keys: `${listItemId}:${sourceId}`.
      const priceMap = new Map<string, { pricePaise: number; observedAt: Date }>();

      if (catalogItemIds.length > 0 && sourceIds.length > 0) {
        const obsRows = await app.db
          .select({
            catalogItemId: priceObservations.catalogItemId,
            priceSourceId: priceObservations.priceSourceId,
            pricePaise: priceObservations.pricePaise,
            observedAt: priceObservations.observedAt,
          })
          .from(priceObservations)
          .where(
            and(
              eq(priceObservations.userId, userId),
              inArray(priceObservations.catalogItemId, catalogItemIds),
              inArray(priceObservations.priceSourceId, sourceIds),
            ),
          )
          .orderBy(desc(priceObservations.observedAt));

        // Group by (catalogItemId, sourceId), keeping the first (most recent) row.
        // Then propagate to all list items that share the same catalogItemId.
        const seenCatalogSourcePairs = new Set<string>();
        for (const obs of obsRows) {
          const pairKey = `${obs.catalogItemId}:${obs.priceSourceId}`;
          if (seenCatalogSourcePairs.has(pairKey)) continue;
          seenCatalogSourcePairs.add(pairKey);

          // Set a price entry for each list item linked to this catalog item.
          for (const item of itemsWithCatalog) {
            if (item.catalogItemId === obs.catalogItemId) {
              const mapKey = `${item.id}:${obs.priceSourceId}`;
              if (!priceMap.has(mapKey)) {
                priceMap.set(mapKey, {
                  pricePaise: obs.pricePaise,
                  observedAt: obs.observedAt,
                });
              }
            }
          }
        }
      }

      // 9. Call the pure optimizer.
      return optimizeBasket(
        items.map((i) => i.id),
        sourceInfos,
        priceMap,
      );
    },
  );
}
