import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BudgetComparisonSchema,
  BudgetPeriodSchema,
  BudgetSchema,
  BudgetSuggestionSchema,
  BudgetUtilizationSchema,
  CreateBudgetSchema,
  PeriodKeySchema,
  UpsertBudgetLineSchema,
} from "@compass/shared";
import {
  comparePeriods,
  copyFromPreviousPeriod,
  deleteBudgetLine,
  getUtilization,
  suggestBudget,
  upsertBudget,
  upsertBudgetLine,
} from "../services/budgets.ts";
import { invalidateUserCache } from "../../../lib/cache.ts";
import { enqueueBudgetEvaluation } from "../../../jobs/index.ts";

const PeriodParams = z.object({ period: BudgetPeriodSchema, key: PeriodKeySchema });

export async function budgetRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const afterWrite = async (userId: string) => {
    await invalidateUserCache(app.redis, userId);
    await enqueueBudgetEvaluation(app, userId);
  };

  r.get(
    "/api/budgets/suggestions",
    { schema: { response: { 200: z.array(BudgetSuggestionSchema) } } },
    async (req) => suggestBudget(app.db, req.session!.userId),
  );

  r.get(
    "/api/budgets/:period/:key",
    { schema: { params: PeriodParams, response: { 200: BudgetUtilizationSchema } } },
    async (req) => getUtilization(app.db, req.session!.userId, req.params.period, req.params.key),
  );

  r.put(
    "/api/budgets/:period/:key",
    {
      schema: {
        params: PeriodParams,
        body: CreateBudgetSchema.omit({ period: true, periodKey: true }),
        response: { 200: BudgetSchema },
      },
    },
    async (req) => {
      const budget = await upsertBudget(app.db, req.session!.userId, {
        period: req.params.period,
        periodKey: req.params.key,
        lines: req.body.lines,
      });
      await afterWrite(req.session!.userId);
      return budget;
    },
  );

  r.put(
    "/api/budgets/:period/:key/lines",
    { schema: { params: PeriodParams, body: UpsertBudgetLineSchema, response: { 200: BudgetSchema } } },
    async (req) => {
      const budget = await upsertBudgetLine(
        app.db,
        req.session!.userId,
        req.params.period,
        req.params.key,
        req.body,
      );
      await afterWrite(req.session!.userId);
      return budget;
    },
  );

  r.delete(
    "/api/budgets/:period/:key/lines/:categoryId",
    {
      schema: {
        params: PeriodParams.extend({ categoryId: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteBudgetLine(
        app.db,
        req.session!.userId,
        req.params.period,
        req.params.key,
        req.params.categoryId,
      );
      await afterWrite(req.session!.userId);
      return { ok: true };
    },
  );

  r.post(
    "/api/budgets/:period/:key/copy-previous",
    { schema: { params: PeriodParams, response: { 200: BudgetSchema } } },
    async (req) => {
      const budget = await copyFromPreviousPeriod(
        app.db,
        req.session!.userId,
        req.params.period,
        req.params.key,
      );
      await afterWrite(req.session!.userId);
      return budget;
    },
  );

  r.get(
    "/api/budgets/monthly/:key/comparison",
    {
      schema: {
        params: z.object({ key: PeriodKeySchema }),
        response: { 200: BudgetComparisonSchema },
      },
    },
    async (req) => comparePeriods(app.db, req.session!.userId, req.params.key),
  );
}
