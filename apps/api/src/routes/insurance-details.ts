import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  InsuranceDetailsSchema,
  LogPremiumSchema,
  PolicyPremiumsSchema,
  UpsertInsuranceDetailsSchema,
} from "@compass/shared";
import {
  getInsuranceDetails,
  listPolicyPremiums,
  logPremium,
  upsertInsuranceDetails,
} from "../services/insurance-details.ts";

const AccountParams = z.object({ accountId: z.uuid() });

export async function insuranceDetailsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/accounts/:accountId/insurance-details",
    { schema: { params: AccountParams, response: { 200: InsuranceDetailsSchema.nullable() } } },
    async (req) => getInsuranceDetails(app.db, req.session!.userId, req.params.accountId),
  );

  r.put(
    "/api/accounts/:accountId/insurance-details",
    {
      schema: {
        params: AccountParams,
        body: UpsertInsuranceDetailsSchema,
        response: { 200: InsuranceDetailsSchema },
      },
    },
    async (req) =>
      upsertInsuranceDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );

  r.get(
    "/api/accounts/:accountId/insurance-premiums",
    { schema: { params: AccountParams, response: { 200: PolicyPremiumsSchema } } },
    async (req) => listPolicyPremiums(app.db, req.session!.userId, req.params.accountId),
  );

  r.post(
    "/api/accounts/:accountId/insurance-premiums",
    {
      schema: {
        params: AccountParams,
        body: LogPremiumSchema,
        response: { 200: PolicyPremiumsSchema },
      },
    },
    async (req) => logPremium(app.db, req.session!.userId, req.params.accountId, req.body),
  );
}
