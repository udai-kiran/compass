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
import { MAX_ATTACHMENT_BYTES } from "../modules/ledger/services/attachments.ts";
import {
  addHealthCard,
  createPolicy,
  deleteHealthCard,
  deletePolicy,
  deletePolicyDocument,
  listPolicies,
  listPolicyPremiums,
  logPremium,
  readHealthCard,
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
      await deletePolicy(app.db, req.session!.userId, req.params.id, app.storage);
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
    const policy = await savePolicyDocument(app.db, app.storage, req.session!.userId, id, {
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
      app.storage,
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
      deletePolicyDocument(app.db, app.storage, req.session!.userId, req.params.id),
  );

  // ---- health cards (multiple uploaded files per policy) ----

  // multipart body; the member label rides as a ?label= query param
  app.post("/api/insurance/policies/:id/health-cards", async (req, reply) => {
    const { id } = PolicyParams.parse(req.params);
    const label = z.object({ label: z.string().max(120).default("") }).parse(req.query).label;
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart file field");
    const data = await file.toBuffer();
    const policy = await addHealthCard(
      app.db,
      app.storage,
      req.session!.userId,
      id,
      { fileName: file.filename, mimeType: file.mimetype, data },
      label,
    );
    return reply.code(201).send(policy);
  });

  app.get("/api/insurance/health-cards/:cardId", async (req, reply) => {
    const { cardId } = z.object({ cardId: z.uuid() }).parse(req.params);
    const { fileName, mimeType, data } = await readHealthCard(
      app.db,
      app.storage,
      req.session!.userId,
      cardId,
    );
    return reply
      .header("content-type", mimeType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(fileName)}"`)
      .send(data);
  });

  r.delete(
    "/api/insurance/policies/:id/health-cards/:cardId",
    {
      schema: {
        params: z.object({ id: z.uuid(), cardId: z.uuid() }),
        response: { 200: InsurancePolicySchema },
      },
    },
    async (req) =>
      deleteHealthCard(app.db, app.storage, req.session!.userId, req.params.id, req.params.cardId),
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
