import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateRewardRuleSchema, RewardRuleSchema, UpdateRewardRuleSchema } from "@compass/shared";
import {
  listRewardRules,
  createRewardRule,
  updateRewardRule,
  deleteRewardRule,
} from "../services/reward-rules.ts";

/**
 * Reward rules CRUD routes. Full /api/credit/reward-rules paths (credit module
 * is not prefix-mounted — routes register with complete paths).
 *
 * - GET    /api/credit/reward-rules         list all rules for the user
 * - POST   /api/credit/reward-rules         create a new rule
 * - PUT    /api/credit/reward-rules/:id     update a rule (full replacement)
 * - DELETE /api/credit/reward-rules/:id     delete a rule
 */
export async function rewardRuleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/credit/reward-rules",
    {
      schema: {
        response: { 200: z.array(RewardRuleSchema) },
      },
    },
    async (req) => {
      return listRewardRules(app.db, req.session!.userId);
    },
  );

  r.post(
    "/api/credit/reward-rules",
    {
      schema: {
        body: CreateRewardRuleSchema,
        response: { 201: RewardRuleSchema },
      },
    },
    async (req, reply) => {
      const rule = await createRewardRule(app.db, req.session!.userId, req.body);
      return reply.code(201).send(rule);
    },
  );

  r.put(
    "/api/credit/reward-rules/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: UpdateRewardRuleSchema,
        response: { 200: RewardRuleSchema },
      },
    },
    async (req) => {
      return updateRewardRule(app.db, req.session!.userId, req.params.id, req.body);
    },
  );

  r.delete(
    "/api/credit/reward-rules/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await deleteRewardRule(app.db, req.session!.userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
