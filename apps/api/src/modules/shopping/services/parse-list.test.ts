/**
 * Hermetic tests for parseItemsFromTurn and parseListText (task 9.4).
 *
 * parseItemsFromTurn is a pure function: no DB, no provider, no env vars.
 * Tests the three-way tool-call discipline and extractJson fallback.
 *
 * parseListText tests use mock.module to stub getUserAiProvider, allowing
 * orchestrator paths (ollama prose fallback, recipe vs freetext prompt, blank-
 * name filtering) to be exercised hermeticaly — no real provider or DB.
 *
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { ChatTurn, ToolCall, AiProvider, ChatRequest } from "@compass/ai";
import type { Db } from "../../../db/index.ts";

// ─── Mock getUserAiProvider BEFORE importing parse-list.ts ───────────────────
// mock.module must be set up before the module under test is evaluated (static
// imports are hoisted and evaluated immediately, so we convert parse-list.ts to
// a dynamic import done after the mock is in place).

let stubProviderRef: AiProvider | null = null;

await mock.module(
  new URL("../../automation/services/ai-settings.ts", import.meta.url).href,
  {
    exports: {
      getUserAiProvider: async () => stubProviderRef,
    },
  },
);

// Now that the mock is registered, import parse-list.ts.  Node resolves the
// module fresh (no prior static import), so it picks up the mocked
// getUserAiProvider binding.
const { parseItemsFromTurn, PARSE_LIST_TOOL, parseListText } = await import(
  "./parse-list.ts"
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<ChatTurn>): ChatTurn {
  return {
    text: "",
    toolCalls: [],
    ...overrides,
  };
}

function makeToolCall(name: string, input: unknown): ToolCall {
  return { id: "tc-" + Math.random().toString(36).slice(2), name, input };
}

/**
 * Build a minimal stub AiProvider.  Only `chat` is meaningful; the other
 * methods are stubs that satisfy the interface but are never called by
 * parseListText.
 */
function makeStubProvider(opts: {
  name: string;
  onChat: (req: ChatRequest) => Promise<ChatTurn>;
  supportsVision?: boolean;
}): AiProvider {
  return {
    name: opts.name,
    enabled: true,
    supportsVision: opts.supportsVision ?? false,
    chat: opts.onChat,
    suggestCategories: async () => [],
    generateSummary: async () => "",
  };
}

// ── AC1/AC3: One matching tool call → parsed ─────────────────────────────────

test("parseItemsFromTurn: 1 tool call with valid input → returns parsed model output", () => {
  const turn = makeTurn({
    toolCalls: [
      makeToolCall(PARSE_LIST_TOOL.name, {
        items: [
          { name: "Atta", quantity: "2", unit: "kg" },
          { name: "Milk", quantity: "1", unit: "litre" },
          { name: "Eggs" },
        ],
      }),
    ],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.ok(result !== null, "Should return non-null for 1 matching tool call");
  assert.equal(result!.items.length, 3);
  assert.equal(result!.items[0]!.name, "Atta");
  assert.equal(result!.items[0]!.quantity, "2");
  assert.equal(result!.items[0]!.unit, "kg");
  assert.equal(result!.items[1]!.name, "Milk");
  assert.equal(result!.items[2]!.name, "Eggs");
  assert.equal(result!.items[2]!.quantity, undefined);
  assert.equal(result!.items[2]!.unit, undefined);
});

test("parseItemsFromTurn: 1 tool call with wrong name is ignored (matches.length=0 → prose path)", () => {
  const turn = makeTurn({
    text: '{"items":[{"name":"Dal"}]}',
    toolCalls: [
      makeToolCall("some_other_tool", { items: [{ name: "NotThis" }] }),
    ],
  });

  // "some_other_tool" doesn't match PARSE_LIST_TOOL.name → 0 matches → prose
  const result = parseItemsFromTurn(turn, true);
  assert.ok(result !== null, "Should parse from prose JSON when tool name doesn't match");
  assert.equal(result!.items.length, 1);
  assert.equal(result!.items[0]!.name, "Dal");
});

// ── AC4/ollama: 0 tool calls → prose extractJson fallback ────────────────────

test("parseItemsFromTurn: 0 tool calls, prose JSON → returns parsed from text (structured=true path)", () => {
  const turn = makeTurn({
    text: '{"items":[{"name":"Rice","quantity":"500","unit":"g"}]}',
    toolCalls: [],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.ok(result !== null);
  assert.equal(result!.items.length, 1);
  assert.equal(result!.items[0]!.name, "Rice");
  assert.equal(result!.items[0]!.quantity, "500");
  assert.equal(result!.items[0]!.unit, "g");
});

test("parseItemsFromTurn: 0 tool calls, structured=false (ollama) → prose extractJson path", () => {
  const turn = makeTurn({
    text: '{"items":[{"name":"Dal"},{"name":"Milk","quantity":"1","unit":"litre"}]}',
    toolCalls: [],
  });

  // structured=false simulates the ollama path (no tools requested)
  const result = parseItemsFromTurn(turn, false);
  assert.ok(result !== null, "Ollama prose path must parse the JSON from text");
  assert.equal(result!.items.length, 2);
  assert.equal(result!.items[0]!.name, "Dal");
  assert.equal(result!.items[1]!.name, "Milk");
});

test("parseItemsFromTurn: 0 tool calls, JSON in markdown fenced block → parsed via extractJson", () => {
  const turn = makeTurn({
    text: 'Here are the items:\n```json\n{"items":[{"name":"Eggs"}]}\n```',
    toolCalls: [],
  });

  const result = parseItemsFromTurn(turn, false);
  assert.ok(result !== null);
  assert.equal(result!.items[0]!.name, "Eggs");
});

// ── AC2: Garbage/unparseable → null ──────────────────────────────────────────

test("parseItemsFromTurn: 0 tool calls, garbage text → null", () => {
  const turn = makeTurn({
    text: "I am unable to parse your list at this time.",
    toolCalls: [],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.equal(result, null, "Garbage text should return null");
});

test("parseItemsFromTurn: 1 tool call with invalid schema (missing items) → null", () => {
  const turn = makeTurn({
    toolCalls: [
      makeToolCall(PARSE_LIST_TOOL.name, { notItems: [] }), // wrong key
    ],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.equal(result, null, "Invalid tool input schema should return null");
});

// ── AC3: ≥2 matching tool calls → fail closed (prose NOT consulted) ──────────

test("parseItemsFromTurn: 2 matching tool calls → fail closed (null), prose NOT consulted", () => {
  const turn = makeTurn({
    text: '{"items":[{"name":"ShouldNotBeRead"}]}', // valid prose — must NOT be used
    toolCalls: [
      makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "ItemA" }] }),
      makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "ItemB" }] }),
    ],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.equal(result, null, "2 matching tool calls must fail closed (null)");
});

test("parseItemsFromTurn: 3 matching tool calls → fail closed (null)", () => {
  const turn = makeTurn({
    toolCalls: [
      makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "A" }] }),
      makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "B" }] }),
      makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "C" }] }),
    ],
  });

  const result = parseItemsFromTurn(turn, true);
  assert.equal(result, null, "3+ matching tool calls must fail closed (null)");
});

// ── iter2 Fix 1: Blank-name filtering in parseListText ───────────────────────
// A model item with name:"   " passes ModelItemSchema (z.string().min(1)) but
// normalizes to rawText:"", violating ParsedShoppingItemSchema.  parseListText
// must filter out blank-rawText items AFTER normalization.

test("parseListText: blank-name item dropped, non-blank item kept (iter2 blocking fix)", async (t) => {
  t.after(() => {
    stubProviderRef = null;
  });

  stubProviderRef = makeStubProvider({
    name: "anthropic",
    onChat: async () => ({
      text: "",
      toolCalls: [
        makeToolCall(PARSE_LIST_TOOL.name, {
          items: [
            { name: "   " }, // whitespace-only — must be dropped
            { name: "milk" }, // valid — must be kept
          ],
        }),
      ],
    }),
  });

  const result = await parseListText(
    {} as unknown as Db,
    "user-1",
    "secret",
    "",
    { text: "milk", sourceKind: "freetext" },
  );

  assert.ok(result.available, "available must be true");
  assert.equal(
    result.items.length,
    1,
    `blank-name item must be dropped; got ${JSON.stringify(result.items)}`,
  );
  assert.equal(result.items[0]!.rawText, "milk");
  assert.equal(result.items[0]!.quantityBase, null);
  assert.equal(result.items[0]!.unit, null);
  assert.equal(result.message, null);
});

test("parseListText: all-blank names → empty items + graceful message (iter2 blocking fix)", async (t) => {
  t.after(() => {
    stubProviderRef = null;
  });

  stubProviderRef = makeStubProvider({
    name: "anthropic",
    onChat: async () => ({
      text: "",
      toolCalls: [
        makeToolCall(PARSE_LIST_TOOL.name, {
          items: [
            { name: "  " },
            { name: "\t" },
          ],
        }),
      ],
    }),
  });

  const result = await parseListText(
    {} as unknown as Db,
    "user-1",
    "secret",
    "",
    { text: "   ", sourceKind: "freetext" },
  );

  assert.ok(result.available, "available must be true");
  assert.equal(result.items.length, 0, "all-blank model names → empty items");
  assert.ok(
    typeof result.message === "string" && result.message.length > 0,
    "graceful message must be set when no items remain",
  );
});

// ── iter2 Fix 3 (AC4): Ollama orchestrator path ───────────────────────────────
// When the provider is ollama, parseListText calls chat with tools:[] and
// toolChoice:undefined, then parses the model's prose response via the
// extractJson fallback (matches.length === 0 path).

test("parseListText: ollama provider → chat called with tools:[] toolChoice:undefined, items parsed via prose (AC4)", async (t) => {
  t.after(() => {
    stubProviderRef = null;
  });

  let capturedTools: ChatRequest["tools"] | undefined;
  let capturedToolChoice: ChatRequest["toolChoice"] | undefined;

  stubProviderRef = makeStubProvider({
    name: "ollama",
    onChat: async (req) => {
      capturedTools = req.tools;
      capturedToolChoice = req.toolChoice;
      // Return prose JSON with no tool calls (the ollama path)
      return {
        text: '{"items":[{"name":"Rice"},{"name":"Lentils","quantity":"500","unit":"g"}]}',
        toolCalls: [],
      };
    },
  });

  const result = await parseListText(
    {} as unknown as Db,
    "user-1",
    "secret",
    "",
    { text: "rice and lentils", sourceKind: "freetext" },
  );

  // chat must have been called without tools (ollama gate)
  assert.deepEqual(capturedTools, [], "ollama must receive tools:[]");
  assert.equal(capturedToolChoice, undefined, "ollama must receive toolChoice:undefined");

  // Items must have been parsed from prose via extractJson fallback
  assert.ok(result.available, "available must be true");
  assert.equal(result.items.length, 2, `Expected 2 items; got ${JSON.stringify(result.items)}`);
  assert.equal(result.items[0]!.rawText, "Rice");
  assert.equal(result.items[1]!.rawText, "Lentils");
  // Lentils has quantity+unit → convertToBaseQuantity("500","g") → quantityBase:500, unit:"g"
  assert.equal(result.items[1]!.quantityBase, 500);
  assert.equal(result.items[1]!.unit, "g");
});

// ── iter2 Fix 4 (AC1): Recipe vs freetext system prompt selection ─────────────
// parseListText selects RECIPE_SYSTEM when sourceKind:"recipe" and
// FREETEXT_SYSTEM when sourceKind:"freetext".

test("parseListText: sourceKind:recipe → recipe system prompt (AC1)", async (t) => {
  t.after(() => {
    stubProviderRef = null;
  });

  let capturedSystem: string | undefined;

  stubProviderRef = makeStubProvider({
    name: "anthropic",
    onChat: async (req) => {
      capturedSystem = req.system;
      return {
        text: "",
        toolCalls: [
          makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "Eggs" }] }),
        ],
      };
    },
  });

  await parseListText(
    {} as unknown as Db,
    "user-1",
    "secret",
    "",
    { text: "Pasta carbonara: eggs, guanciale, pecorino", sourceKind: "recipe" },
  );

  assert.ok(
    capturedSystem !== undefined,
    "chat must have been called (system prompt captured)",
  );
  assert.ok(
    capturedSystem!.includes("recipe") || capturedSystem!.includes("INGREDIENT"),
    `Recipe prompt must mention recipe/INGREDIENT; got: "${capturedSystem}"`,
  );
  // Ensure the freetext-specific phrase is NOT in the recipe prompt
  assert.ok(
    !capturedSystem!.includes("free-text shopping list"),
    "Recipe prompt must not contain freetext phrasing",
  );
});

test("parseListText: sourceKind:freetext → freetext system prompt (AC1)", async (t) => {
  t.after(() => {
    stubProviderRef = null;
  });

  let capturedSystem: string | undefined;

  stubProviderRef = makeStubProvider({
    name: "anthropic",
    onChat: async (req) => {
      capturedSystem = req.system;
      return {
        text: "",
        toolCalls: [
          makeToolCall(PARSE_LIST_TOOL.name, { items: [{ name: "Atta" }] }),
        ],
      };
    },
  });

  await parseListText(
    {} as unknown as Db,
    "user-1",
    "secret",
    "",
    { text: "2kg atta, milk 1L", sourceKind: "freetext" },
  );

  assert.ok(
    capturedSystem !== undefined,
    "chat must have been called (system prompt captured)",
  );
  assert.ok(
    capturedSystem!.includes("free-text"),
    `Freetext prompt must contain "free-text"; got: "${capturedSystem}"`,
  );
  // Ensure the recipe-specific phrase is NOT in the freetext prompt
  assert.ok(
    !capturedSystem!.includes("INGREDIENT"),
    "Freetext prompt must not contain INGREDIENT phrasing",
  );
});
