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
import { HttpError } from "../lib/errors.ts";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.ts";
import {
  createPolicy,
  deletePolicy,
  deletePolicyDocument,
  listPolicies,
  listPolicyPremiums,
  logPremium,
  readPolicyDocument,
  savePolicyDocument,
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
      await deletePolicy(app.db, req.session!.userId, req.params.id, app.config.STORAGE_DIR);
      return { ok: true };
    },
  );

  // ---- policy document (single uploaded file per policy) ----

  // multipart body — schema validation not applicable
  app.post("/api/insurance/policies/:id/document", async (req, reply) => {
    const { id } = PolicyParams.parse(req.params);
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart file field");
    const data = await file.toBuffer();
    const policy = await savePolicyDocument(app.db, app.config.STORAGE_DIR, req.session!.userId, id, {
      fileName: file.filename,
      mimeType: file.mimetype,
      data,
    });
    return reply.code(201).send(policy);
  });

  app.get("/api/insurance/policies/:id/document", async (req, reply) => {
    const { id } = PolicyParams.parse(req.params);
    const { fileName, mimeType, data } = await readPolicyDocument(
      app.db,
      app.config.STORAGE_DIR,
      req.session!.userId,
      id,
    );
    return reply
      .header("content-type", mimeType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(fileName)}"`)
      .send(data);
  });

  r.delete(
    "/api/insurance/policies/:id/document",
    { schema: { params: PolicyParams, response: { 200: InsurancePolicySchema } } },
    async (req) =>
      deletePolicyDocument(app.db, app.config.STORAGE_DIR, req.session!.userId, req.params.id),
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
