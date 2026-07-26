import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ReportSchema, ReportQuerySchema } from "@compass/shared";
import { buildReport, reportToCsv } from "../services/reports.ts";

export async function reportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/reports",
    { schema: { querystring: ReportQuerySchema, response: { 200: ReportSchema } } },
    async (req) => buildReport(app.db, req.session!.userId, req.query),
  );

  // CSV download — no response schema (returns text/csv)
  r.get(
    "/api/reports.csv",
    { schema: { querystring: ReportQuerySchema } },
    async (req, reply) => {
      const report = await buildReport(app.db, req.session!.userId, req.query);
      const csv = reportToCsv(report);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="compass-${report.period}-${report.periodKey}.csv"`,
        )
        .send(csv);
    },
  );
}
