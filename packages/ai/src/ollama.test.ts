import { test } from "node:test";
import assert from "node:assert/strict";
import { createOllamaProvider, toOllamaContent } from "./ollama.ts";
import { AiVisionUnsupportedError } from "./types.ts";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a queue of canned responses; captures every call
 * (url + RequestInit) so a test can inspect the actual serialized request
 * body, not the pre-serialization JS object. File-local, restored in
 * `finally` — following `http.test.ts`'s `stubFetch` pattern. */
function stubFetch(responses: Array<{ status: number; body: string }>): {
  restore: () => void;
  calls: CapturedCall[];
} {
  const orig = globalThis.fetch;
  const calls: CapturedCall[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.body,
    } as Response;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
    calls,
  };
}

function ollama() {
  return createOllamaProvider({ baseUrl: "http://localhost:11434", model: "llama3" });
}

// ---------------------------------------------------------------------------
// Vision guard
// ---------------------------------------------------------------------------

test("ollama chat: rejects with AiVisionUnsupportedError when a user message contains an image block, without making any HTTP call", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ message: { role: "assistant", content: "ok" } }) },
  ]);
  try {
    await assert.rejects(
      () =>
        ollama().chat({
          system: "sys",
          messages: [
            {
              role: "user",
              content: [
                { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
              ],
            },
          ],
          tools: [],
        }),
      (err: unknown) => {
        assert.ok(err instanceof AiVisionUnsupportedError);
        assert.match(err.message, /Provider "ollama" does not support image input/);
        return true;
      },
    );
    assert.equal(calls.length, 0, "no HTTP call must be made before rejection");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Regression: plain string content still works
// ---------------------------------------------------------------------------

test("ollama chat: plain string user content is serialized unchanged", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ message: { role: "assistant", content: "ok" } }) },
  ]);
  try {
    await ollama().chat({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
  } finally {
    restore();
  }
  const wireBody = JSON.parse(calls[0]!.init.body as string) as { messages: unknown[] };
  assert.deepEqual(wireBody.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);
});

// ---------------------------------------------------------------------------
// Text block list flattening
// ---------------------------------------------------------------------------

test("ollama chat: a block list of text-only blocks is flattened to a newline-joined string", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ message: { role: "assistant", content: "ok" } }) },
  ]);
  try {
    await ollama().chat({
      system: "sys",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ],
      tools: [],
    });
  } finally {
    restore();
  }
  const wireBody = JSON.parse(calls[0]!.init.body as string) as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const userMsg = wireBody.messages.find((m) => m.role === "user");
  assert.equal(userMsg!.content, "a\nb");
});

// ---------------------------------------------------------------------------
// toOllamaContent — tested directly: an image block cannot reach it through
// chat(), which rejects images before serialization.
// ---------------------------------------------------------------------------

test("toOllamaContent: a plain string passes through unchanged", () => {
  assert.equal(toOllamaContent("hello"), "hello");
});

test("toOllamaContent: text blocks are newline-joined", () => {
  assert.equal(
    toOllamaContent([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
    "a\nb",
  );
});

test("toOllamaContent: a non-text block is dropped, not turned into a blank line", () => {
  assert.equal(
    toOllamaContent([
      { type: "text", text: "a" },
      { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      { type: "text", text: "b" },
    ]),
    "a\nb",
  );
});

test("toOllamaContent: an image-only block list collapses to an empty string", () => {
  // Two blocks, not one: `[""].join("\n")` and `[].join("\n")` are both "", so a
  // single block cannot distinguish a correct implementation from one that maps
  // non-text blocks to empty strings. Two can — "\n" vs "".
  assert.equal(
    toOllamaContent([
      { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      { type: "image", mediaType: "image/jpeg", data: "aGVsbG8=" },
    ]),
    "",
  );
});
