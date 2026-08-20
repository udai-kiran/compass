import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base64ByteLength,
  hasImageContent,
  assertImagesValid,
  AiImageRejectedError,
  AiUnavailableError,
  MAX_IMAGE_BYTES,
  type AiImageMediaType,
  type ChatMessage,
  type AiCallObservation,
  type ContentBlock,
} from "./types.ts";
import { postJson } from "./http.ts";

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

// ---------------------------------------------------------------------------
// base64ByteLength
// ---------------------------------------------------------------------------

test("base64ByteLength: matches Buffer.from(s, 'base64').length for == padding", () => {
  const s = "YQ=="; // "a" — 1 byte, == padding
  assert.equal(base64ByteLength(s), Buffer.from(s, "base64").length);
});

test("base64ByteLength: matches Buffer.from(s, 'base64').length for = padding", () => {
  const s = "YWI="; // "ab" — 2 bytes, = padding
  assert.equal(base64ByteLength(s), Buffer.from(s, "base64").length);
});

test("base64ByteLength: matches Buffer.from(s, 'base64').length for no padding", () => {
  const s = "YWJj"; // "abc" — 3 bytes, no padding
  assert.equal(base64ByteLength(s), Buffer.from(s, "base64").length);
});

// ---------------------------------------------------------------------------
// hasImageContent
// ---------------------------------------------------------------------------

test("hasImageContent: returns false for plain string user messages", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
  assert.equal(hasImageContent(messages), false);
});

test("hasImageContent: returns false for a block list containing only text blocks", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ];
  assert.equal(hasImageContent(messages), false);
});

test("hasImageContent: returns true when a block list contains an image block", () => {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    },
  ];
  assert.equal(hasImageContent(messages), true);
});

// ---------------------------------------------------------------------------
// assertImagesValid — throws
// ---------------------------------------------------------------------------

// `image/tiff` cannot typecheck — the cast simulates an unvalidated value
// arriving at runtime (e.g. from a future HTTP boundary), which is exactly what
// this runtime guard exists to catch.
test("assertImagesValid: throws AiImageRejectedError for unsupported media type", () => {
  assert.throws(
    () =>
      assertImagesValid([
        {
          role: "user",
          content: [
            { type: "image", mediaType: "image/tiff" as AiImageMediaType, data: "aGVsbG8=" },
          ],
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /Unsupported image media type/);
      return true;
    },
  );
});

test("assertImagesValid: throws AiImageRejectedError when data begins with 'data:'", () => {
  assert.throws(
    () =>
      assertImagesValid([
        {
          role: "user",
          content: [
            {
              type: "image",
              mediaType: "image/png",
              data: "data:image/png;base64,aGVsbG8=",
            },
          ],
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /without a data: URI prefix/);
      return true;
    },
  );
});

test("assertImagesValid: throws AiImageRejectedError for non-base64 data", () => {
  assert.throws(
    () =>
      assertImagesValid([
        {
          role: "user",
          content: [
            { type: "image", mediaType: "image/png", data: "!!!not base64!!!" },
          ],
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /not valid base64/);
      return true;
    },
  );
});

test("assertImagesValid: throws AiImageRejectedError for empty-string data", () => {
  assert.throws(
    () =>
      assertImagesValid([
        {
          role: "user",
          content: [
            { type: "image", mediaType: "image/png", data: "" },
          ],
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /not valid base64/);
      return true;
    },
  );
});

test("assertImagesValid: a multi-megabyte image raises the typed error, not a RangeError", () => {
  // A nested-quantifier base64 regex overflows the regex stack at this size and
  // would throw RangeError instead of the typed error. Guards against that.
  assert.throws(
    () =>
      assertImagesValid([
        {
          role: "user",
          content: [{ type: "image", mediaType: "image/png", data: "A".repeat(MAX_IMAGE_BYTES * 2) }],
        },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError, `expected AiImageRejectedError, got ${String(err)}`);
      assert.match(err.message, /above the \d+-byte limit/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// assertImagesValid — does NOT throw
// ---------------------------------------------------------------------------

test("assertImagesValid: does not throw for a valid small PNG block", () => {
  assertImagesValid([
    {
      role: "user",
      content: [{ type: "image", mediaType: "image/png", data: "aGVsbG8=" }],
    },
  ]);
  // reaching here = pass
});

test("assertImagesValid: does not throw for text-only messages", () => {
  assertImagesValid([{ role: "user", content: "hi" }]);
  // reaching here = pass
});

// ---------------------------------------------------------------------------
// ai_events redaction (the important one)
// ---------------------------------------------------------------------------

test("redaction: Anthropic image bytes are omitted from observer but sent on the wire", async () => {
  const BIG = "A".repeat(4000);
  const reqBody = {
    model: "m",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "read this" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: BIG },
          },
        ],
      },
    ],
  };

  const observations: AiCallObservation[] = [];
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "ok" }] }) },
  ]);
  try {
    await postJson("https://api.anthropic.com/v1/messages", reqBody, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }

  const obs = observations[0]!;
  // observer sees placeholder, not the raw bytes
  assert.ok(obs.request.includes("[image omitted: image/png,"), "redacted placeholder must appear in observation");
  assert.ok(!obs.request.includes(BIG), "raw image data must NOT appear in observation");
  // surrounding text is preserved
  assert.ok(obs.request.includes("read this"), "surrounding text must survive redaction");
  // actual wire body is untouched
  const wireBody = JSON.parse(calls[0]!.init.body as string) as {
    messages: Array<{ content: Array<{ source?: { data: string } }> }>;
  };
  assert.equal(
    wireBody.messages[0]!.content[1]!.source!.data,
    BIG,
    "wire body must contain the full image data",
  );
});

test("redaction: OpenAI-compatible data-URI image bytes are omitted from observer but sent on the wire", async () => {
  const BIG = "A".repeat(4000);
  const reqBody = {
    model: "m",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "read this" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${BIG}` } },
        ],
      },
    ],
  };

  const observations: AiCallObservation[] = [];
  const { restore, calls } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) },
  ]);
  try {
    await postJson("https://openrouter.ai/api/v1/chat/completions", reqBody, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }

  const obs = observations[0]!;
  assert.ok(obs.request.includes("[image omitted: image/png,"), "redacted placeholder must appear in observation");
  assert.ok(!obs.request.includes(BIG), "raw image data must NOT appear in observation");
  assert.ok(obs.request.includes("read this"), "surrounding text must survive redaction");
  // actual wire body is untouched
  const wireBody = JSON.parse(calls[0]!.init.body as string) as {
    messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
  };
  assert.equal(
    wireBody.messages[0]!.content[1]!.image_url!.url,
    `data:image/png;base64,${BIG}`,
    "wire body must contain the full data URI",
  );
});

test("redaction: non-data image_url is left as-is in the observation", async () => {
  const reqBody = {
    model: "m",
    messages: [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "https://example.com/x.png" } }],
      },
    ],
  };

  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) },
  ]);
  try {
    await postJson("https://example.com", reqBody, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }

  const obs = observations[0]!;
  assert.ok(obs.request.includes("https://example.com/x.png"), "non-data URL must remain unchanged in observation");
});

test("redaction: a Date in the body still serializes via toJSON, not as {}", async () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: JSON.stringify({ ok: true }) }]);
  try {
    await postJson("https://example.com", { at }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(
    observations[0]!.request.includes("2026-01-01T00:00:00.000Z"),
    "an entries-rebuild must not discard toJSON",
  );
});

test("redaction: an image block produced by toJSON is still redacted", async () => {
  // A custom prototype must not be a way to smuggle image bytes into the audit
  // log: the body is serialized before redaction, so toJSON output is redacted too.
  const BIG = "A".repeat(4000);
  class Smuggler {
    toJSON() {
      return { type: "image", source: { type: "base64", media_type: "image/png", data: BIG } };
    }
  }
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: JSON.stringify({ ok: true }) }]);
  try {
    await postJson("https://example.com", { messages: [{ role: "user", content: [new Smuggler()] }] }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  const obs = observations[0]!;
  assert.ok(!obs.request.includes(BIG), "toJSON must not smuggle raw image bytes into the observation");
  assert.ok(obs.request.includes("[image omitted: image/png,"), "the smuggled block must be redacted");
});

test("postJson: an unserializable body degrades to AiUnavailableError and still logs a placeholder", async () => {
  // Both toJSON and toString throw. An unserializable body can never reach the
  // provider, so the call must fail — but it must fail as AiUnavailableError,
  // which callers degrade on, rather than letting a raw error escape from the
  // logging path. The audit log must still record the attempt.
  const hostile = {
    toJSON() {
      throw new Error("nope");
    },
    toString() {
      throw new Error("boom");
    },
  };
  const observations: AiCallObservation[] = [];
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ ok: true }) }]);
  try {
    await assert.rejects(
      () =>
        postJson("https://example.com", hostile, {
          observe: (obs) => {
            observations.push(obs);
          },
          retries: 0,
        }),
      AiUnavailableError,
    );
  } finally {
    restore();
  }
  assert.equal(observations.length, 1, "the attempt must still be recorded");
  assert.equal(observations[0]!.request, "[unserializable request body]");
  assert.equal(observations[0]!.ok, false);
  assert.equal(calls.length, 0, "an unserializable body must never reach the provider");
});

test("assertImagesValid: rejects malformed base64 that decodes to nothing", () => {
  // "A" and "A=" pass a permissive character-class regex but decode to 0 bytes.
  for (const data of ["A", "A=", "AAAA="]) {
    assert.throws(
      () => assertImagesValid([{ role: "user", content: [{ type: "image", mediaType: "image/png", data }] }]),
      (err: unknown) => {
        assert.ok(err instanceof AiImageRejectedError, `expected AiImageRejectedError for ${JSON.stringify(data)}`);
        assert.match(err.message, /not valid base64/);
        return true;
      },
    );
  }
});

test("assertImagesValid: a non-string data field raises the typed error, not a TypeError", () => {
  // Simulates an unvalidated value arriving at runtime, which is what this guard exists for.
  assert.throws(
    () =>
      assertImagesValid([
        { role: "user", content: [{ type: "image", mediaType: "image/png", data: 123 as unknown as string }] },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /must be a base64 string/);
      return true;
    },
  );
});

test("redaction: an image echoed in a provider ERROR reply is redacted in the observation", async () => {
  // A provider that echoes the submitted body does so in an error reply, so the
  // error report path is the one that matters here.
  const BIG = "A".repeat(4000);
  const echoed = `{"error":{"message":"bad image","echo":"data:image/png;base64,${BIG}"}}`;
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 400, body: echoed }]);
  try {
    await assert.rejects(
      () =>
        postJson("https://example.com", { hello: "world" }, {
          observe: (obs) => {
            observations.push(obs);
          },
          retries: 0,
        }),
      AiUnavailableError,
    );
  } finally {
    restore();
  }
  assert.equal(observations.length, 1);
  const obs = observations[0]!;
  assert.equal(obs.ok, false);
  assert.ok(!obs.response.includes(BIG), "echoed image bytes must not reach the observation");
  assert.ok(obs.response.includes("[image omitted: image/png,"), "the echoed image must be redacted");
  assert.ok(obs.response.includes("bad image"), "the rest of the response must be preserved verbatim");
});

test("redaction: a JSON-escaped data URI is redacted, not cut short", async () => {
  // Some providers escape `/` in JSON strings (PHP's json_encode does by
  // default). A regex stopping at the backslash would leave image bytes behind.
  const BIG = "A".repeat(2000);
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([
    { status: 200, body: `{"echo":"data:image\\/png;base64,${BIG}\\/${BIG}"}` },
  ]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "no image bytes may survive, escaped or not");
  assert.ok(response.includes("[image omitted: image/png,"), "the escaped data URI must be redacted");
});

test("redaction: a non-image data URI in a response is preserved verbatim", async () => {
  // response_raw is the provider's raw reply; only image payloads are redacted.
  const payload = "data:text/plain;base64,AAAABBBB";
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: `{"note":"${payload}"}` }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(observations[0]!.response.includes(payload), "a non-image data URI must not be altered");
});

test("redaction: a multi-megabyte echoed image does not lose the observation to a RangeError", async () => {
  // redactResponseImages runs inside report()'s try/catch, so a RangeError from a
  // backtracking regex would be swallowed and the audit record silently lost.
  const BIG = "A".repeat(4 * 1024 * 1024);
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: `{"echo":"data:image/png;base64,${BIG}"}` }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.equal(observations.length, 1, "the observation must survive a huge response");
  assert.ok(!observations[0]!.response.includes(BIG), "the huge payload must be redacted");
});

test("assertImagesValid: an unknown block type is rejected, not passed through as an image", () => {
  // The providers serialize every non-text block AS an image, so an unknown type
  // arriving at runtime must be rejected rather than sent unvalidated.
  const rogue = { type: "not-image", mediaType: "image/tiff", data: "A".repeat(64) } as unknown as ContentBlock;
  assert.throws(
    () => assertImagesValid([{ role: "user", content: [rogue] }]),
    (err: unknown) => {
      assert.ok(err instanceof AiImageRejectedError);
      assert.match(err.message, /Unsupported content block type "not-image"/);
      return true;
    },
  );
});

test("redaction: a media type merely beginning with 'image' is preserved verbatim", async () => {
  const payload = "data:imagefoo/png;base64,QUJDRA==";
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: `{"note":"${payload}"}` }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(observations[0]!.response.includes(payload), "only real image media types may be redacted");
});

test("redaction: JSON-escaped URI delimiters do not smuggle an image past the redactor", async () => {
  // `;` is `;` and `,` is `,`. A matcher requiring the literal `;base64,`
  // passes such a payload straight through into ai_events.response_raw.
  const BIG = "A".repeat(4000);
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([
    { status: 200, body: `{"echo":"data\\u003aimage\\u002fpng\\u003bbase64\\u002c${BIG}"}` },
  ]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "escaped delimiters must not smuggle image bytes through");
  assert.ok(response.includes("[image omitted: image/png,"), "the escaped data URI must be redacted");
});

test("redaction: an Anthropic-shaped image echoed in an error reply is redacted", async () => {
  // Anthropic carries bare base64 at source.data, with no data: URI. A provider or
  // relay echoing that body would otherwise log the whole payload.
  const BIG = "A".repeat(4000);
  const echoed = JSON.stringify({
    error: {
      message: "bad image",
      echo: {
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: BIG } },
            ],
          },
        ],
      },
    },
  });
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 400, body: echoed }]);
  try {
    await assert.rejects(
      () =>
        postJson("https://example.com", { hello: "world" }, {
          observe: (obs) => {
            observations.push(obs);
          },
          retries: 0,
        }),
      AiUnavailableError,
    );
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "bare Anthropic image bytes must not reach the observation");
  assert.ok(response.includes("[image omitted: image/png,"), "the echoed block must be redacted");
  assert.ok(response.includes("bad image"), "the rest of the reply must survive");
});

test("redaction: a unicode-escaped base64 marker cannot smuggle an image through", async () => {
  // `base64` is a legal JSON spelling of `base64`. No raw-text scan can
  // catch that, which is why the JSON is parsed before the string pass runs.
  const BIG = "A".repeat(2000);
  const escapedMarker = "base" + "\\u0036" + "\\u0034";
  const body = `{"echo":"data:image/png;${escapedMarker},${BIG}"}`;
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "an escaped marker must not smuggle image bytes through");
  assert.ok(response.includes("[image omitted: image/png,"), "the payload must be redacted");
});

test("redaction: an uppercase BASE64 marker or media type is still redacted", async () => {
  // Media types and the base64 token are case-insensitive per RFC 2045, so both
  // of these are standards-valid and both must be redacted.
  const BIG = "A".repeat(2000);
  for (const payload of [`data:image/png;BASE64,${BIG}`, `data:IMAGE/PNG;base64,${BIG}`]) {
    const observations: AiCallObservation[] = [];
    const { restore } = stubFetch([{ status: 200, body: JSON.stringify({ echo: payload }) }]);
    try {
      await postJson("https://example.com", { hello: "world" }, {
        observe: (obs) => {
          observations.push(obs);
        },
      });
    } finally {
      restore();
    }
    const response = observations[0]!.response;
    assert.ok(!response.includes(BIG), `case variant must not leak: ${payload.slice(0, 24)}`);
    assert.ok(
      response.includes("[image omitted: image/png,"),
      `case variant must be redacted and canonicalised: ${payload.slice(0, 24)}`,
    );
  }
});

test("redaction: a deeply nested reply carrying an Anthropic image block fails closed", async () => {
  // The structural walk raises RangeError past roughly 5,000 levels, and the text
  // fallback cannot see bare base64 at source.data — so the body must be dropped
  // rather than logged raw.
  const BIG = "A".repeat(2000);
  let nested = "null";
  for (let i = 0; i < 6000; i += 1) nested = `[${nested}]`;
  const body = `{"deep":${nested},"echo":{"type":"image","source":{"type":"base64","media_type":"image/png","data":"${BIG}"}}}`;
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.equal(observations.length, 1, "the observation must still be recorded");
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "a bare Anthropic payload must not leak when the walk cannot run");
  assert.equal(response, "[response omitted: image payload could not be redacted]");
});

test("redaction: a deeply nested reply fails closed even when the base64 marker is escaped", async () => {
  // `"base64"` is valid JSON for `"base64"`. A raw-text hint looking for
  // the literal marker misses it, which is why the fail-closed branch tests nothing
  // about the content and simply triggers on any walk failure.
  const BIG = "A".repeat(2000);
  const escapedToken = '"base' + "\\u0036" + "\\u0034" + '"';
  let nested = "null";
  for (let i = 0; i < 6000; i += 1) nested = `[${nested}]`;
  const body =
    `{"deep":${nested},"echo":{"type":"image","source":` +
    `{"type":${escapedToken},"media_type":"image/png","data":"${BIG}"}}}`;
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.equal(observations.length, 1, "the observation must still be recorded");
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "an escaped marker must not defeat the fail-closed branch");
  assert.equal(response, "[response omitted: image payload could not be redacted]");
});

test("redaction: a non-JSON reply still has its data URIs scanned", async () => {
  // Plain-text upstream errors are not JSON, so the raw-text fallback must remain.
  const BIG = "A".repeat(2000);
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([
    { status: 200, body: `upstream failure: data:image/png;base64,${BIG}` },
  ]);
  try {
    await assert.rejects(
      () =>
        postJson("https://example.com", { hello: "world" }, {
          observe: (obs) => {
            observations.push(obs);
          },
          retries: 0,
        }),
      AiUnavailableError,
    );
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "the fallback text scan must still redact");
  assert.ok(response.includes("[image omitted: image/png,"), "the payload must be redacted");
  assert.ok(response.includes("upstream failure"), "surrounding text must survive");
});

test("redaction: a second image in a sibling property of a redacted block is also redacted", async () => {
  // redactImages must walk a matched node's other keys. Returning early after
  // redacting `source` would copy `nested` verbatim.
  const BIG = "A".repeat(3000);
  const echoed = JSON.stringify({
    echo: {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AAAA" },
      nested: { type: "image", source: { type: "base64", media_type: "image/png", data: BIG } },
    },
  });
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: echoed }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(!observations[0]!.response.includes(BIG), "a nested sibling image must not survive");
});

test("redaction: a nested sibling image is also kept out of the REQUEST log", async () => {
  // stringifyBody uses the same redactImages, so the same shape must not leak into
  // ai_events.request_context either — while the wire body keeps the real bytes.
  const BIG = "A".repeat(3000);
  const body = {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAAA" },
            nested: { type: "image", source: { type: "base64", media_type: "image/png", data: BIG } },
          },
        ],
      },
    ],
  };
  const observations: AiCallObservation[] = [];
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ ok: true }) }]);
  try {
    await postJson("https://example.com", body, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(!observations[0]!.request.includes(BIG), "a nested sibling image must not reach request_context");
  assert.ok(
    (calls[0]!.init.body as string).includes(BIG),
    "the wire body must still carry the real bytes",
  );
});

test("redaction: an OpenRouter keep-alive-padded reply is still parsed and redacted", async () => {
  // postJson accepts padded bodies via extractJson, so the redactor must too —
  // otherwise it falls back to a text scan that an escaped marker defeats.
  const BIG = "A".repeat(2000);
  const escapedMarker = "base" + "\\u0036" + "\\u0034";
  const padded = `: OPENROUTER PROCESSING\n\n{"echo":"data:image/png;${escapedMarker},${BIG}"}`;
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: padded }]);
  try {
    await postJson("https://example.com", { hello: "world" }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  const response = observations[0]!.response;
  assert.ok(!response.includes(BIG), "a padded reply must not smuggle image bytes through");
  assert.ok(response.includes("[image omitted: image/png,"), "the payload must be redacted");
});

test("audit: a request carrying an image never persists the raw response", async () => {
  // The exact shape that defeated every text-based redaction: the provider echoes
  // our request back as a JSON *string*, so no structural pass can see into it.
  const image = "SECRETIMAGE".repeat(400);
  const embedded = JSON.stringify({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: image },
  });
  const echoed = JSON.stringify({ error: { echoed_request: embedded } });
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 400, body: echoed }]);
  try {
    await assert.rejects(
      () =>
        postJson(
          "https://example.com",
          {
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
                ],
              },
            ],
          },
          {
            observe: (obs) => {
              observations.push(obs);
            },
            retries: 0,
          },
        ),
      AiUnavailableError,
    );
  } finally {
    restore();
  }
  const obs = observations[0]!;
  assert.ok(!obs.response.includes(image), "an echoed image must never reach response_raw");
  assert.match(obs.response, /^\[response omitted: request contained an image \(\d+ chars\)\]$/);
  assert.ok(!obs.request.includes(image), "the request log must still be redacted too");
});

test("audit: a request with no image keeps its full response", async () => {
  // The suppression must be scoped to image-bearing calls, or every AI event loses
  // its response body and the log becomes useless.
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: '{"choices":[{"message":{"content":"hello there"}}]}' }]);
  try {
    await postJson("https://example.com", { messages: [{ role: "user", content: "hi" }] }, {
      observe: (obs) => {
        observations.push(obs);
      },
    });
  } finally {
    restore();
  }
  assert.ok(observations[0]!.response.includes("hello there"), "a text-only call keeps its reply");
  assert.ok(!observations[0]!.response.startsWith("[response omitted"), "must not be suppressed");
});

test("audit: an openai-compat image request also suppresses the response", async () => {
  // The flag must be set by the image_url shape too, not only Anthropic's.
  const image = "SECRETIMAGE".repeat(400);
  const observations: AiCallObservation[] = [];
  const { restore } = stubFetch([{ status: 200, body: JSON.stringify({ echo: image }) }]);
  try {
    await postJson(
      "https://example.com",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${image}` } }],
          },
        ],
      },
      {
        observe: (obs) => {
          observations.push(obs);
        },
      },
    );
  } finally {
    restore();
  }
  const obs = observations[0]!;
  assert.ok(!obs.response.includes(image), "the echoed payload must not reach response_raw");
  assert.match(obs.response, /^\[response omitted: request contained an image \(\d+ chars\)\]$/);
});

test("audit: an uppercase DATA: URI in a request is redacted and still suppresses the response", async () => {
  // Data-URI schemes are case-insensitive. A `DATA:` variant must not skip
  // redaction of request_context nor leave the response unsuppressed.
  const image = "SECRETIMAGE".repeat(400);
  const observations: AiCallObservation[] = [];
  const { restore, calls } = stubFetch([{ status: 200, body: JSON.stringify({ echo: image }) }]);
  try {
    await postJson(
      "https://example.com",
      {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: `DATA:image/png;base64,${image}` } }],
          },
        ],
      },
      {
        observe: (obs) => {
          observations.push(obs);
        },
      },
    );
  } finally {
    restore();
  }
  const obs = observations[0]!;
  assert.ok(!obs.request.includes(image), "an uppercase DATA: URI must still be redacted in the request log");
  assert.ok(obs.request.includes("[image omitted: image/png,"), "and the media type canonicalised");
  assert.match(obs.response, /^\[response omitted: request contained an image \(\d+ chars\)\]$/);
  assert.ok((calls[0]!.init.body as string).includes(image), "the wire body must still carry the real bytes");
});
