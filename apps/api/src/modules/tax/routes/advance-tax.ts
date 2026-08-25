/**
 * advance-tax.ts — Route: advance tax position with Sec 234B/234C (task 13.10).
 *
 * GET /advance-tax?fy=YYYY-YY — estimate only; see service assumptions.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AdvanceTaxPositionSchema, GetAdvanceTaxQuerySchema } from "@compass/shared";
import { getAdvanceTaxPosition } from "../services/advance-tax.ts";

export async function advanceTaxRoutes(app: FastifyInstance): Promise<void> {
  const a = app.withTypeProvider<ZodTypeProvider>();

  a.get(
    "/advance-tax",
    {
      schema: {
        querystring: GetAdvanceTaxQuerySchema,
        response: { 200: AdvanceTaxPositionSchema },
      },
    },
    async (req, reply) => {
      const position = await getAdvanceTaxPosition(app.db, req.session!.userId, req.query.fy);
      return reply.send(position);
    },
  );
}
