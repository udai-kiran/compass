import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateTransactionSchema, UpdateTransactionSchema, effectiveNecessity } from "./ledger.ts";

test("effectiveNecessity: transaction override 'essential' beats category default 'non_essential'", () => {
  assert.equal(effectiveNecessity("essential", "non_essential", "expense"), "essential");
});

test("effectiveNecessity: transaction override 'non_essential' beats category default 'essential'", () => {
  assert.equal(effectiveNecessity("non_essential", "essential", "expense"), "non_essential");
});

test("effectiveNecessity: no override falls back to the category default on an expense category", () => {
  assert.equal(effectiveNecessity(null, "essential", "expense"), "essential");
});

test("effectiveNecessity: no override and no category default is null", () => {
  assert.equal(effectiveNecessity(null, null, "expense"), null);
});

test("effectiveNecessity: no override on an income category ignores its default", () => {
  assert.equal(effectiveNecessity(null, "essential", "income"), null);
});

test("effectiveNecessity: an override still stands even on an income category", () => {
  assert.equal(effectiveNecessity("essential", null, "income"), "essential");
});

test("effectiveNecessity: no override, uncategorized (null category kind) is null", () => {
  assert.equal(effectiveNecessity(null, null, null), null);
});

test("CreateTransactionSchema defaults necessity to null when the client omits it", () => {
  const parsed = CreateTransactionSchema.parse({
    accountId: "00000000-0000-4000-8000-000000000001",
    date: "2026-07-01",
    amountPaise: -12345,
  });
  assert.equal(parsed.necessity, null);
});

test("UpdateTransactionSchema leaves necessity absent when the client omits it", () => {
  const parsed = UpdateTransactionSchema.parse({ merchant: "Test" });
  assert.equal("necessity" in parsed, false);
});

test("effectiveNecessity: a category default is ignored when the kind is unknown", () => {
  // Unreachable from the report SQL — a failed join nulls both category fields —
  // but the rule is "inherit only from an expense category", not "inherit unless
  // income", so an unidentifiable category must not classify the user's spend.
  assert.equal(effectiveNecessity(null, "essential", null), null);
});
