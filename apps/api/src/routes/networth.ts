import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { NetWorthByGoalSchema, NetWorthReportSchema } from "@compass/shared";
import { backfillSnapshots, getNetWorthReport } from "../services/networth.ts";
import { netWorthByGoal } from "../services/goal-networth.ts";

export async function netWorthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/net-worth",
    { schema: { response: { 200: NetWorthReportSchema } } },
    async (req) => getNetWorthReport(app.db, req.session!.userId),
  );

  r.get(
    "/api/net-worth/by-goal",
    { schema: { response: { 200: NetWorthByGoalSchema } } },
    async (req) => netWorthByGoal(app.db, req.session!.userId),
  );

  r.post(
    "/api/net-worth/backfill",
    {
      schema: {
        body: z.object({ months: z.number().int().min(1).max(60).default(12) }),
        response: { 200: NetWorthReportSchema },
      },
    },
    async (req) => {
      await backfillSnapshots(app.db, req.session!.userId, req.body.months);
      return getNetWorthReport(app.db, req.session!.userId);
    },
  );
}
