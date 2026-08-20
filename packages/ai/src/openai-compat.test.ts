import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatProvider } from "./openai-compat.ts";
import { AiImageRejectedError, MAX_IMAGE_BYTES, type AiImageMediaType, type ContentBlock, type ToolSpec } from "./types.ts";

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

function body(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function provider() {
  return createOpenAiCompatProvider({
    name: "openrouter",
    apiKey: "k",
    model: "m",
    baseUrl: "https://openrouter.ai/api/v1",
  });
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
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "hi" } }] }) },
  ]);
  try {
    await provider().chat({ system: "sys", messages: [{ role: "user", content: "hello" }], tools: [] });
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  const parsed = body(calls[0]!);
  assert.equal("tool_choice" in parsed, false);
});

test("chat: tool_choice omitted for an assistant-shaped multi-turn request (matches assistant.ts's request bodies)", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "answer" } }] }) },
  ]);
  const assistantTool: ToolSpec = {
    name: "get_spending_summary",
    description: "Income, expenses, net, savings rate, top categories and merchants for a month.",
    inputSchema: { type: "object", properties: { period: { type: "string" } } },
  };
  try {
    await provider().chat({
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
    model: "m",
    max_tokens: 1024,
    messages: [
      { role: "system", content: "You are Compass." },
      { role: "user", content: "What's my spending?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_spending_summary", arguments: JSON.stringify({ period: "2026-07" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"income":"₹1,00,000"}' },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "get_spending_summary",
          description: "Income, expenses, net, savings rate, top categories and merchants for a month.",
          parameters: { type: "object", properties: { period: { type: "string" } } },
        },
      },
    ],
  });
});

test("chat: tool_choice forces the named tool with the native OpenAI shape when toolChoice is set and present", async () => {
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ choices: [] }) }]);
  try {
    await provider().chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [TOOL],
      toolChoice: TOOL.name,
    });
  } finally {
    restore();
  }
  const parsed = body(calls[0]!);
  assert.deepEqual(parsed.tool_choice, { type: "function", function: { name: "record_thing" } });
});

test("chat: rejects before any fetch call when toolChoice names a tool absent from tools", async () => {
  const { restore, calls } = stubFetch([{ status: 200, body: "{}" }]);
  try {
    await assert.rejects(
      () => provider().chat({ system: "sys", messages: [], tools: [], toolChoice: "missing_tool" }),
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

test("chat: maps a single correct tool call into toolCalls", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [{ id: "call_1", function: { name: "record_thing", arguments: '{"a":1}' } }],
            },
          },
        ],
      }),
    },
  ]);
  try {
    const turn = await provider().chat({ system: "s", messages: [], tools: [TOOL], toolChoice: TOOL.name });
    assert.deepEqual(turn.toolCalls, [{ id: "call_1", name: "record_thing", input: { a: 1 } }]);
  } finally {
    restore();
  }
});

test("chat: maps multiple tool calls preserving order", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                { id: "call_1", function: { name: "tool_a", arguments: '{"x":1}' } },
                { id: "call_2", function: { name: "tool_b", arguments: '{"y":2}' } },
              ],
            },
          },
        ],
      }),
    },
  ]);
  try {
    const turn = await provider().chat({ system: "s", messages: [], tools: [] });
    assert.deepEqual(turn.toolCalls, [
      { id: "call_1", name: "tool_a", input: { x: 1 } },
      { id: "call_2", name: "tool_b", input: { y: 2 } },
    ]);
  } finally {
    restore();
  }
});

test("chat: a tool call with an unexpected/wrong name is still mapped into toolCalls as-is (name-selection is extract.ts's job)", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        choices: [
          { message: { tool_calls: [{ id: "call_1", function: { name: "unexpected_name", arguments: "{}" } }] } },
        ],
      }),
    },
  ]);
  try {
    const turn = await provider().chat({ system: "s", messages: [], tools: [TOOL], toolChoice: TOOL.name });
    assert.deepEqual(turn.toolCalls, [{ id: "call_1", name: "unexpected_name", input: {} }]);
  } finally {
    restore();
  }
});

test("chat: malformed function.arguments (invalid JSON string) maps to {} without throwing", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        choices: [
          { message: { tool_calls: [{ id: "call_1", function: { name: "record_thing", arguments: "{not json" } }] } },
        ],
      }),
    },
  ]);
  try {
    const turn = await provider().chat({ system: "s", messages: [], tools: [] });
    assert.deepEqual(turn.toolCalls, [{ id: "call_1", name: "record_thing", input: {} }]);
  } finally {
    restore();
  }
});

test("chat: a tool call missing id gets a generated one, without throwing", async () => {
  const { restore } = stubFetch([
    {
      status: 200,
      body: JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { name: "record_thing", arguments: "{}" } }] } }],
      }),
    },
  ]);
  try {
    const turn = await provider().chat({ system: "s", messages: [], tools: [] });
    assert.equal(turn.toolCalls.length, 1);
    assert.equal(typeof turn.toolCalls[0]!.id, "string");
    assert.ok(turn.toolCalls[0]!.id.length > 0);
    assert.equal(turn.toolCalls[0]!.name, "record_thing");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// timeoutMs/retries were already forwarded before this task — no change, no
// new test needed here (see anthropic.test.ts for the newly-fixed gap there).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vision: image content serialization (task 8.1)
// ---------------------------------------------------------------------------

test("chat: multi-part user message serializes to native OpenAI content-block shape", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) },
  ]);
  try {
    await provider().chat({
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
  // system is messages[0], user is messages[1]
  assert.deepEqual((parsed.messages as Array<{ content: unknown }>)[1]!.content, [
    { type: "text", text: "what is this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
  ]);
});

test("chat: plain string user message still serializes as a bare string (vision regression)", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) },
  ]);
  try {
    await provider().chat({
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
  } finally {
    restore();
  }
  assert.deepEqual(body(calls[0]!).messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);
});

test("chat: oversized image throws AiImageRejectedError before any fetch call", async () => {
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [] }) },
  ]);
  try {
    await assert.rejects(
      () =>
        provider().chat({
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
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ choices: [] }) }]);
  try {
    await assert.rejects(
      () =>
        provider().chat({
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

test("chat: an unknown content block type is rejected before any fetch call (openai-compat)", async () => {
  // Guards against a runtime-shaped block bypassing the media-type and size
  // checks and being serialized as an image anyway.
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ choices: [] }) }]);
  try {
    const rogue = {
      type: "not-image",
      mediaType: "image/tiff",
      data: "A".repeat(8 * 1024 * 1024),
    } as unknown as ContentBlock;
    await assert.rejects(
      () => provider().chat({ system: "sys", messages: [{ role: "user", content: [rogue] }], tools: [] }),
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
