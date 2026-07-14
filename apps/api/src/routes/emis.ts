import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateEmiSchema, EmiSummarySchema } from "@compass/shared";
import { createEmi, deleteEmi, listEmis } from "../services/emis.ts";
import { materializeDue } from "../services/recurring.ts";
import { invalidateUserCache } from "../services/cache.ts";
import { enqueueBudgetEvaluation } from "../jobs/index.ts";

const IdParams = z.object({ templateId: z.uuid() });

export async function emiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/emis",
    { schema: { response: { 200: z.array(EmiSummarySchema) } } },
    async (req) => listEmis(app.db, req.session!.userId),
  );

  r.post(
    "/api/emis",
    { schema: { body: CreateEmiSchema, response: { 201: EmiSummarySchema } } },
    async (req, reply) => {
      const emi = await createEmi(app.db, req.session!.userId, req.body);
      // land any installments already due (start date in the past) immediately
      const res = await materializeDue(app.db);
      for (const uid of res.userIds) {
        await invalidateUserCache(app.redis, uid);
        await enqueueBudgetEvaluation(app, uid);
      }
      if (res.userIds.length === 0) await invalidateUserCache(app.redis, req.session!.userId);
      return reply.code(201).send(emi);
    },
  );

  r.delete(
    "/api/emis/:templateId",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteEmi(app.db, req.session!.userId, req.params.templateId);
      return { ok: true };
    },
  );
}
