import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { FinancialGuardsQuerySchema, FinancialGuardsResponseSchema } from "@compass/shared";
import { checkBudgetCap, computeGoalImpact, decomposeEmi } from "../services/financial-guards.ts";

/** Read-only shopping-cart financial advice; intentionally safe for demo sessions. */
export async function financialGuardRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/guards/check",
    {
      schema: {
        querystring: FinancialGuardsQuerySchema,
        response: { 200: FinancialGuardsResponseSchema },
      },
    },
    async (req) => {
      const { cartTotalPaise, categoryId, emiOffers } = req.query;
      const userId = req.session!.userId;
      const [budget, goals] = await Promise.all([
        checkBudgetCap(app.db, userId, cartTotalPaise, categoryId),
        computeGoalImpact(app.db, userId, cartTotalPaise),
      ]);
      const emi = emiOffers?.length
        ? {
            offers: emiOffers.map((offer, offerIndex) => ({
              offerIndex,
              ...decomposeEmi(
                offer.principalPaise,
                offer.tenureMonths,
                offer.annualRateBps,
                offer.processingFeeBps,
              ),
            })),
          }
        : null;
      return { budget, goals, emi };
    },
  );
}
