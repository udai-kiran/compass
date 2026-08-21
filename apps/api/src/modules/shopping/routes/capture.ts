/**
 * Capture routes (task 9.4). Registered under the `/api/shopping` prefix
 * (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   POST /parse-text → POST /api/shopping/parse-text
 *
 * The route calls the AI provider to parse free-text or recipe text into
 * reviewable (rawText, quantityBase, unit) candidates. Nothing is written to
 * `shopping_list_items` — the user reviews and then calls the existing 9.2
 * `POST /lists/:id/items` for each accepted item.
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the single
 * chokepoint in `plugins/auth.ts`.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { effectiveModel, type AiObserver } from "@compass/ai";
import { ParseListTextRequestSchema, ParseListTextResponseSchema } from "@compass/shared";
import { getAiSettings } from "../../automation/services/ai-settings.ts";
import { recordAiEvent } from "../../automation/services/events.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";
import { parseListText } from "../services/parse-list.ts";

export async function shoppingCaptureRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /parse-text — parse free text or a recipe into reviewable shopping items.
  r.post(
    "/parse-text",
    {
      schema: {
        body: ParseListTextRequestSchema,
        response: { 200: ParseListTextResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const input = req.body;

      // Resolve AI settings metadata (provider + model label for the event log).
      const meta = await getAiSettings(app.db, userId);
      const model = effectiveModel(meta.provider, meta.model);

      // Build an AiObserver that records the event fire-and-forget,
      // exactly mirroring the roadmap-narrative.ts pattern.
      const observe: AiObserver = (obs) =>
        recordAiEvent(app.db, userId, {
          kind: "shopping_parse",
          status: obs.ok ? "ok" : "error",
          provider: meta.provider,
          model,
          title: input.text.slice(0, 80),
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        });

      return parseListText(
        app.db,
        userId,
        mailboxSecret(app.config),
        app.config.AI_ALLOWED_BASE_URLS,
        input,
        observe,
      );
    },
  );
}
