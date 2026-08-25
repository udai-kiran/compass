import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { GetHarvestPlanQuerySchema, TaxHarvestPlanSchema } from "@compass/shared";
import { getTaxHarvestPlan } from "../services/tax-harvesting.ts";

export async function taxHarvestRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/holdings/tax-harvesting",
    {
      schema: {
        querystring: GetHarvestPlanQuerySchema,
        response: { 200: TaxHarvestPlanSchema },
      },
    },
    async (req) => getTaxHarvestPlan(app.db, req.session!.userId, req.query.fy),
  );
}
