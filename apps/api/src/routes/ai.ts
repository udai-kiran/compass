import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  AiCategorizeRequestSchema,
  AiCategorizeResponseSchema,
  AiChatRequestSchema,
  AiSettingsSchema,
  AiSummaryRequestSchema,
  AiSummarySchema,
  UpdateAiSettingsSchema,
} from "@compass/shared";
import { AiUnavailableError } from "@compass/ai";
import { HttpError } from "../lib/errors.ts";
import { suggestCategoriesFor } from "../services/ai/categorize.ts";
import { getMonthlySummary } from "../services/ai/summary.ts";
import { runAssistant } from "../services/ai/assistant.ts";
import { getAiSettings, getUserAiProvider, upsertAiSettings } from "../services/ai-settings.ts";
import { mailboxSecret } from "../services/mailboxes.ts";

/**
 * AI endpoints (Phase 7). The provider is resolved per user from their stored
 * settings (Settings → AI); a caller with AI unconfigured gets the NullProvider,
 * so every feature route 404s for them — no AI call ever sits on a core path.
 */
export async function aiRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const providerFor = (userId: string) =>
    getUserAiProvider(app.db, userId, mailboxSecret(app.config), app.config.AI_ALLOWED_BASE_URLS);

  // A provider outage must read as a soft notice, never a masked 500 error page.
  const degrade = (err: unknown): never => {
    if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
    throw err as Error;
  };

  r.get("/api/ai/settings", { schema: { response: { 200: AiSettingsSchema } } }, async (req) =>
    getAiSettings(app.db, req.session!.userId),
  );

  r.put(
    "/api/ai/settings",
    { schema: { body: UpdateAiSettingsSchema, response: { 200: AiSettingsSchema } } },
    async (req) =>
      upsertAiSettings(
        app.db,
        req.session!.userId,
        req.body,
        mailboxSecret(app.config),
        app.config.AI_ALLOWED_BASE_URLS,
      ),
  );

  r.post(
    "/api/ai/categorize",
    { schema: { body: AiCategorizeRequestSchema, response: { 200: AiCategorizeResponseSchema } } },
    async (req) => {
      const ai = await providerFor(req.session!.userId);
      if (!ai.enabled) throw new HttpError(404, "AI features are not enabled");
      const suggestions = await suggestCategoriesFor(
        app.db,
        ai,
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
      const ai = await providerFor(req.session!.userId);
      if (!ai.enabled) throw new HttpError(404, "AI features are not enabled");
      return getMonthlySummary(
        app.db,
        app.redis,
        ai,
        req.session!.userId,
        req.body.period,
        req.body.refresh ?? false,
      ).catch(degrade);
    },
  );

  // Streaming chat over Server-Sent Events.
  r.post("/api/ai/chat", { schema: { body: AiChatRequestSchema } }, async (req, reply) => {
    const ai = await providerFor(req.session!.userId);
    if (!ai.enabled) throw new HttpError(404, "AI features are not enabled");
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const ctx = { db: app.db, redis: app.redis, userId: req.session!.userId };
    try {
      for await (const event of runAssistant(ai, ctx, req.body.messages)) {
        send(event);
      }
    } catch (err) {
      req.log.error(err);
      send({ type: "error", message: "The assistant is unavailable right now." });
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
