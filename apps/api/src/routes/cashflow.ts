import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CashflowMonthSchema, ForecastSchema } from "@compass/shared";
import { cashflowCsv, getCashflow, getForecast } from "../services/cashflow.ts";

const MonthsQuery = z.object({ months: z.coerce.number().int().min(3).max(36).default(12) });

export async function cashflowRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/cashflow",
    { schema: { querystring: MonthsQuery, response: { 200: z.array(CashflowMonthSchema) } } },
    async (req) => getCashflow(app.db, app.redis, req.session!.userId, req.query.months),
  );

  r.get(
    "/api/cashflow/export.csv",
    { schema: { querystring: MonthsQuery } },
    async (req, reply) => {
      const rows = await getCashflow(app.db, app.redis, req.session!.userId, req.query.months);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="cashflow-${req.query.months}mo.csv"`)
        .send(cashflowCsv(rows));
    },
  );

  r.get(
    "/api/forecast",
    { schema: { response: { 200: ForecastSchema } } },
    async (req) => getForecast(app.db, app.redis, req.session!.userId),
  );
}
