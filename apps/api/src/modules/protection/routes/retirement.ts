import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { RetirementDetailsSchema, UpsertRetirementDetailsSchema } from "@compass/shared";
import { getRetirementDetails, upsertRetirementDetails } from "../services/retirement.ts";

const AccountParams = z.object({ accountId: z.uuid() });

export async function retirementRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/retirement/:accountId/details",
    { schema: { params: AccountParams, response: { 200: RetirementDetailsSchema.nullable() } } },
    async (req) => getRetirementDetails(app.db, req.session!.userId, req.params.accountId),
  );

  r.put(
    "/api/retirement/:accountId/details",
    {
      schema: {
        params: AccountParams,
        body: UpsertRetirementDetailsSchema,
        response: { 200: RetirementDetailsSchema },
      },
    },
    async (req) =>
      upsertRetirementDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );
}
