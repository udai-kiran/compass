/**
 * Checkout recommendation route (task 10.6).
 * Registered under the `/api/shopping` prefix:
 *   POST /recommend → POST /api/shopping/recommend
 *
 * Returns a per-item checkout recommendation combining basket-arbitrage
 * costs, active card offers, and reward earn rates. Read-only — no purchase
 * is triggered.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { CheckoutRecommendationSchema } from "@compass/shared";
import { buildCheckoutRecommendation } from "../services/checkout-recommendation-loader.ts";

const RecommendBody = z.object({
  listId: z.uuid(),
  /** Optional delivery pincode for future serviceability filtering. */
  pincode: z.string().min(1).optional(),
});

export async function checkoutRecommendationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /recommend — compute deal- & reward-aware checkout recommendation.
  r.post(
    "/recommend",
    {
      schema: {
        body: RecommendBody,
        response: { 200: CheckoutRecommendationSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const { listId, pincode } = req.body;
      return buildCheckoutRecommendation(app.db, userId, listId, pincode);
    },
  );
}
