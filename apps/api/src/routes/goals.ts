import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateContributionSchema,
  CreateGoalSchema,
  GoalProgressSchema,
  GoalSchema,
  UpdateGoalSchema,
} from "@compass/shared";
import {
  addContribution,
  createGoal,
  deleteContribution,
  deleteGoal,
  getGoalProgress,
  listGoals,
  updateGoal,
} from "../services/goals.ts";

const IdParams = z.object({ id: z.uuid() });
const ContribParams = z.object({ id: z.uuid(), contributionId: z.uuid() });

export async function goalRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/goals",
    { schema: { response: { 200: z.array(GoalSchema) } } },
    async (req) => listGoals(app.db, req.session!.userId),
  );

  r.post(
    "/api/goals",
    { schema: { body: CreateGoalSchema, response: { 201: GoalSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createGoal(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/goals/:id",
    { schema: { params: IdParams, body: UpdateGoalSchema, response: { 200: GoalSchema } } },
    async (req) => updateGoal(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/goals/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteGoal(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.get(
    "/api/goals/:id/progress",
    { schema: { params: IdParams, response: { 200: GoalProgressSchema } } },
    async (req) => getGoalProgress(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/goals/:id/contributions",
    {
      schema: {
        params: IdParams,
        body: CreateContributionSchema,
        response: { 201: GoalProgressSchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await addContribution(app.db, req.session!.userId, req.params.id, req.body)),
  );

  r.delete(
    "/api/goals/:id/contributions/:contributionId",
    { schema: { params: ContribParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteContribution(
        app.db,
        req.session!.userId,
        req.params.id,
        req.params.contributionId,
      );
      return { ok: true };
    },
  );
}
