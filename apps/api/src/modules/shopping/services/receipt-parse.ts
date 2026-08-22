/**
 * receipt-parse.ts — AI-powered receipt OCR (task 11.4).
 *
 * `createReceiptFromImage` accepts an uploaded image buffer, stores it durably
 * via the Storage abstraction (unlike list-image which is transient), calls the
 * user's AI provider with a vision message, inserts the parsed lines, and returns
 * the receipt with its lines.
 *
 * Storage lifecycle:
 *   - storage.put(buffer, contentType) → storedPath (BEFORE DB insert)
 *   - If DB INSERT receipt fails → storage.delete(storedPath) to compensate
 *   - Image is kept permanently (unlike list-image) — deleted only when the
 *     receipt row is deleted (route handler must call storage.delete).
 *
 * Error-propagation contract:
 *   - `!ai.enabled` or `!ai.supportsVision` → graceful { available: false }.
 *     Receipt row is still persisted so the image is saved and lines can be
 *     added manually.
 *   - `ai.chat()` errors (network / provider / timeout) PROPAGATE — receipt
 *     row is already committed at this point.
 *   - Storage put/delete errors PROPAGATE (storage failures are not swallowed
 *     here — the receipt cannot be created without an image).
 */

import type { AiImageMediaType, AiObserver, ToolSpec } from "@compass/ai";
import { extractJson } from "@compass/ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ParseReceiptResponse } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import type { Storage } from "../../../lib/storage.ts";
import { getUserAiProvider } from "../../automation/services/ai-settings.ts";
import { receipts, receiptLines } from "../schema.ts";

// ─── Deps shape ──────────────────────────────────────────────────────────────

export interface ReceiptParseDeps {
  db: Db;
  storage: Storage;
  secret: string;
  allowedBaseUrls: string;
}

export interface ImageInput {
  buffer: Buffer;
  contentType: string;
}

// ─── Tool definition ─────────────────────────────────────────────────────────

/**
 * Tool the model is forced to call. Extracts every line item with its name,
 * quantity, unit, and line total (qty × unit price).
 */
export const PARSE_RECEIPT_TOOL: ToolSpec = {
  name: "parse_receipt",
  description:
    "Extract every line item from this receipt. For each item: name, quantity, unit, line total in paise, and any discount.",
  inputSchema: {
    type: "object",
    properties: {
      merchantName: {
        type: "string",
        description: "The merchant or store name from the receipt header, if visible.",
      },
      purchaseDate: {
        type: "string",
        description: "The purchase date in YYYY-MM-DD format, if visible on the receipt.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The item name verbatim from the receipt.",
            },
            quantity: {
              type: "number",
              description: "Numeric quantity (e.g. 2, 1.5). Omit if not present.",
            },
            unit: {
              type: "string",
              enum: ["kg", "g", "L", "ml", "piece"],
              description: "The unit as printed (kg, g, L, ml, or piece). Omit if not present.",
            },
            lineTotal: {
              type: "number",
              description: "Line total in integer paise (qty × unit price). Must be non-negative.",
            },
            discount: {
              type: "number",
              description: "Discount applied to this line in paise, if any. Omit if zero.",
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["items"],
  },
};

// ─── System prompt ────────────────────────────────────────────────────────────

const RECEIPT_SYSTEM = `You are a receipt-parsing assistant for an Indian household finance app.
The user will provide a photo of a shopping receipt.
Extract every line item with its name, quantity, unit (kg/g/L/ml/piece), and line total in paise (1 rupee = 100 paise).
Also extract the merchant name and purchase date (YYYY-MM-DD) if visible.
Line total should reflect qty × unit price after any discounts.`;

// ─── Model-output schema ──────────────────────────────────────────────────────

/** Allowed display units from the receipt OCR. Maps to base units. */
const OCR_UNIT_MAP: Record<string, { unit: "g" | "ml" | "piece"; factor: number }> = {
  kg: { unit: "g", factor: 1000 },
  g: { unit: "g", factor: 1 },
  L: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  piece: { unit: "piece", factor: 1 },
};

const ModelItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  lineTotal: z.number().optional(),
  discount: z.number().optional(),
});

const ModelOutputSchema = z.object({
  merchantName: z.string().optional(),
  purchaseDate: z.string().optional(),
  items: z.array(ModelItemSchema),
});

type ModelOutput = z.infer<typeof ModelOutputSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize raw text: lowercase, trim, collapse whitespace. */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Parse model tool output via the 3-way discipline. */
function parseModelOutput(
  toolCalls: Array<{ name: string; input: unknown }>,
  text: string,
): ModelOutput | null {
  const matches = toolCalls.filter((c) => c.name === PARSE_RECEIPT_TOOL.name);
  let raw: unknown;
  if (matches.length === 1) {
    raw = matches[0]!.input;
  } else if (matches.length === 0) {
    raw = extractJson(text);
  } else {
    return null; // 2+ matches — fail closed
  }
  const result = ModelOutputSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Convert OCR quantity+unit to base units. Returns null if unit unrecognizable. */
function toBaseUnit(
  quantity: number | undefined,
  unit: string | undefined,
): { quantityBase: number; unit: "g" | "ml" | "piece" } | null {
  if (quantity === undefined || unit === undefined) return null;
  const mapping = OCR_UNIT_MAP[unit];
  if (!mapping) return null;
  const quantityBase = Math.floor(quantity * mapping.factor);
  if (!Number.isSafeInteger(quantityBase) || quantityBase < 0) return null;
  return { quantityBase, unit: mapping.unit };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Create a receipt from an uploaded image.
 *
 * Steps:
 *   1. storage.put(buffer, contentType) → storedPath
 *   2. INSERT receipts row (status='parsed', storedPath, mimeType)
 *      On INSERT failure: storage.delete(storedPath) + rethrow
 *   3. Resolve AI provider.
 *   4. If !enabled or !supportsVision: return { available: false, receipt with no lines }
 *   5. Call ai.chat with PARSE_RECEIPT_TOOL (forced toolChoice).
 *   6. Parse + normalize units → INSERT receipt_lines.
 *   7. Compute totalPaise = sum of line pricePaise; UPDATE receipts.
 *   8. Return { available: true, receipt with lines }.
 */
export async function createReceiptFromImage(
  deps: ReceiptParseDeps,
  userId: string,
  image: ImageInput,
  cartDraftId?: string | null,
  observe?: AiObserver,
): Promise<ParseReceiptResponse> {
  const { db, storage, secret, allowedBaseUrls } = deps;

  // Step 1: persist image first so it survives even if OCR fails.
  const storedPath = await storage.put(image.buffer, image.contentType);

  // Step 2: INSERT receipt row (compensate on failure).
  let receiptId: string;
  try {
    const [row] = await db
      .insert(receipts)
      .values({
        userId,
        storedPath,
        mimeType: image.contentType,
        cartDraftId: cartDraftId ?? null,
      })
      .returning({ id: receipts.id });
    receiptId = row!.id;
  } catch (err) {
    // Compensate: delete the image we just stored so storage doesn't leak.
    await storage.delete(storedPath).catch(() => {});
    throw err;
  }

  // Helper to load the receipt with its lines and return the full response.
  const loadAndReturn = async (available: boolean, message: string | null) => {
    const receipt = await db.query.receipts.findFirst({
      where: eq(receipts.id, receiptId),
    });
    const lines = await db.query.receiptLines.findMany({
      where: eq(receiptLines.receiptId, receiptId),
      orderBy: (l, { asc }) => [asc(l.position)],
    });
    const receiptWithLines = {
      id: receipt!.id,
      cartDraftId: receipt!.cartDraftId ?? null,
      shoppingListId: receipt!.shoppingListId ?? null,
      status: receipt!.status,
      merchantName: receipt!.merchantName ?? null,
      purchaseDate: receipt!.purchaseDate ?? null,
      totalPaise: receipt!.totalPaise ?? null,
      storedPath: receipt!.storedPath,
      mimeType: receipt!.mimeType,
      parsedAt: receipt!.parsedAt ?? null,
      reconciledAt: receipt!.reconciledAt ?? null,
      confirmedAt: receipt!.confirmedAt ?? null,
      createdAt: receipt!.createdAt,
      lines: lines.map((l) => ({
        id: l.id,
        receiptId: l.receiptId,
        position: l.position,
        rawText: l.rawText,
        normalizedName: l.normalizedName ?? null,
        catalogItemId: l.catalogItemId ?? null,
        quantityBase: l.quantityBase ?? null,
        unit: l.unit ?? null,
        pricePaise: l.pricePaise ?? null,
        matchedDraftItemId: l.matchedDraftItemId ?? null,
        matchStatus: l.matchStatus,
        createdAt: l.createdAt,
      })),
    };
    return { available, receipt: receiptWithLines, message };
  };

  // Step 3: resolve AI provider.
  const ai = await getUserAiProvider(db, userId, secret, allowedBaseUrls, observe);

  // Step 4: graceful unavailable paths (receipt is already saved).
  if (!ai.enabled) {
    return loadAndReturn(false, "AI is not configured");
  }
  if (!ai.supportsVision) {
    return loadAndReturn(false, "Receipt OCR requires a vision-capable AI provider");
  }

  // Step 5: call AI with vision message.
  const base64Data = image.buffer.toString("base64");
  const mediaType = image.contentType as AiImageMediaType;

  const turn = await ai.chat({
    system: RECEIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please extract every line item from this receipt.",
          },
          {
            type: "image",
            mediaType,
            data: base64Data,
          },
        ],
      },
    ],
    tools: [PARSE_RECEIPT_TOOL],
    toolChoice: PARSE_RECEIPT_TOOL.name,
    maxTokens: 2048,
    timeoutMs: 90_000,
  });

  // Step 6: parse and normalize.
  let modelOutput: ModelOutput | null;
  try {
    modelOutput = parseModelOutput(turn.toolCalls, turn.text);
  } catch {
    modelOutput = null;
  }

  if (!modelOutput) {
    return loadAndReturn(true, "Could not read any items from the receipt image");
  }

  // Insert lines (one per item).
  const lineValues = modelOutput.items.map((item, idx) => {
    const baseUnit = toBaseUnit(item.quantity, item.unit);
    const normalizedName = normalizeText(item.name);
    const pricePaise =
      item.lineTotal !== undefined && item.lineTotal >= 0 && Number.isSafeInteger(Math.floor(item.lineTotal))
        ? Math.floor(item.lineTotal)
        : null;
    return {
      receiptId,
      position: idx,
      rawText: item.name,
      normalizedName,
      quantityBase: baseUnit?.quantityBase ?? null,
      unit: baseUnit?.unit ?? null,
      pricePaise,
    };
  });

  if (lineValues.length > 0) {
    await db.insert(receiptLines).values(lineValues);
  }

  // Step 7: compute totalPaise and update receipt.
  const totalPaise = lineValues.reduce((sum, l) => sum + (l.pricePaise ?? 0), 0);

  // Also update merchantName and purchaseDate if OCR found them.
  const merchantName = modelOutput.merchantName?.trim() || null;
  const purchaseDate = modelOutput.purchaseDate ?? null;

  await db
    .update(receipts)
    .set({
      totalPaise,
      merchantName,
      purchaseDate,
      parsedAt: new Date(),
    })
    .where(eq(receipts.id, receiptId));

  // Step 8: return with lines.
  return loadAndReturn(true, lineValues.length === 0 ? "No items found on the receipt" : null);
}
