import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ReportSchema, ReportPeriodSchema } from "@compass/shared";
import { buildReport, reportToCsv } from "../services/reports.ts";

const Query = z.object({
  period: ReportPeriodSchema.default("monthly"),
  key: z.string().regex(/^\d{4}(-\d{2})?$/),
});

export async function reportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/reports",
    { schema: { querystring: Query, response: { 200: ReportSchema } } },
    async (req) => buildReport(app.db, req.session!.userId, req.query.period, req.query.key),
  );

  // CSV download — no response schema (returns text/csv)
  r.get(
    "/api/reports.csv",
    { schema: { querystring: Query } },
    async (req, reply) => {
      const report = await buildReport(app.db, req.session!.userId, req.query.period, req.query.key);
      const csv = reportToCsv(report);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="compass-${req.query.period}-${req.query.key}.csv"`)
        .send(csv);
    },
  );
}
