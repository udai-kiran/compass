import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateRecurringTemplateSchema,
  RecurringTemplateSchema,
  UpdateRecurringTemplateSchema,
} from "@compass/shared";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  materializeDue,
  updateTemplate,
} from "../services/recurring.ts";

const IdParams = z.object({ id: z.uuid() });

export async function recurringRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const materializeNow = async (userId: string) => {
    // pick up instances due today immediately instead of waiting for the daily job
    const res = await materializeDue(app.db);
    if (res.userIds.length > 0) {
      for (const uid of res.userIds) {
        app.eventBus.emit("ledger.mutated", { userId: uid });
      }
    } else {
      app.eventBus.emit("ledger.mutated", { userId });
    }
  };

  r.get(
    "/api/recurring",
    { schema: { response: { 200: z.array(RecurringTemplateSchema) } } },
    async (req) => listTemplates(app.db, req.session!.userId),
  );

  r.post(
    "/api/recurring",
    { schema: { body: CreateRecurringTemplateSchema, response: { 201: RecurringTemplateSchema } } },
    async (req, reply) => {
      const tpl = await createTemplate(app.db, req.session!.userId, req.body);
      await materializeNow(req.session!.userId);
      return reply.code(201).send(tpl);
    },
  );

  r.patch(
    "/api/recurring/:id",
    {
      schema: {
        params: IdParams,
        body: UpdateRecurringTemplateSchema,
        response: { 200: RecurringTemplateSchema },
      },
    },
    async (req) => {
      const tpl = await updateTemplate(app.db, req.session!.userId, req.params.id, req.body);
      await materializeNow(req.session!.userId);
      return tpl;
    },
  );

  r.delete(
    "/api/recurring/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteTemplate(app.db, req.session!.userId, req.params.id);
      // template deletion changes getForecast()'s cached() output (cashflow.ts
      // reads recurringTemplates directly), so this must still invalidate.
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return { ok: true };
    },
  );
}
