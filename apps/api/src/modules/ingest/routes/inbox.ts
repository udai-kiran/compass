import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AcceptExtractedTxnSchema,
  AcceptRepaymentSchema,
  AcceptTransferSchema,
  ExtractedTransactionSchema,
  InboxCountSchema,
  InboxStatusFilterSchema,
} from "@compass/shared";
import { acceptExtracted, rejectExtracted, restoreOrphan, unmatchDuplicate } from "../services/review-actions.ts";
import { countPending, listInbox, listOrphanedAccepts } from "../services/review-queue.ts";
import { acceptRepayment, acceptTransfer } from "../services/transfer-classification.ts";

/**
 * Review inbox for AI-extracted transactions. Read the pending drafts, then
 * accept (into the ledger) or reject. No AI runs on these paths — extraction
 * happens out-of-band in the extractor container.
 */
export async function inboxRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/inbox",
    { schema: { querystring: InboxStatusFilterSchema, response: { 200: z.array(ExtractedTransactionSchema) } } },
    async (req) => listInbox(app.db, req.session!.userId, req.query.status),
  );

  r.get(
    "/api/inbox/count",
    { schema: { response: { 200: InboxCountSchema } } },
    async (req) => ({ pending: await countPending(app.db, req.session!.userId) }),
  );

  // Accepted drafts whose ledger transaction was hard-deleted — surfaced
  // separately from the normal status filters so the UI can flag them as
  // needing attention rather than losing them silently.
  r.get(
    "/api/inbox/orphaned",
    { schema: { response: { 200: z.array(ExtractedTransactionSchema) } } },
    async (req) => listOrphanedAccepts(app.db, req.session!.userId),
  );

  r.post(
    "/api/inbox/:id/accept",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: AcceptExtractedTxnSchema,
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => {
      const result = await acceptExtracted(app.db, req.session!.userId, req.params.id, req.body);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );

  r.post(
    "/api/inbox/:id/repayment",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: AcceptRepaymentSchema,
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => {
      const result = await acceptRepayment(app.db, req.session!.userId, req.params.id, req.body);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );

  r.post(
    "/api/inbox/transfer",
    {
      schema: {
        body: AcceptTransferSchema,
        response: { 200: z.array(ExtractedTransactionSchema) },
      },
    },
    async (req) => {
      const result = await acceptTransfer(app.db, req.session!.userId, req.body);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );

  r.post(
    "/api/inbox/:id/reject",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => rejectExtracted(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/inbox/:id/restore",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => restoreOrphan(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/inbox/:id/unmatch",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => unmatchDuplicate(app.db, req.session!.userId, req.params.id),
  );
}
