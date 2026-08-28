import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateEmiSchema, EmiInstallmentSchema, EmiSummarySchema } from "@compass/shared";
import { createEmi, deleteEmi, getEmiDetail, listEmiInstallments, listEmis, upsertEmiDetails } from "../services/emis.ts";
import { materializeDue } from "../../ledger/services/recurring.ts";
import { invalidateUserCache } from "../../../lib/cache.ts";
import { enqueueBudgetEvaluation } from "../../../jobs/index.ts";

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

  r.get(
    "/api/emis/:templateId/installments",
    { schema: { params: IdParams, response: { 200: z.array(EmiInstallmentSchema) } } },
    async (req) => listEmiInstallments(app.db, req.session!.userId, req.params.templateId),
  );

  r.patch(
    "/api/emis/:templateId/loan-account",
    {
      schema: {
        params: IdParams,
        body: z.object({ loanAccountId: z.uuid().nullable() }),
        response: { 200: EmiSummarySchema },
      },
    },
    async (req) => {
      const detail = await getEmiDetail(app.db, req.session!.userId, req.params.templateId);
      const emi = await upsertEmiDetails(app.db, req.session!.userId, req.params.templateId, {
        ...detail,
        loanAccountId: req.body.loanAccountId,
      });
      await invalidateUserCache(app.redis, req.session!.userId);
      return emi;
    },
  );
}
