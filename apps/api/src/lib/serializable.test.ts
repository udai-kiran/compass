import assert from "node:assert/strict";
import test from "node:test";
import { withSerializableRetry } from "./serializable.ts";

/** Shaped like the pg driver error `pgError` recognizes: a top-level `.code`. */
function serializationFailure(): Error {
  return Object.assign(new Error("could not serialize access due to concurrent update"), {
    code: "40001",
  });
}

/** Wrapped the way Drizzle (>=0.44) hangs the real pg error off `.cause`. */
function wrappedSerializationFailure(): Error {
  return Object.assign(new Error("Failed query"), { cause: serializationFailure() });
}

test("withSerializableRetry: a single 40001 retries once and returns the second attempt's result", async () => {
  let calls = 0;
  const result = await withSerializableRetry(async () => {
    calls += 1;
    if (calls === 1) throw serializationFailure();
    return "second-attempt-result";
  });
  assert.strictEqual(result, "second-attempt-result");
  assert.strictEqual(calls, 2);
});

test("withSerializableRetry: a Drizzle-wrapped 40001 (SQLSTATE on .cause) is still detected and retried", async () => {
  let calls = 0;
  const result = await withSerializableRetry(async () => {
    calls += 1;
    if (calls === 1) throw wrappedSerializationFailure();
    return "ok";
  });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 2);
});

test("withSerializableRetry: 40001 on both attempts surfaces the error — no third try", async () => {
  let calls = 0;
  await assert.rejects(
    withSerializableRetry(async () => {
      calls += 1;
      throw serializationFailure();
    }),
    (e: unknown) => e instanceof Error && (e as { code?: string }).code === "40001",
  );
  assert.strictEqual(calls, 2);
});

test("withSerializableRetry: a non-40001 error is rethrown without any retry", async () => {
  let calls = 0;
  await assert.rejects(
    withSerializableRetry(async () => {
      calls += 1;
      throw new Error("boom — unrelated failure");
    }),
    /boom/,
  );
  assert.strictEqual(calls, 1);
});

test("withSerializableRetry: success on the first attempt never calls fn a second time", async () => {
  let calls = 0;
  const result = await withSerializableRetry(async () => {
    calls += 1;
    return "first-try";
  });
  assert.strictEqual(result, "first-try");
  assert.strictEqual(calls, 1);
});
