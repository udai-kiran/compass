/**
 * parse-image.ts — AI-powered photo list capture (task 9.5).
 *
 * `parseListImage` accepts an uploaded image buffer, stores it transiently via
 * the Storage abstraction, calls the user's AI provider with a vision message
 * (same PARSE_LIST_TOOL as 9.4), delegates to `itemsFromTurn` for shared
 * parse/normalize/filter, then ALWAYS deletes the stored image in a `finally`.
 *
 * Error-propagation contract:
 *   - `!ai.enabled` or `!ai.supportsVision` → graceful message, no chat, no
 *     storage.put.
 *   - `ai.chat()` errors (network / provider / timeout) PROPAGATE — only
 *     parse/normalize is caught for graceful empty.
 *   - Storage delete errors are swallowed so they never mask a chat error.
 */

import type { AiImageMediaType, AiObserver } from "@compass/ai";
import type { ParseListImageResponse } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import type { Storage } from "../../../lib/storage.ts";
import { getUserAiProvider } from "../../automation/services/ai-settings.ts";
import { PARSE_LIST_TOOL, itemsFromTurn } from "./parse-list.ts";

// ─── System prompt ───────────────────────────────────────────────────────────

const IMAGE_SYSTEM = `You are a shopping-list assistant.
The user will provide a photo of a handwritten or printed shopping list (or a recipe).
Extract every ingredient or shopping item with its name, quantity (as a decimal string), and unit (kg/g/litre/ml/piece).
If quantity or unit is absent for an item, omit those fields entirely.`;

// ─── Deps shape ──────────────────────────────────────────────────────────────

export interface ParseImageDeps {
  db: Db;
  storage: Storage;
  secret: string;
  allowedBaseUrls: string;
}

export interface ImageInput {
  buffer: Buffer;
  contentType: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Parse a shopping-list photo into reviewable `ParsedShoppingItem[]`.
 *
 * Steps:
 *   1. Resolve the user's AI provider (via `getUserAiProvider`).
 *   2. If `!ai.enabled` → graceful unavailable (no store, no chat).
 *   3. If `!ai.supportsVision` → graceful unavailable (no store, no chat).
 *   4. `storage.put(image.buffer, image.contentType)` → key.
 *   5. Try: build a vision `ChatMessage` with `ImageBlock` (raw base64, no
 *      `data:` prefix) + text instruction; call `ai.chat` with `PARSE_LIST_TOOL`
 *      + `toolChoice`; delegate to `itemsFromTurn`.
 *   6. Finally: `storage.delete(key)` — swallowed so a delete error never masks
 *      a propagating chat error.
 *
 * Returns a `ParseListImageResponse` — available + items + message.
 */
export async function parseListImage(
  deps: ParseImageDeps,
  userId: string,
  image: ImageInput,
  observe?: AiObserver,
): Promise<ParseListImageResponse> {
  const { db, storage, secret, allowedBaseUrls } = deps;

  const ai = await getUserAiProvider(db, userId, secret, allowedBaseUrls, observe);

  if (!ai.enabled) {
    return { available: false, items: [], message: "AI is not configured" };
  }

  if (!ai.supportsVision) {
    return {
      available: false,
      items: [],
      message: "Photo capture requires a vision-capable AI provider",
    };
  }

  // Store transiently — deleted in finally whether chat succeeds or throws.
  const key = await storage.put(image.buffer, image.contentType);

  try {
    // Build the raw base64 string WITHOUT the "data:" URI prefix — assertImagesValid
    // inside the provider rejects "data:..." strings before any HTTP call.
    const base64Data = image.buffer.toString("base64");

    // The mediaType field on ImageBlock is AiImageMediaType — we validated the
    // content-type in the route before calling this service.
    const mediaType = image.contentType as AiImageMediaType;

    // ai.chat() errors (network/provider/timeout) PROPAGATE — not caught here.
    const turn = await ai.chat({
      system: IMAGE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please extract every shopping item from this list photo.",
            },
            {
              type: "image",
              mediaType,
              data: base64Data,
            },
          ],
        },
      ],
      tools: [PARSE_LIST_TOOL],
      toolChoice: PARSE_LIST_TOOL.name,
      maxTokens: 1024,
      timeoutMs: 60_000,
    });

    // CATCH ONLY the parse/interpret/normalize step.
    try {
      const structured = true; // vision providers all support forced tool-calling
      const items = itemsFromTurn(turn, structured);

      return {
        available: true,
        items,
        message: items.length > 0 ? null : "Could not read any items from the image",
      };
    } catch {
      return {
        available: true,
        items: [],
        message: "Could not read any items from the image",
      };
    }
  } finally {
    // Swallow delete errors — a failed delete must NEVER mask a propagating
    // chat error or change the success path return value.
    await storage.delete(key).catch(() => {});
  }
}
