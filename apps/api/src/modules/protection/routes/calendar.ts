import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MaturityCalendarSchema } from "@compass/shared";
import { getMaturityCalendar } from "../services/calendar-data.ts";

export async function calendarRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/protection/calendar",
    { schema: { response: { 200: MaturityCalendarSchema } } },
    async (req) => getMaturityCalendar(app.db, req.session!.userId),
  );
}
