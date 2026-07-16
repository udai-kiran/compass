import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { BankDetailsSchema, UpsertBankDetailsSchema } from "@compass/shared";
import { getBankDetails, upsertBankDetails } from "../services/bank-details.ts";

const AccountParams = z.object({ accountId: z.uuid() });

export async function bankDetailsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/accounts/:accountId/bank-details",
    { schema: { params: AccountParams, response: { 200: BankDetailsSchema.nullable() } } },
    async (req) => getBankDetails(app.db, req.session!.userId, req.params.accountId),
  );

  r.put(
    "/api/accounts/:accountId/bank-details",
    {
      schema: {
        params: AccountParams,
        body: UpsertBankDetailsSchema,
        response: { 200: BankDetailsSchema },
      },
    },
    async (req) => upsertBankDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );
}
