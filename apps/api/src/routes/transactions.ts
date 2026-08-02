import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BulkActionSchema,
  BulkResultSchema,
  CreateEpfContributionSchema,
  CreateTransactionSchema,
  EpfContributionResultSchema,
  ListTransactionsQuerySchema,
  SetSplitsSchema,
  TransactionPageSchema,
  TransactionSchema,
  UpdateTransactionSchema,
} from "@compass/shared";
import {
  bulkAction,
  createTransaction,
  getTransaction,
  listTransactions,
  setSplits,
  softDeleteTransaction,
  updateTransaction,
} from "../services/transactions.ts";
import { recordEpfContribution } from "../services/epf-contributions.ts";

const IdParams = z.object({ id: z.uuid() });

export async function transactionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/transactions",
    { schema: { querystring: ListTransactionsQuerySchema, response: { 200: TransactionPageSchema } } },
    async (req) => listTransactions(app.db, req.session!.userId, req.query),
  );

  r.get(
    "/api/transactions/:id",
    { schema: { params: IdParams, response: { 200: TransactionSchema } } },
    async (req) => getTransaction(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/transactions",
    { schema: { body: CreateTransactionSchema, response: { 201: TransactionSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createTransaction(app.db, req.session!.userId, req.body)),
  );

  // Records one plain income transaction directly on the chosen retirement
  // account — no bank leg; see services/epf-contributions.ts.
  r.post(
    "/api/epf-contributions",
    { schema: { body: CreateEpfContributionSchema, response: { 201: EpfContributionResultSchema } } },
    async (req, reply) =>
      reply.code(201).send(await recordEpfContribution(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/transactions/:id",
    {
      schema: { params: IdParams, body: UpdateTransactionSchema, response: { 200: TransactionSchema } },
    },
    async (req) => updateTransaction(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/transactions/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await softDeleteTransaction(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.put(
    "/api/transactions/:id/splits",
    { schema: { params: IdParams, body: SetSplitsSchema, response: { 200: TransactionSchema } } },
    async (req) => setSplits(app.db, req.session!.userId, req.params.id, req.body.splits),
  );

  r.post(
    "/api/transactions/bulk",
    { schema: { body: BulkActionSchema, response: { 200: BulkResultSchema } } },
    async (req) => bulkAction(app.db, req.session!.userId, req.body),
  );
}
