/**
 * capture-image.ts — Photo list capture route (task 9.5).
 * Registered under the `/api/shopping` prefix; path here is RELATIVE:
 *   POST /parse-image → POST /api/shopping/parse-image
 *
 * Accepts a multipart/form-data image upload (jpeg / png / webp), validates
 * content-type and magic bytes, then calls `parseListImage` to extract
 * reviewable shopping items via the user's vision-capable AI provider.
 *
 * Nothing is written to shopping_list_items — the user reviews and then calls
 * the existing POST /lists/:id/items for each accepted item.
 *
 * Session-authenticated. Not public. Demo sessions are automatically rejected
 * on all mutating methods by the single chokepoint in `plugins/auth.ts`.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MAX_IMAGE_BYTES, effectiveModel, type AiObserver } from "@compass/ai";
import { ParseListImageResponseSchema } from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { getAiSettings } from "../../automation/services/ai-settings.ts";
import { recordAiEvent } from "../../automation/services/events.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";
import { parseListImage } from "../services/parse-image.ts";

// ─── Allowed content types (no PDF — images only) ────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Magic-byte check for the three allowed image types.
 * The declared content-type is client-supplied, so the content must back it up.
 */
function matchesImageMagicBytes(mimeType: string, data: Buffer): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case "image/png":
      return data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    case "image/webp":
      return (
        data.length >= 12 &&
        data.toString("latin1", 0, 4) === "RIFF" &&
        data.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function shoppingCaptureImageRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /parse-image — upload a shopping-list photo and parse it into items.
  r.post(
    "/parse-image",
    {
      schema: {
        response: { 200: ParseListImageResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      // Read the multipart file. `fileSize` limit enforced at the busboy level;
      // `files: 1` ensures only one file is accepted per request.
      const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!file) throw new HttpError(400, "Expected a multipart file field");

      // Read the buffer BEFORE checking truncation — toBuffer() drains the stream.
      const buffer = await file.toBuffer();

      // Truncation means the file exceeded the busboy fileSize limit (MAX_IMAGE_BYTES).
      if (file.file.truncated) {
        throw new HttpError(413, `Image exceeds the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB limit`);
      }

      const mimeType = file.mimetype;

      // Content-type allowlist check.
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new HttpError(
          415,
          `Unsupported file type ${mimeType} — allowed: image/jpeg, image/png, image/webp`,
        );
      }

      // Magic-byte check — rejects files that lie about their content-type.
      if (!matchesImageMagicBytes(mimeType, buffer)) {
        throw new HttpError(415, "File content does not match its declared type");
      }

      // Resolve AI settings metadata (provider + model label for the event log).
      const meta = await getAiSettings(app.db, userId);
      const model = effectiveModel(meta.provider, meta.model);

      // Build an AiObserver that records the event fire-and-forget,
      // mirroring the capture.ts pattern.
      const observe: AiObserver = (obs) =>
        recordAiEvent(app.db, userId, {
          kind: "shopping_parse",
          status: obs.ok ? "ok" : "error",
          provider: meta.provider,
          model,
          title: `photo: ${file.filename || "image"}`.slice(0, 80),
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        });

      return parseListImage(
        {
          db: app.db,
          storage: app.storage,
          secret: mailboxSecret(app.config),
          allowedBaseUrls: app.config.AI_ALLOWED_BASE_URLS,
        },
        userId,
        { buffer, contentType: mimeType },
        observe,
      );
    },
  );
}
