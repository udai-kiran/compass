import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateTransactionLinkSchema, TransactionLinkSchema } from "@compass/shared";
import { addLink, deleteLink, listLinks } from "../services/transaction-links.ts";

export async function transactionLinkRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const IdParams = z.object({ id: z.uuid() });

  r.get("/api/transactions/:id/links", {
    schema: { params: IdParams, response: { 200: z.array(TransactionLinkSchema) } },
  }, async (req) => listLinks(app.db, req.session!.userId, req.params.id));

  r.post("/api/transactions/:id/links", {
    schema: { params: IdParams, body: CreateTransactionLinkSchema, response: { 201: TransactionLinkSchema } },
  }, async (req, reply) => {
    const link = await addLink(app.db, req.session!.userId, req.params.id, req.body);
    return reply.code(201).send(link);
  });

  r.delete("/api/transaction-links/:id", {
    schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } },
  }, async (req) => {
    await deleteLink(app.db, req.session!.userId, req.params.id);
    return { ok: true };
  });
}
