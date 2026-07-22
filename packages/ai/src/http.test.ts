import { test } from "node:test";
import assert from "node:assert/strict";
import { postJson } from "./http.ts";
import type { AiCallObservation } from "./types.ts";

/** Replace global fetch with a queue of canned responses; returns a restorer. */
function stubFetch(responses: Array<{ status: number; body: string }>): () => void {
  const orig = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.body,
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

test("postJson emits exactly one ok observation for a valid response", async () => {
  const restore = stubFetch([{ status: 200, body: '{"x":1}' }]);
  const obs: AiCallObservation[] = [];
  try {
    const out = await postJson("http://x", { a: 1 }, { observe: (o) => void obs.push(o), retries: 0 });
    assert.deepEqual(out, { x: 1 });
  } finally {
    restore();
  }
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.ok, true);
});

test("postJson emits no premature ok for an unparseable 200 — one error across retries", async () => {
  // Both attempts return HTTP 200 with a non-JSON body. The old code reported an
  // ok event per attempt (before JSON.parse); the fix parses first, so the only
  // observation is a single final error carrying the raw body.
  const restore = stubFetch([
    { status: 200, body: "not json" },
    { status: 200, body: "still not json" },
  ]);
  const obs: AiCallObservation[] = [];
  try {
    await assert.rejects(() =>
      postJson("http://x", { a: 1 }, { observe: (o) => void obs.push(o), retries: 1 }),
    );
  } finally {
    restore();
  }
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.ok, false);
  assert.match(obs[0]!.response, /still not json/);
});

test("postJson emits one error observation for a permanent 4xx, keeping the raw body", async () => {
  const restore = stubFetch([{ status: 401, body: '{"error":"invalid api key"}' }]);
  const obs: AiCallObservation[] = [];
  try {
    await assert.rejects(() =>
      postJson("http://x", { a: 1 }, { observe: (o) => void obs.push(o), retries: 2 }),
    );
  } finally {
    restore();
  }
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.ok, false);
  // The provider's error body must reach the event log, even though the thrown
  // error message stays generic for the client.
  assert.match(obs[0]!.response, /invalid api key/);
});

test("postJson does not wait on a slow observer — logging is off the model-call path", async () => {
  const restore = stubFetch([{ status: 200, body: '{"x":1}' }]);
  let observerDone = false;
  const slowObserve = async () => {
    await new Promise((r) => setTimeout(r, 200));
    observerDone = true;
  };
  try {
    const out = await postJson("http://x", { a: 1 }, { observe: slowObserve, retries: 0 });
    assert.deepEqual(out, { x: 1 });
    // The call returned before the 200ms event-log write finished — a slow or
    // stuck ai_events insert can never delay (or break) a model request.
    assert.equal(observerDone, false);
  } finally {
    restore();
  }
});

test("postJson captures the body of an exhausted 5xx failure", async () => {
  const restore = stubFetch([{ status: 503, body: "upstream overloaded" }]);
  const obs: AiCallObservation[] = [];
  try {
    await assert.rejects(() =>
      postJson("http://x", { a: 1 }, { observe: (o) => void obs.push(o), retries: 0 }),
    );
  } finally {
    restore();
  }
  assert.equal(obs.length, 1);
  assert.equal(obs[0]!.ok, false);
  assert.match(obs[0]!.response, /upstream overloaded/);
});
