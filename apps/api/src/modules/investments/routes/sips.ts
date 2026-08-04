import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateSipSchema,
  HoldingEventSchema,
  LinkSipInstallmentSchema,
  RecordSipInstallmentSchema,
  SipInstallmentCandidateSchema,
  SipSchema,
  UpdateSipSchema,
  defaultSipDate,
} from "@compass/shared";
import {
  createSip,
  deleteSip,
  listAllSips,
  listSipsForGoal,
  updateSip,
} from "../services/sip-lifecycle.ts";
import {
  linkSipInstallment,
  listSipInstallmentCandidates,
  recordSipInstallment,
  unlinkSipInstallment,
} from "../services/sip-installments.ts";
import { invalidateUserCache } from "../../../services/cache.ts";

const IdParams = z.object({ id: z.uuid() });
const GoalIdParams = z.object({ id: z.uuid() });

export async function sipRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/sips",
    { schema: { response: { 200: z.array(SipSchema) } } },
    async (req) => listAllSips(app.db, req.session!.userId),
  );

  r.get(
    "/api/goals/:id/sips",
    { schema: { params: GoalIdParams, response: { 200: z.array(SipSchema) } } },
    async (req) => listSipsForGoal(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/sips",
    { schema: { body: CreateSipSchema, response: { 201: SipSchema } } },
    async (req, reply) => {
      const sip = await createSip(app.db, req.session!.userId, req.body);
      await invalidateUserCache(app.redis, req.session!.userId);
      return reply.code(201).send(sip);
    },
  );

  r.patch(
    "/api/sips/:id",
    { schema: { params: IdParams, body: UpdateSipSchema, response: { 200: SipSchema } } },
    async (req) => {
      const sip = await updateSip(app.db, req.session!.userId, req.params.id, req.body);
      await invalidateUserCache(app.redis, req.session!.userId);
      return sip;
    },
  );

  r.delete(
    "/api/sips/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteSip(app.db, req.session!.userId, req.params.id);
      await invalidateUserCache(app.redis, req.session!.userId);
      return { ok: true };
    },
  );

  r.post(
    "/api/sips/:id/installments",
    { schema: { params: IdParams, body: RecordSipInstallmentSchema, response: { 201: HoldingEventSchema } } },
    async (req, reply) => {
      const event = await recordSipInstallment(app.db, req.session!.userId, req.params.id, req.body);
      await invalidateUserCache(app.redis, req.session!.userId);
      return reply.code(201).send(event);
    },
  );

  r.post(
    "/api/sips/:id/installments/link",
    { schema: { params: IdParams, body: LinkSipInstallmentSchema, response: { 200: SipSchema } } },
    async (req) => {
      const sip = await linkSipInstallment(app.db, req.session!.userId, req.params.id, req.body);
      await invalidateUserCache(app.redis, req.session!.userId);
      return sip;
    },
  );

  r.delete(
    "/api/sips/:id/installments/link/:transactionId",
    {
      schema: {
        params: z.object({ id: z.uuid(), transactionId: z.uuid() }),
        response: { 200: SipSchema },
      },
    },
    // Clears the sip_id link only — never deletes the underlying transaction.
    async (req) => {
      const sip = await unlinkSipInstallment(app.db, req.session!.userId, req.params.id, req.params.transactionId);
      await invalidateUserCache(app.redis, req.session!.userId);
      return sip;
    },
  );

  r.get(
    "/api/sips/:id/installment-candidates",
    {
      schema: {
        params: IdParams,
        querystring: z.object({ date: z.iso.date().default(() => defaultSipDate()) }),
        response: { 200: z.array(SipInstallmentCandidateSchema) },
      },
    },
    async (req) => listSipInstallmentCandidates(app.db, req.session!.userId, req.params.id, req.query.date),
  );
}
