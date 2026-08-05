import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { InsightsSchema } from "@compass/shared";
import { getInsights } from "../services/insights.ts";
import { cached } from "../../../services/cache.ts";
import { currentPeriodKey } from "../../../services/periods.ts";

export async function insightRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/insights",
    {
      schema: {
        querystring: z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
        response: { 200: InsightsSchema },
      },
    },
    async (req) => {
      const period = req.query.period ?? currentPeriodKey("monthly");
      return cached(app.redis, req.session!.userId, `insights:${period}`, 300, () =>
        getInsights(app.db, req.session!.userId, period),
      );
    },
  );
}
