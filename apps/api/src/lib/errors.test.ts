import assert from "node:assert/strict";
import test from "node:test";
import { pgError } from "./errors.ts";

// ---------- pgError ----------

test("pgError: a bare pg-style error returns its code and constraint", () => {
  assert.deepEqual(pgError({ code: "23505", constraint: "some_idx" }), {
    code: "23505",
    constraint: "some_idx",
  });
});

test("pgError: a Drizzle-wrapped error unwraps via .cause", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "some_idx" },
  });
  assert.deepEqual(pgError(wrapped), { code: "23505", constraint: "some_idx" });
});

test("pgError: a doubly-wrapped error still unwraps", () => {
  const inner = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "some_idx" },
  });
  const outer = Object.assign(new Error("outer"), { cause: inner });
  assert.deepEqual(pgError(outer), { code: "23505", constraint: "some_idx" });
});

test("pgError: a code without a constraint leaves constraint undefined", () => {
  assert.deepEqual(pgError({ code: "23503" }), { code: "23503", constraint: undefined });
});

test("pgError: null, undefined, a plain string, and a plain Error all return null", () => {
  assert.equal(pgError(null), null);
  assert.equal(pgError(undefined), null);
  assert.equal(pgError("boom"), null);
  assert.equal(pgError(new Error("boom")), null);
});

test("pgError: a cause chain that never yields a string code returns null", () => {
  const outer = Object.assign(new Error("outer"), { cause: { notCode: 1 } });
  assert.equal(pgError(outer), null);
});

test("pgError: a self-referential cause returns null and does not hang (depth cap)", () => {
  const a: { cause?: unknown } = {};
  a.cause = a;
  assert.equal(pgError(a), null);
});

test("pgError: a Node-style error code is not mistaken for a SQLSTATE", () => {
  assert.equal(pgError({ code: "ENOENT" }), null);
  assert.equal(pgError({ code: "ERR_INVALID_ARG_TYPE" }), null);
});

test("pgError: a near-miss code (wrong length or lowercase) is not matched", () => {
  assert.equal(pgError({ code: "2350" }), null);
  assert.equal(pgError({ code: "23505x" }), null);
  assert.equal(pgError({ code: "abcde" }), null);
});

test("pgError: a wrapper carrying its own Node code does not hide the pg error below it", () => {
  // The whole point of skipping rather than returning: a non-SQLSTATE `code` on
  // an outer wrapper must not halt the walk.
  const wrapped = Object.assign(new Error("stream destroyed"), {
    code: "ERR_STREAM_DESTROYED",
    cause: { code: "23505", constraint: "some_idx" },
  });
  assert.deepEqual(pgError(wrapped), { code: "23505", constraint: "some_idx" });
});
