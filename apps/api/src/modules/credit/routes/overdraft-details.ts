import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { OverdraftDetailsSchema, UpsertOverdraftDetailsSchema } from "@compass/shared";
import { getOverdraftDetails, upsertOverdraftDetails } from "../services/overdraft-details.ts";

const AccountParams = z.object({ accountId: z.uuid() });

export async function overdraftDetailsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/accounts/:accountId/overdraft-details",
    { schema: { params: AccountParams, response: { 200: OverdraftDetailsSchema.nullable() } } },
    async (req) => getOverdraftDetails(app.db, req.session!.userId, req.params.accountId),
  );

  r.put(
    "/api/accounts/:accountId/overdraft-details",
    {
      schema: {
        params: AccountParams,
        body: UpsertOverdraftDetailsSchema,
        response: { 200: OverdraftDetailsSchema },
      },
    },
    async (req) =>
      upsertOverdraftDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );
}
