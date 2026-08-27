import { test } from "node:test";
import assert from "node:assert/strict";
import { isExpandedByDefault, isTreeable, tryParseJson } from "./json-tree.ts";

test("tryParseJson: a valid object parses to its value", () => {
  const r = tryParseJson('{"a":1}');
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { a: 1 });
});

test("tryParseJson: a valid array parses to its value", () => {
  const r = tryParseJson("[1,2]");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, [1, 2]);
});

test("tryParseJson: a valid bare primitive parses (ok true, value 42)", () => {
  const r = tryParseJson("42");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 42);
});

test("tryParseJson: an empty string is not parseable", () => {
  assert.deepEqual(tryParseJson(""), { ok: false });
});

test("tryParseJson: invalid text is not parseable", () => {
  assert.deepEqual(tryParseJson("not json"), { ok: false });
});

test("tryParseJson: malformed JSON with a trailing comma is not parseable", () => {
  assert.deepEqual(tryParseJson('{"a":1,}'), { ok: false });
});

test("isTreeable: true for objects and arrays", () => {
  assert.equal(isTreeable({}), true);
  assert.equal(isTreeable([]), true);
});

test("isTreeable: false for null, primitives, and booleans", () => {
  assert.equal(isTreeable(null), false);
  assert.equal(isTreeable(42), false);
  assert.equal(isTreeable("x"), false);
  assert.equal(isTreeable(true), false);
});

test("isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded", () => {
  assert.equal(isExpandedByDefault(0), true);
  assert.equal(isExpandedByDefault(1), true);
  assert.equal(isExpandedByDefault(2), true);
});

test("isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed", () => {
  assert.equal(isExpandedByDefault(3), false);
  assert.equal(isExpandedByDefault(4), false);
});
