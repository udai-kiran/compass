/**
 * parse-list.ts — AI-powered paste-text shopping list parse (task 9.4).
 *
 * Three exported symbols:
 *   PARSE_LIST_TOOL   — ToolSpec handed to the AI provider for structured output.
 *   parseItemsFromTurn — Pure function: applies the extractor's three-way
 *                        tool-call discipline and returns typed model output or null.
 *                        Hermetically testable without a DB or provider.
 *   parseListText     — Orchestrator: resolves the user's AI provider, calls
 *                        chat(), delegates to parseItemsFromTurn, normalizes
 *                        quantities, and returns reviewable ParsedShoppingItem[].
 *
 * Error-propagation contract:
 *   - `ai.chat()` errors (network / provider / timeout) PROPAGATE — they are
 *     not caught here and will surface as Fastify 5xx errors.
 *   - Failures in the parse / interpret / normalize step (bad model output,
 *     Zod validation, convertToBaseQuantity) are CAUGHT and returned as
 *     { available: true, items: [], message: "..." } — never a 500.
 */

import type { ToolSpec, ChatTurn, AiObserver } from "@compass/ai";
import { extractJson } from "@compass/ai";
import { z } from "zod";
import {
  convertToBaseQuantity,
  DisplayUnitSchema,
  type ParsedShoppingItem,
  type ParseListTextRequest,
  ParseListTextResponseSchema,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { getUserAiProvider } from "../../automation/services/ai-settings.ts";

// ─── Tool definition ─────────────────────────────────────────────────────────

/**
 * The tool the model is asked to call. Input schema is hand-written JSON
 * Schema (no zod-to-json-schema dependency, mirrors extractor discipline).
 */
export const PARSE_LIST_TOOL: ToolSpec = {
  name: "parse_shopping_list",
  description:
    "Extract every ingredient or shopping item from the text, with optional quantity and unit.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The item name, verbatim from the text.",
            },
            quantity: {
              type: "string",
              description:
                "The numeric quantity as a decimal string (e.g. '2', '1.5'). Omit if not present.",
            },
            unit: {
              type: "string",
              enum: ["kg", "g", "litre", "ml", "piece"],
              description: "The display unit. Omit if not present.",
            },
          },
          required: ["name"],
        },
      },
    },
    required: ["items"],
  },
};

// ─── Model-output schema ─────────────────────────────────────────────────────

/** Shape the model is expected to return via the tool call or prose JSON. */
const ModelItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.string().optional(),
  unit: DisplayUnitSchema.optional(),
});

const ModelOutputSchema = z.object({
  items: z.array(ModelItemSchema),
});

type ModelOutput = z.infer<typeof ModelOutputSchema>;

// ─── System prompts ──────────────────────────────────────────────────────────

const FREETEXT_SYSTEM = `You are a shopping-list assistant.
The user will paste a free-text shopping list (e.g. "2kg atta, milk 1L, 6 eggs, dal").
Extract every item with its name, quantity (as a decimal string), and unit (kg/g/litre/ml/piece).
If quantity or unit is absent for an item, omit those fields entirely.`;

const RECIPE_SYSTEM = `You are a shopping-list assistant.
The user will paste a recipe. Extract only the INGREDIENTS as shopping items.
Include each ingredient's name, quantity (as a decimal string), and unit (kg/g/litre/ml/piece).
If quantity or unit is absent for an ingredient, omit those fields entirely.`;

// ─── Pure three-way parse helper ─────────────────────────────────────────────

/**
 * Apply the extractor's exact three-way discipline to one chat turn:
 *   1 matching tool call  → safeParse(input)
 *   0 matching tool calls → safeParse(extractJson(text))  [also the Ollama/prose path]
 *   ≥2 matching tool calls → safeParse(undefined)  [FAIL CLOSED, text never read]
 *
 * `structured` is informational (caller passes ai.name !== "ollama") — the
 * three-way branching is entirely based on what the model actually returned,
 * not on what was requested. Ollama receives no tools, so its turn.toolCalls
 * is always empty → matches.length === 0 → prose extractJson path.
 *
 * Returns the parsed model object or null on any validation failure.
 * Pure — no I/O, no side effects, hermetically testable.
 */
export function parseItemsFromTurn(
  turn: ChatTurn,
  _structured: boolean,
): ModelOutput | null {
  const matches = turn.toolCalls.filter((c) => c.name === PARSE_LIST_TOOL.name);

  let parsed: ReturnType<typeof ModelOutputSchema.safeParse>;

  if (matches.length === 1) {
    parsed = ModelOutputSchema.safeParse(matches[0]!.input);
  } else if (matches.length === 0) {
    // Zero tool calls — fall back to prose JSON (covers Ollama and any provider
    // that ignores toolChoice).
    parsed = ModelOutputSchema.safeParse(extractJson(turn.text));
  } else {
    // 2+ matching tool calls: fail closed. An arbitrary pick would be unsafe.
    // Never touches turn.text.
    parsed = ModelOutputSchema.safeParse(undefined);
  }

  if (!parsed.success) return null;
  return parsed.data;
}

// ─── Quantity normalization ───────────────────────────────────────────────────

/**
 * Normalize one model item into a `ParsedShoppingItem`.
 * If quantity+unit are present and `convertToBaseQuantity` succeeds, both
 * `quantityBase` and `unit` are set. Otherwise both are null (the item
 * remains usable as raw text — matching the DB CHECK constraint).
 */
function normalizeItem(item: z.infer<typeof ModelItemSchema>): ParsedShoppingItem {
  const rawText = item.name.trim().slice(0, 200);

  if (item.quantity !== undefined && item.unit !== undefined) {
    try {
      const { quantityBase, unit } = convertToBaseQuantity(item.quantity, item.unit);
      return { rawText, quantityBase, unit };
    } catch {
      // Conversion failed (excess precision, bad range, etc.) — leave both null.
    }
  }

  return { rawText, quantityBase: null, unit: null };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export type ParseListTextResult = z.infer<typeof ParseListTextResponseSchema>;

/**
 * Resolve the user's AI provider, call chat(), parse and normalize the model's
 * output into reviewable `ParsedShoppingItem[]`.
 *
 * Graceful-degrade contract:
 *   - AI disabled → { available: false, items: [], rawInput, message }.
 *   - Bad model output (Zod / normalization failure) → { available: true,
 *     items: [], rawInput, message } — never a 500.
 *   - `ai.chat()` errors PROPAGATE to Fastify's error handler (5xx).
 */
export async function parseListText(
  db: Db,
  userId: string,
  secret: string,
  allowedBaseUrls: string,
  input: ParseListTextRequest,
  observe?: AiObserver,
): Promise<ParseListTextResult> {
  const rawInput = input.text;

  const ai = await getUserAiProvider(db, userId, secret, allowedBaseUrls, observe);

  if (!ai.enabled) {
    return {
      available: false,
      items: [],
      rawInput,
      message: "AI is not configured",
    };
  }

  const structured = ai.name !== "ollama";
  const system = input.sourceKind === "recipe" ? RECIPE_SYSTEM : FREETEXT_SYSTEM;

  // ai.chat() errors (network/provider/timeout) PROPAGATE — not caught here.
  const turn = await ai.chat({
    system,
    messages: [{ role: "user", content: rawInput }],
    tools: structured ? [PARSE_LIST_TOOL] : [],
    toolChoice: structured ? PARSE_LIST_TOOL.name : undefined,
    maxTokens: 1024,
    timeoutMs: 60_000,
  });

  // CATCH ONLY the parse/interpret/normalize step.
  try {
    const modelOutput = parseItemsFromTurn(turn, structured);

    if (modelOutput === null || modelOutput.items.length === 0) {
      return {
        available: true,
        items: [],
        rawInput,
        message: "Could not read any items from the text",
      };
    }

    // BLOCKING FIX (iter2): drop items whose rawText is empty after trim.
    // A whitespace-only model name (e.g. "   ") passes z.string().min(1) but
    // normalizes to rawText:"", which violates ParsedShoppingItemSchema and
    // would 500 on response validation. Filter them here, after normalize.
    const items = modelOutput.items
      .map(normalizeItem)
      .filter((item) => item.rawText.length > 0);

    if (items.length === 0) {
      return {
        available: true,
        items: [],
        rawInput,
        message: "Could not read any items from the text",
      };
    }

    return {
      available: true,
      items,
      rawInput,
      message: null,
    };
  } catch {
    return {
      available: true,
      items: [],
      rawInput,
      message: "Could not read any items from the text",
    };
  }
}
