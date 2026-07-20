import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateInsurancePolicySchema,
  InsurancePolicySchema,
  LogPremiumSchema,
  PolicyPremiumsSchema,
  UpdateInsurancePolicySchema,
} from "@compass/shared";
import {
  createPolicy,
  deletePolicy,
  listPolicies,
  listPolicyPremiums,
  logPremium,
  updatePolicy,
} from "../services/insurance.ts";

const PolicyParams = z.object({ id: z.uuid() });

export async function insuranceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/insurance/policies",
    { schema: { response: { 200: z.array(InsurancePolicySchema) } } },
    async (req) => listPolicies(app.db, req.session!.userId),
  );

  r.post(
    "/api/insurance/policies",
    { schema: { body: CreateInsurancePolicySchema, response: { 200: InsurancePolicySchema } } },
    async (req) => createPolicy(app.db, req.session!.userId, req.body),
  );

  r.put(
    "/api/insurance/policies/:id",
    {
      schema: {
        params: PolicyParams,
        body: UpdateInsurancePolicySchema,
        response: { 200: InsurancePolicySchema },
      },
    },
    async (req) => updatePolicy(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/insurance/policies/:id",
    { schema: { params: PolicyParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deletePolicy(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.get(
    "/api/insurance/policies/:id/premiums",
    { schema: { params: PolicyParams, response: { 200: PolicyPremiumsSchema } } },
    async (req) => listPolicyPremiums(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/insurance/policies/:id/premiums",
    {
      schema: {
        params: PolicyParams,
        body: LogPremiumSchema,
        response: { 200: PolicyPremiumsSchema },
      },
    },
    async (req) => logPremium(app.db, req.session!.userId, req.params.id, req.body),
  );
}
