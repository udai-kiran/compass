/**
 * error-logging.test.ts — Unit tests for sanitizeErrorForLog (task 13.4 / AC7).
 *
 * Key assertions:
 *   1. A DrizzleQueryError-shaped error (duck-typed by .query + .params) MUST NOT
 *      include any bound-parameter content (e.g. a fake PAN) anywhere in the
 *      sanitized output — even as a substring.
 *   2. A plain Error's message IS present in the sanitized output (no regression).
 *   3. Non-Drizzle 5xx errors (status codes, custom properties) still pass through.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeErrorForLog } from "./error-logging.ts";

describe("sanitizeErrorForLog — DrizzleQueryError-shaped errors", () => {
  /**
   * Construct an error shaped exactly like a real DrizzleQueryError so we can
   * test without importing from drizzle-orm (which would be a runtime dep, and the
   * exact class name and constructor behavior may change in future library versions).
   *
   * Real DrizzleQueryError (from node_modules/drizzle-orm/errors.js):
   *   constructor(query, params, cause) {
   *     super(`Failed query: ${query}\nparams: ${params}`);
   *     this.query = query;
   *     this.params = params;
   *     this.cause = cause;
   *   }
   */
  function makeDrizzleQueryError(pan: string): Record<string, unknown> {
    const query = `INSERT INTO income_events (payer_pan) VALUES ($1)`;
    const params = [pan];
    return {
      // name: not set (DrizzleQueryError does not call this.name = ... )
      // → inherits "Error" from Error.prototype.name
      name: "Error",
      message: `Failed query: ${query}\nparams: ${JSON.stringify(params)}`,
      stack: "Error: Failed query: ...\n  at Object.<anonymous>",
      query,
      params,
      cause: undefined,
    };
  }

  test("does NOT include the PAN anywhere in the sanitized output", () => {
    const fakePan = "ABCDE1234F";
    const err = makeDrizzleQueryError(fakePan);
    const result = sanitizeErrorForLog(err);

    // Serialize the whole sanitized object to catch the PAN in any field.
    const serialized = JSON.stringify(result);
    assert.ok(
      !serialized.includes(fakePan),
      `PAN "${fakePan}" must not appear anywhere in sanitized output, got: ${serialized}`,
    );
  });

  test("replaces .message with a static placeholder (does not preserve original)", () => {
    const err = makeDrizzleQueryError("ZZZZZ9999Z");
    const result = sanitizeErrorForLog(err);

    assert.ok(
      typeof result["message"] === "string",
      "sanitized result must still have a message field",
    );
    assert.ok(
      (result["message"] as string).includes("omitted"),
      `placeholder message must mention 'omitted', got: ${String(result["message"])}`,
    );
    assert.ok(
      !(result["message"] as string).includes("Failed query"),
      "placeholder message must not contain the original 'Failed query' prefix",
    );
  });

  test("still includes name and stack in the sanitized output", () => {
    const err = makeDrizzleQueryError("ABCDE1234F");
    const result = sanitizeErrorForLog(err);
    assert.ok("name" in result, "sanitized result must include name");
    assert.ok("stack" in result, "sanitized result must include stack");
  });

  test("omits .query and .params from the sanitized output", () => {
    const err = makeDrizzleQueryError("ABCDE1234F");
    const result = sanitizeErrorForLog(err);
    assert.ok(!("query" in result), "sanitized result must not include .query");
    assert.ok(!("params" in result), "sanitized result must not include .params");
  });

  test("preserves .cause from a DrizzleQueryError (pg driver error has no bound params)", () => {
    const pgCause = { code: "23505", detail: "duplicate key" };
    const err = { ...makeDrizzleQueryError("ABCDE1234F"), cause: pgCause };
    const result = sanitizeErrorForLog(err);
    assert.deepEqual(result["cause"], pgCause);
  });
});

describe("sanitizeErrorForLog — plain Error (non-Drizzle)", () => {
  test("preserves .message for a plain Error", () => {
    const err = new Error("boom — something went wrong");
    const result = sanitizeErrorForLog(err);
    assert.equal(result["message"], "boom — something went wrong");
  });

  test("preserves .name and .stack for a plain Error", () => {
    const err = new Error("test");
    const result = sanitizeErrorForLog(err);
    assert.equal(result["name"], "Error");
    assert.ok(typeof result["stack"] === "string");
  });

  test("preserves additional own properties on a custom error", () => {
    const err = Object.assign(new Error("custom"), {
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    const result = sanitizeErrorForLog(err);
    assert.equal(result["statusCode"], 503);
    assert.equal(result["code"], "SERVICE_UNAVAILABLE");
    assert.equal(result["message"], "custom");
  });
});

describe("sanitizeErrorForLog — edge cases", () => {
  test("handles a non-object (string)", () => {
    const result = sanitizeErrorForLog("some string error");
    assert.equal(result["value"], "some string error");
  });

  test("handles null", () => {
    const result = sanitizeErrorForLog(null);
    assert.equal(result["value"], "null");
  });

  test("an error with only .query (no .params) is NOT treated as DrizzleQueryError", () => {
    const err = { name: "SomeError", message: "secret data here", query: "SELECT 1" };
    const result = sanitizeErrorForLog(err);
    // Treated as a normal error — message is preserved.
    assert.equal(result["message"], "secret data here");
  });
});
