import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  AiCategorizeRequestSchema,
  AiCategorizeResponseSchema,
  AiChatRequestSchema,
  AiSummaryRequestSchema,
  AiSummarySchema,
} from "@compass/shared";
import { AiUnavailableError } from "@compass/ai";
import { HttpError } from "../lib/errors.ts";
import { suggestCategoriesFor } from "../services/ai/categorize.ts";
import { getMonthlySummary } from "../services/ai/summary.ts";
import { runAssistant } from "../services/ai/assistant.ts";

/**
 * AI endpoints (Phase 7). Every route 404s when `AI_PROVIDER=none` so the
 * feature is simply absent for non-AI deployments — no AI call ever sits on a
 * core request path.
 */
export async function aiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const ensureEnabled = () => {
    if (!app.ai.enabled) throw new HttpError(404, "AI features are not enabled");
  };

  // A provider outage must read as a soft notice, never a masked 500 error page.
  const degrade = (err: unknown): never => {
    if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
    throw err as Error;
  };

  r.post(
    "/api/ai/categorize",
    { schema: { body: AiCategorizeRequestSchema, response: { 200: AiCategorizeResponseSchema } } },
    async (req) => {
      ensureEnabled();
      const suggestions = await suggestCategoriesFor(
        app.db,
        app.ai,
        req.session!.userId,
        req.body.transactionIds,
      ).catch(degrade);
      return { suggestions };
    },
  );

  r.post(
    "/api/ai/summary",
    { schema: { body: AiSummaryRequestSchema, response: { 200: AiSummarySchema } } },
    async (req) => {
      ensureEnabled();
      return getMonthlySummary(
        app.db,
        app.redis,
        app.ai,
        req.session!.userId,
        req.body.period,
        req.body.refresh ?? false,
      ).catch(degrade);
    },
  );

  // Streaming chat over Server-Sent Events.
  r.post(
    "/api/ai/chat",
    { schema: { body: AiChatRequestSchema } },
    async (req, reply) => {
      ensureEnabled();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      const ctx = { db: app.db, redis: app.redis, userId: req.session!.userId };
      try {
        for await (const event of runAssistant(app.ai, ctx, req.body.messages)) {
          send(event);
        }
      } catch (err) {
        req.log.error(err);
        send({ type: "error", message: "The assistant is unavailable right now." });
      } finally {
        reply.raw.end();
      }
      return reply;
    },
  );
}
