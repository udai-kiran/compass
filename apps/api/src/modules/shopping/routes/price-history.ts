/**
 * Price-history routes (task 10.7). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET /catalog/:itemId/price-history          → GET /api/shopping/catalog/:itemId/price-history
 *   GET /catalog/:itemId/buy-wait               → GET /api/shopping/catalog/:itemId/buy-wait
 *   GET /catalog/:itemId/honesty-check          → GET /api/shopping/catalog/:itemId/honesty-check
 *
 * All 3 routes are GET (not POST) — avoids CSRF-check and demo-mode block.
 * The honesty-check passes all parameters via query string.
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`; read routes are safe for demo sessions.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  BuyNowVsWaitSchema,
  NormalizedUnitSchema,
  PriceHistoryResponseSchema,
  PriceHonestyResultSchema,
} from "@compass/shared";
import {
  analyzeTrend,
  checkPriceHonesty,
  getPriceHistory,
} from "../services/price-history.ts";

const ItemParams = z.object({ itemId: z.uuid() });

const PriceHistoryQuery = z.object({
  /** Filter to a single price source. Omit to return all sources. */
  sourceId: z.uuid().optional(),
});

const BuyWaitQuery = z.object({
  /** Filter to a single price source for the trend calculation. */
  sourceId: z.uuid().optional(),
});

const HonestyCheckQuery = z.object({
  /** Filter observations to a single price source. */
  sourceId: z.uuid().optional(),
  /** The MRP claimed on the product label, in integer paise. Required. */
  claimedMrpPaise: z.coerce.number().int().nonnegative(),
  /** Pack quantity in base units for pack-size-matched comparison. Paired with unit. */
  packQuantityBase: z.coerce.number().int().nonnegative().optional(),
  /** Normalized unit for packQuantityBase. Must be set iff packQuantityBase is set. */
  unit: NormalizedUnitSchema.optional(),
});

export async function shoppingPriceHistoryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /catalog/:itemId/price-history?sourceId= — full history for an item.
  r.get(
    "/catalog/:itemId/price-history",
    {
      schema: {
        params: ItemParams,
        querystring: PriceHistoryQuery,
        response: { 200: PriceHistoryResponseSchema },
      },
    },
    async (req) => {
      const { itemId } = req.params;
      const { sourceId } = req.query;
      const userId = req.session!.userId;
      const points = await getPriceHistory(app.db, userId, itemId, sourceId);
      return {
        catalogItemId: itemId,
        sourceId: sourceId ?? null,
        points,
      };
    },
  );

  // GET /catalog/:itemId/buy-wait?sourceId= — trend + recommendation.
  r.get(
    "/catalog/:itemId/buy-wait",
    {
      schema: {
        params: ItemParams,
        querystring: BuyWaitQuery,
        response: { 200: BuyNowVsWaitSchema },
      },
    },
    async (req) => {
      const { itemId } = req.params;
      const { sourceId } = req.query;
      const userId = req.session!.userId;
      const points = await getPriceHistory(app.db, userId, itemId, sourceId);
      return analyzeTrend(points);
    },
  );

  // GET /catalog/:itemId/honesty-check?... — compare claimed MRP against history.
  r.get(
    "/catalog/:itemId/honesty-check",
    {
      schema: {
        params: ItemParams,
        querystring: HonestyCheckQuery,
        response: { 200: PriceHonestyResultSchema },
      },
    },
    async (req) => {
      const { itemId } = req.params;
      const { sourceId, claimedMrpPaise, packQuantityBase, unit } = req.query;
      const userId = req.session!.userId;
      return checkPriceHonesty(
        app.db,
        userId,
        itemId,
        sourceId,
        claimedMrpPaise,
        packQuantityBase,
        unit,
      );
    },
  );
}
