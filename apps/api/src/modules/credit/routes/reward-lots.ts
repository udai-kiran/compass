import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateRewardPointLotSchema, RewardPointLotSchema } from "@compass/shared";
import { addLot, listExpiringLots, markRedeemed } from "../services/reward-lots.ts";

/**
 * Reward point lots routes. Full /api/credit/reward-lots paths (credit module
 * is not prefix-mounted — routes register with complete paths).
 *
 * - GET   /api/credit/reward-lots?expiringWithinDays=30  list expiring lots
 * - POST  /api/credit/reward-lots                        add a new lot
 * - PATCH /api/credit/reward-lots/:id/redeem             mark a lot redeemed
 */
export async function rewardLotRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/credit/reward-lots",
    {
      schema: {
        querystring: z.object({
          expiringWithinDays: z.coerce.number().int().nonnegative().default(30),
        }),
        response: { 200: z.array(RewardPointLotSchema) },
      },
    },
    async (req) => {
      return listExpiringLots(app.db, req.session!.userId, req.query.expiringWithinDays);
    },
  );

  r.post(
    "/api/credit/reward-lots",
    {
      schema: {
        body: CreateRewardPointLotSchema,
        response: { 201: RewardPointLotSchema },
      },
    },
    async (req, reply) => {
      const lot = await addLot(app.db, req.session!.userId, req.body);
      return reply.code(201).send(lot);
    },
  );

  r.patch(
    "/api/credit/reward-lots/:id/redeem",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: RewardPointLotSchema },
      },
    },
    async (req) => {
      return markRedeemed(app.db, req.session!.userId, req.params.id);
    },
  );
}
