import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AcceptExtractedTxnSchema,
  ExtractedTransactionSchema,
  InboxCountSchema,
  InboxStatusFilterSchema,
} from "@compass/shared";
import {
  acceptExtracted,
  countPending,
  listInbox,
  rejectExtracted,
} from "../services/inbox.ts";

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

  r.post(
    "/api/inbox/:id/accept",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: AcceptExtractedTxnSchema,
        response: { 200: ExtractedTransactionSchema },
      },
    },
    async (req) => acceptExtracted(app.db, req.session!.userId, req.params.id, req.body),
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
}
