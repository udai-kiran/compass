import { test } from "node:test";
import assert from "node:assert/strict";
import { last4Of } from "./accounts.ts";

test("last 4 is taken from the tail of the full number", () => {
  // Indian account numbers vary from 9 to 18 digits, so the tail is the only
  // stable place to take it from.
  assert.equal(last4Of("50100123453510"), "3510");
  assert.equal(last4Of("123456789"), "6789");
  assert.equal(last4Of("123456789012345678"), "5678");
});

test("last 4 of a leading-zero tail keeps the zeros", () => {
  // Going via Number() would turn "0042" into 42 and show •••• 42.
  assert.equal(last4Of("50100120042"), "0042");
  assert.equal(last4Of("5010012000"), "2000");
});

test("last 4 needs four digits to exist", () => {
  assert.equal(last4Of("1234"), "1234");
  assert.equal(last4Of("123"), null);
  assert.equal(last4Of(""), null);
});
