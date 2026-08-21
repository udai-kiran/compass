/**
 * Hermetic tests for parseListImage (task 9.5 P6).
 *
 * Uses mock.module to stub:
 *   - getUserAiProvider (from automation/services/ai-settings.ts)
 * Uses a mock Storage object.
 *
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 *
 * Tests:
 *   - Success path: exactly one ImageBlock with correct mediaType + raw base64
 *     (no `data:` prefix); tools/toolChoice set; storage.put AND delete called.
 *   - chat-throw path: storage.delete still called; error propagates.
 *   - !enabled path: graceful message, chat NOT called, storage.put NOT called.
 *   - !supportsVision (ollama-like) path: same.
 *   - !supportsVision (text-only openai-compat stub): same.
 *   - Unreadable turn (no tool call, no JSON): empty items, available:true.
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { AiProvider, ChatRequest, ChatTurn } from "@compass/ai";
import type { Storage } from "../../../lib/storage.ts";

// ─── Mock getUserAiProvider BEFORE importing parse-image.ts ──────────────────

let stubProviderRef: AiProvider | null = null;

await mock.module(
  new URL("../../automation/services/ai-settings.ts", import.meta.url).href,
  {
    exports: {
      getUserAiProvider: async () => stubProviderRef,
    },
  },
);

// Now that the mock is registered, import the module under test.
const { parseListImage } = await import("./parse-image.ts");

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Minimal Db stub — never actually queried in these hermetic tests. */
const fakeDb = {} as never;

/** Build a mock Storage that records put/delete calls. */
function makeMockStorage(): {
  storage: Storage;
  putCalls: { data: Buffer; contentType: string }[];
  deleteCalls: string[];
} {
  const putCalls: { data: Buffer; contentType: string }[] = [];
  const deleteCalls: string[] = [];
  const storage: Storage = {
    async put(data, contentType) {
      putCalls.push({ data, contentType });
      return "test/key-abc123";
    },
    async delete(key) {
      deleteCalls.push(key);
    },
    async get() {
      return Buffer.alloc(0);
    },
    async list() {
      return [];
    },
    async ensureReady() {},
  };
  return { storage, putCalls, deleteCalls };
}

/** Build a stub AiProvider that records chat calls. */
function makeVisionProvider(chatReply: ChatTurn): {
  provider: AiProvider;
  chatCalls: ChatRequest[];
} {
  const chatCalls: ChatRequest[] = [];
  return {
    provider: {
      name: "anthropic",
      enabled: true,
      supportsVision: true,
      async suggestCategories() {
        return [];
      },
      async generateSummary() {
        return "";
      },
      async chat(req) {
        chatCalls.push(req);
        return chatReply;
      },
    },
    chatCalls,
  };
}

/** Build a valid JPEG buffer (magic bytes 0xFF 0xD8 0xFF + some data). */
function makeJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02]);
}

const PARSE_TOOL_NAME = "parse_shopping_list";

/** A valid tool-call turn with two items. */
function makeParseTurn(): ChatTurn {
  return {
    text: "",
    toolCalls: [
      {
        id: "tc-1",
        name: PARSE_TOOL_NAME,
        input: {
          items: [
            { name: "Atta", quantity: "2", unit: "kg" },
            { name: "Milk" },
          ],
        },
      },
    ],
  };
}

const deps = (storage: Storage) => ({
  db: fakeDb,
  storage,
  secret: "test-secret",
  allowedBaseUrls: "",
});

// ─── Success path ─────────────────────────────────────────────────────────────

test("parseListImage: success path — ImageBlock has correct mediaType + raw base64, tools/toolChoice set, storage.put AND delete called", async () => {
  const jpegBuf = makeJpegBuffer();
  const { storage, putCalls, deleteCalls } = makeMockStorage();
  const { provider, chatCalls } = makeVisionProvider(makeParseTurn());
  stubProviderRef = provider;

  const result = await parseListImage(
    deps(storage),
    "user-1",
    { buffer: jpegBuf, contentType: "image/jpeg" },
  );

  // Result shape.
  assert.equal(result.available, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.rawText, "Atta");
  assert.equal(result.message, null);

  // Exactly one chat call.
  assert.equal(chatCalls.length, 1);
  const req = chatCalls[0]!;

  // Tools and toolChoice set.
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0]!.name, PARSE_TOOL_NAME);
  assert.equal(req.toolChoice, PARSE_TOOL_NAME);

  // Messages: exactly one user message with ContentBlock[] content.
  assert.equal(req.messages.length, 1);
  const msg = req.messages[0]!;
  assert.equal(msg.role, "user");
  assert.ok(Array.isArray(msg.content), "content must be a ContentBlock array");

  const content = msg.content as Array<{ type: string; mediaType?: string; data?: string; text?: string }>;

  // Find the ImageBlock.
  const imageBlocks = content.filter((b) => b.type === "image");
  assert.equal(imageBlocks.length, 1, "exactly one ImageBlock");
  const imgBlock = imageBlocks[0]!;

  // Correct mediaType.
  assert.equal(imgBlock.mediaType, "image/jpeg");

  // data is raw base64 — no "data:" prefix.
  assert.ok(typeof imgBlock.data === "string", "data must be a string");
  assert.ok(!imgBlock.data!.startsWith("data:"), "data must NOT have a 'data:' URI prefix");

  // data matches the expected base64 of the buffer.
  assert.equal(imgBlock.data, jpegBuf.toString("base64"));

  // storage.put called once with the buffer and content-type.
  assert.equal(putCalls.length, 1);
  assert.ok(putCalls[0]!.data.equals(jpegBuf));
  assert.equal(putCalls[0]!.contentType, "image/jpeg");

  // storage.delete called once with the key returned by put.
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0], "test/key-abc123");
});

// ─── chat-throw path ──────────────────────────────────────────────────────────

test("parseListImage: chat throws → error propagates AND storage.delete still called", async () => {
  const jpegBuf = makeJpegBuffer();
  const { storage, deleteCalls } = makeMockStorage();

  const chatError = new Error("Provider unreachable");
  stubProviderRef = {
    name: "anthropic",
    enabled: true,
    supportsVision: true,
    async suggestCategories() {
      return [];
    },
    async generateSummary() {
      return "";
    },
    async chat() {
      throw chatError;
    },
  };

  await assert.rejects(
    () => parseListImage(deps(storage), "user-1", { buffer: jpegBuf, contentType: "image/jpeg" }),
    (err: Error) => err === chatError,
  );

  // Delete still called despite chat error.
  assert.equal(deleteCalls.length, 1, "storage.delete must be called even when chat throws");
  assert.equal(deleteCalls[0], "test/key-abc123");
});

// ─── !enabled path ────────────────────────────────────────────────────────────

test("parseListImage: !ai.enabled → graceful message, chat NOT called, storage.put NOT called", async () => {
  const { storage, putCalls } = makeMockStorage();
  let chatCalled = false;

  stubProviderRef = {
    name: "none",
    enabled: false,
    supportsVision: false,
    async suggestCategories() {
      return [];
    },
    async generateSummary() {
      return "";
    },
    async chat() {
      chatCalled = true;
      return { text: "", toolCalls: [] };
    },
  };

  const result = await parseListImage(
    deps(storage),
    "user-1",
    { buffer: makeJpegBuffer(), contentType: "image/jpeg" },
  );

  assert.equal(result.available, false);
  assert.equal(result.message, "AI is not configured");
  assert.equal(result.items.length, 0);
  assert.equal(chatCalled, false, "chat must NOT be called");
  assert.equal(putCalls.length, 0, "storage.put must NOT be called");
});

// ─── !supportsVision (ollama-like) path ───────────────────────────────────────

test("parseListImage: ollama (supportsVision=false) → graceful message, chat NOT called, storage.put NOT called", async () => {
  const { storage, putCalls } = makeMockStorage();
  let chatCalled = false;

  stubProviderRef = {
    name: "ollama",
    enabled: true,
    supportsVision: false,
    async suggestCategories() {
      return [];
    },
    async generateSummary() {
      return "";
    },
    async chat() {
      chatCalled = true;
      return { text: "", toolCalls: [] };
    },
  };

  const result = await parseListImage(
    deps(storage),
    "user-1",
    { buffer: makeJpegBuffer(), contentType: "image/jpeg" },
  );

  assert.equal(result.available, false);
  assert.equal(result.message, "Photo capture requires a vision-capable AI provider");
  assert.equal(result.items.length, 0);
  assert.equal(chatCalled, false, "chat must NOT be called");
  assert.equal(putCalls.length, 0, "storage.put must NOT be called");
});

// ─── !supportsVision (text-only openai-compat stub) ───────────────────────────

test("parseListImage: text-only openai-compat (deepseek-chat, supportsVision=false) → graceful message, chat NOT called, storage.put NOT called", async () => {
  const { storage, putCalls } = makeMockStorage();
  let chatCalled = false;

  stubProviderRef = {
    name: "deepseek",
    enabled: true,
    supportsVision: false, // deepseek-chat is text-only
    async suggestCategories() {
      return [];
    },
    async generateSummary() {
      return "";
    },
    async chat() {
      chatCalled = true;
      return { text: "", toolCalls: [] };
    },
  };

  const result = await parseListImage(
    deps(storage),
    "user-1",
    { buffer: makeJpegBuffer(), contentType: "image/jpeg" },
  );

  assert.equal(result.available, false);
  assert.equal(result.message, "Photo capture requires a vision-capable AI provider");
  assert.equal(result.items.length, 0);
  assert.equal(chatCalled, false);
  assert.equal(putCalls.length, 0);
});

// ─── Unreadable turn → empty items ───────────────────────────────────────────

test("parseListImage: unreadable turn (no tool call, no JSON) → empty items, available:true", async () => {
  const { storage } = makeMockStorage();
  const { provider } = makeVisionProvider({ text: "I cannot read this image", toolCalls: [] });
  stubProviderRef = provider;

  const result = await parseListImage(
    deps(storage),
    "user-1",
    { buffer: makeJpegBuffer(), contentType: "image/jpeg" },
  );

  assert.equal(result.available, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.message, "Could not read any items from the image");
});

// ─── PNG content-type test ────────────────────────────────────────────────────

test("parseListImage: PNG buffer — ImageBlock mediaType is image/png", async () => {
  // PNG magic bytes: 89 50 4e 47 0d 0a 1a 0a
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const { storage } = makeMockStorage();
  const { provider, chatCalls } = makeVisionProvider(makeParseTurn());
  stubProviderRef = provider;

  await parseListImage(deps(storage), "user-1", { buffer: pngBuf, contentType: "image/png" });

  const msg = chatCalls[0]!.messages[0]!;
  const content = msg.content as Array<{ type: string; mediaType?: string; data?: string }>;
  const imgBlock = content.find((b) => b.type === "image")!;
  assert.equal(imgBlock.mediaType, "image/png");
  assert.equal(imgBlock.data, pngBuf.toString("base64"));
  assert.ok(!imgBlock.data!.startsWith("data:"));
});
