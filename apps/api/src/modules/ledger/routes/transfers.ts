import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateTransferLinkSchema,
  CreateTransferSchema,
  TransferResultSchema,
  UnlinkTransferResultSchema,
  TransferSuggestionSchema,
} from "@compass/shared";
import { createTransfer, linkTransfer, suggestTransfers, unlinkTransfer } from "../services/transfers.ts";

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
    async (req, reply) => {
      const result = await linkTransfer(
        app.db,
        req.session!.userId,
        req.body.outTransactionId,
        req.body.inTransactionId,
      );
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return reply.code(201).send(result);
    },
  );

  // Distinct from POST /api/transfers, which links two transactions that already
  // exist — this books both legs from scratch.
  r.post(
    "/api/transfers/record",
    { schema: { body: CreateTransferSchema, response: { 201: TransferResultSchema } } },
    async (req, reply) => {
      const result = await createTransfer(app.db, req.session!.userId, req.body);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return reply.code(201).send(result);
    },
  );

  // The :id is a TRANSACTION id, not a transfer-link id — a transfer IS one
  // transaction now. Splits it back into two ordinary transactions and returns
  // both ids, since the caller cannot predict the second one.
  r.delete(
    "/api/transfers/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: UnlinkTransferResultSchema },
      },
    },
    async (req) => {
      const result = await unlinkTransfer(app.db, req.session!.userId, req.params.id);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );
}
