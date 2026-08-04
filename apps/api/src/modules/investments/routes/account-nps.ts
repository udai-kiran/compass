import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AccountNpsDetailsSchema, UpsertAccountNpsDetailsSchema } from "@compass/shared";
import { getAccountNpsDetails, upsertAccountNpsDetails } from "../services/account-nps.ts";

const AccountParams = z.object({ accountId: z.uuid() });

export async function accountNpsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/accounts/:accountId/nps-details",
    { schema: { params: AccountParams, response: { 200: AccountNpsDetailsSchema.nullable() } } },
    async (req) => getAccountNpsDetails(app.db, req.session!.userId, req.params.accountId),
  );

  r.put(
    "/api/accounts/:accountId/nps-details",
    {
      schema: {
        params: AccountParams,
        body: UpsertAccountNpsDetailsSchema,
        response: { 200: AccountNpsDetailsSchema },
      },
    },
    async (req) => upsertAccountNpsDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );
}
