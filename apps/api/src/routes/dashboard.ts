import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { DashboardSchema, TrendsSchema } from "@compass/shared";
import { getDashboard, getTrends } from "../services/dashboard.ts";

export async function dashboardRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/dashboard",
    { schema: { response: { 200: DashboardSchema } } },
    async (req) => getDashboard(app.db, app.redis, req.session!.userId),
  );

  r.get(
    "/api/trends",
    {
      schema: {
        querystring: z.object({ months: z.coerce.number().int().min(3).max(36).default(12) }),
        response: { 200: TrendsSchema },
      },
    },
    async (req) => getTrends(app.db, app.redis, req.session!.userId, req.query.months),
  );
}
