import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateTransferLinkSchema, TransferSuggestionSchema } from "@compass/shared";
import { linkTransfer, suggestTransfers, unlinkTransfer } from "../services/transfers.ts";

export async function transferRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/transfers/suggestions",
    { schema: { response: { 200: z.array(TransferSuggestionSchema) } } },
    async (req) => suggestTransfers(app.db, req.session!.userId),
  );

  r.post(
    "/api/transfers",
    { schema: { body: CreateTransferLinkSchema, response: { 201: z.object({ id: z.uuid() }) } } },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await linkTransfer(
            app.db,
            req.session!.userId,
            req.body.outTransactionId,
            req.body.inTransactionId,
          ),
        ),
  );

  r.delete(
    "/api/transfers/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await unlinkTransfer(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
