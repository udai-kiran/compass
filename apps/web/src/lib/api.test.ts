import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ApiError, apiGet, apiPut } from "./api.ts";

const Schema = z.object({ ok: z.boolean() });

/** Swap in a stub `fetch` for one test and restore the original afterwards. */
async function withFetch(
  stub: (input: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a request without a timeout is passed through untouched", async () => {
  let sawSignal: unknown = "unset";
  await withFetch(
    (_input, init) => {
      sawSignal = init?.signal;
      return Promise.resolve(jsonResponse({ ok: true }));
    },
    async () => {
      assert.deepEqual(await apiGet("/api/thing", Schema), { ok: true });
      assert.equal(sawSignal, undefined, "no AbortSignal is attached");
    },
  );
});

test("a timed-out request fails as a 408 ApiError instead of hanging", async () => {
  // A mutation whose promise never settles would leave react-query's `isPending`
  // true forever, disabling the form's Save button until a page reload.
  await withFetch(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    async () => {
      await assert.rejects(
        () => apiPut("/api/profile", Schema, { a: 1 }, { timeoutMs: 5 }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError, "callers see a normal ApiError");
          assert.equal(err.status, 408);
          assert.equal(err.message, "The request timed out. Please try again.");
          return true;
        },
      );
    },
  );
});

test("a request that beats its timeout resolves normally", async () => {
  await withFetch(
    () => Promise.resolve(jsonResponse({ ok: true })),
    async () => {
      assert.deepEqual(
        await apiPut("/api/profile", Schema, { a: 1 }, { timeoutMs: 5_000 }),
        { ok: true },
      );
    },
  );
});

test("a network error is not mislabelled as a timeout", async () => {
  await withFetch(
    () => Promise.reject(new TypeError("Failed to fetch")),
    async () => {
      await assert.rejects(
        () => apiPut("/api/profile", Schema, { a: 1 }, { timeoutMs: 5_000 }),
        (err: unknown) => {
          assert.ok(err instanceof TypeError, "the original error propagates");
          assert.equal(err.message, "Failed to fetch");
          return true;
        },
      );
    },
  );
});

test("an error response body's message is surfaced", async () => {
  await withFetch(
    () => Promise.resolve(jsonResponse({ message: "Nope" }, 400)),
    async () => {
      await assert.rejects(
        () => apiPut("/api/profile", Schema, { a: 1 }, { timeoutMs: 5_000 }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 400);
          assert.equal(err.message, "Nope");
          return true;
        },
      );
    },
  );
});
