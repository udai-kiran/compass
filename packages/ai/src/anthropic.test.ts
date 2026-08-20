import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropicProvider } from "./anthropic.ts";
import { AiImageRejectedError, MAX_IMAGE_BYTES, type AiImageMediaType, type ContentBlock, type ToolSpec } from "./types.ts";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a queue of canned responses; captures every call
 * (url + RequestInit) so a test can inspect the actual serialized request
 * body/signal, not the pre-serialization JS object. File-local, restored in
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

/**
 * A fetch stub whose returned Promise only settles — by rejecting, simulating
 * a native `AbortError` — when `RequestInit.signal`'s `abort` event fires. NOT
 * a stub that resolves immediately, which would never exercise the abort path
 * at all. This is what genuinely proves `timeoutMs` reached `postJson`.
 */
function stubAbortAwareFetch(): { restore: () => void; calls: CapturedCall[] } {
  const orig = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = orig;
    },
    calls,
  };
}

function body(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

const TOOL: ToolSpec = {
  name: "record_thing",
  description: "desc",
  inputSchema: { type: "object", properties: {}, required: [] },
};

// ---------------------------------------------------------------------------
// tool_choice presence/absence in the serialized request body
// ---------------------------------------------------------------------------

test("chat: tool_choice omitted when toolChoice is unset, tools: [] (today's extractor pre-change shape)", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "hi" }] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await ai.chat({ system: "sys", messages: [{ role: "user", content: "hello" }], tools: [] });
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  const parsed = body(calls[0]!);
  assert.equal("tool_choice" in parsed, false);
});

test("chat: tool_choice omitted for an assistant-shaped multi-turn request (matches assistant.ts's request bodies)", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "answer" }] }) },
  ]);
  const assistantTool: ToolSpec = {
    name: "get_spending_summary",
    description: "Income, expenses, net, savings rate, top categories and merchants for a month.",
    inputSchema: { type: "object", properties: { period: { type: "string" } } },
  };
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "claude-x" });
    await ai.chat({
      system: "You are Compass.",
      tools: [assistantTool],
      maxTokens: 1024,
      messages: [
        { role: "user", content: "What's my spending?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "get_spending_summary", input: { period: "2026-07" } }],
        },
        { role: "tool", toolCallId: "call_1", content: '{"income":"₹1,00,000"}' },
      ],
    });
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  const parsed = body(calls[0]!);
  assert.equal("tool_choice" in parsed, false);
  assert.deepEqual(parsed, {
    model: "claude-x",
    max_tokens: 1024,
    system: "You are Compass.",
    tools: [
      {
        name: "get_spending_summary",
        description: "Income, expenses, net, savings rate, top categories and merchants for a month.",
        input_schema: { type: "object", properties: { period: { type: "string" } } },
      },
    ],
    messages: [
      { role: "user", content: "What's my spending?" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "get_spending_summary", input: { period: "2026-07" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: '{"income":"₹1,00,000"}' },
        ],
      },
    ],
  });
});

test("chat: tool_choice forces the named tool with the native Anthropic shape when toolChoice is set and present", async () => {
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ content: [] }) }]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await ai.chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [TOOL],
      toolChoice: TOOL.name,
    });
  } finally {
    restore();
  }
  const parsed = body(calls[0]!);
  assert.deepEqual(parsed.tool_choice, { type: "tool", name: "record_thing" });
});

test("chat: rejects before any fetch call when toolChoice names a tool absent from tools", async () => {
  const { restore, calls } = stubFetch([{ status: 200, body: "{}" }]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await assert.rejects(
      () => ai.chat({ system: "sys", messages: [], tools: [], toolChoice: "missing_tool" }),
      Error,
    );
    assert.equal(calls.length, 0, "fetch must never be invoked for a misconfigured toolChoice");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

test("chat: maps a single correct tool_use block into toolCalls", async () => {
  const { restore } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "tool_use", id: "t1", name: "record_thing", input: { a: 1 } }] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    const turn = await ai.chat({ system: "s", messages: [], tools: [TOOL], toolChoice: TOOL.name });
    assert.deepEqual(turn.toolCalls, [{ id: "t1", name: "record_thing", input: { a: 1 } }]);
  } finally {
    restore();
  }
});

test("chat: maps multiple tool_use blocks preserving order", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        content: [
          { type: "tool_use", id: "t1", name: "tool_a", input: { x: 1 } },
          { type: "tool_use", id: "t2", name: "tool_b", input: { y: 2 } },
        ],
      }),
    },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    const turn = await ai.chat({ system: "s", messages: [], tools: [] });
    assert.deepEqual(turn.toolCalls, [
      { id: "t1", name: "tool_a", input: { x: 1 } },
      { id: "t2", name: "tool_b", input: { y: 2 } },
    ]);
  } finally {
    restore();
  }
});

test("chat: a tool call with an unexpected/wrong name is still mapped into toolCalls as-is (name-selection is extract.ts's job)", async () => {
  const { restore } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "tool_use", id: "t1", name: "unexpected_name", input: {} }] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    const turn = await ai.chat({ system: "s", messages: [], tools: [TOOL], toolChoice: TOOL.name });
    assert.deepEqual(turn.toolCalls, [{ id: "t1", name: "unexpected_name", input: {} }]);
  } finally {
    restore();
  }
});

test("chat: a tool_use block missing id or name is filtered out", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        content: [
          { type: "tool_use", name: "no_id" },
          { type: "tool_use", id: "no_name" },
          { type: "tool_use", id: "t1", name: "ok", input: { x: 1 } },
        ],
      }),
    },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    const turn = await ai.chat({ system: "s", messages: [], tools: [] });
    assert.deepEqual(turn.toolCalls, [{ id: "t1", name: "ok", input: { x: 1 } }]);
  } finally {
    restore();
  }
});

test("chat: tool_use input absent/wrong-typed is passed through as-is (validation is extract.ts's job)", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        content: [
          { type: "tool_use", id: "t1", name: "no_input" },
          { type: "tool_use", id: "t2", name: "string_input", input: "a string, not an object" },
        ],
      }),
    },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    const turn = await ai.chat({ system: "s", messages: [], tools: [] });
    assert.deepEqual(turn.toolCalls, [
      { id: "t1", name: "no_input", input: undefined },
      { id: "t2", name: "string_input", input: "a string, not an object" },
    ]);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Anthropic-only: timeoutMs/retries forwarding into postJson (P2, AC9) —
// tested independently of, and not conflated with, the tool-choice
// byte-identical claims above.
// ---------------------------------------------------------------------------

test("chat: forwards retries to postJson — N always-500 responses yield N+1 fetch calls", async () => {
  const retries = 2;
  const { restore, calls } = stubFetch([{ status: 500, body: "upstream error" }]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await assert.rejects(() => ai.chat({ system: "s", messages: [], tools: [], retries }));
  } finally {
    restore();
  }
  assert.equal(calls.length, retries + 1);
});

test("chat: forwards timeoutMs to postJson — a genuinely abort-aware stub proves the abort path is exercised", async () => {
  const { restore, calls } = stubAbortAwareFetch();
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await assert.rejects(() => ai.chat({ system: "s", messages: [], tools: [], timeoutMs: 20, retries: 0 }));
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.init.signal, "an AbortSignal must be attached for timeoutMs to have any effect");
});

// ---------------------------------------------------------------------------
// Vision: image content serialization (task 8.1)
// ---------------------------------------------------------------------------

test("chat: multi-part user message serializes to native Anthropic content-block shape", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await ai.chat({
      system: "sys",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
          ],
        },
      ],
      tools: [],
    });
  } finally {
    restore();
  }
  const parsed = body(calls[0]!);
  assert.deepEqual((parsed.messages as Array<{ content: unknown }>)[0]!.content, [
    { type: "text", text: "what is this" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
  ]);
});

test("chat: plain string user message still serializes as a bare string (vision regression)", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await ai.chat({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
  } finally {
    restore();
  }
  assert.deepEqual(body(calls[0]!).messages, [{ role: "user", content: "hello" }]);
});

test("chat: oversized image throws AiImageRejectedError before any fetch call", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [] }) },
  ]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await assert.rejects(
      () =>
        ai.chat({
          system: "sys",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  mediaType: "image/png",
                  data: "A".repeat(MAX_IMAGE_BYTES * 2),
                },
              ],
            },
          ],
          tools: [],
        }),
      (err: unknown) => {
        assert.ok(err instanceof AiImageRejectedError);
        assert.match(err.message, /above the \d+-byte limit/);
        return true;
      },
    );
    assert.equal(calls.length, 0, "no HTTP call must be made when image is rejected");
  } finally {
    restore();
  }
});

test("chat: an unsupported image media type throws before any fetch call", async () => {
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ content: [] }) }]);
  try {
    const ai = createAnthropicProvider({ apiKey: "k", model: "m" });
    await assert.rejects(
      () =>
        ai.chat({
          system: "sys",
          messages: [
            {
              role: "user",
              content: [{ type: "image", mediaType: "image/tiff" as AiImageMediaType, data: "aGVsbG8=" }],
            },
          ],
          tools: [],
        }),
      (err: unknown) => {
        assert.ok(err instanceof AiImageRejectedError);
        assert.match(err.message, /Unsupported image media type/);
        return true;
      },
    );
    assert.equal(calls.length, 0, "no HTTP call must be made when the media type is rejected");
  } finally {
    restore();
  }
});

test("chat: an unknown content block type is rejected before any fetch call", async () => {
  // Guards against a runtime-shaped block bypassing the media-type and size
  // checks and being serialized as an image anyway.
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ content: [] }) }]);
  try {
    const rogue = {
      type: "not-image",
      mediaType: "image/tiff",
      data: "A".repeat(8 * 1024 * 1024),
    } as unknown as ContentBlock;
    await assert.rejects(
      () => createAnthropicProvider({ apiKey: "k", model: "m" }).chat({ system: "sys", messages: [{ role: "user", content: [rogue] }], tools: [] }),
      (err: unknown) => {
        assert.ok(err instanceof AiImageRejectedError);
        assert.match(err.message, /Unsupported content block type/);
        return true;
      },
    );
    assert.equal(calls.length, 0, "no HTTP call must be made for an unknown block type");
  } finally {
    restore();
  }
});
