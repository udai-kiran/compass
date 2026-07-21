import { test } from "node:test";
import assert from "node:assert/strict";
import { _demoDates } from "./demo.ts";

const { monthDay, monthKey, rupeesToPaise } = _demoDates;

test("rupeesToPaise converts and rounds to integer paise", () => {
  assert.equal(rupeesToPaise(150000), 15000000);
  assert.equal(rupeesToPaise(-4200000), -420000000);
  assert.equal(rupeesToPaise(649), 64900);
  assert.equal(rupeesToPaise(33.15), 3315);
});

test("monthDay produces a valid YYYY-MM-DD for the requested day", () => {
  for (const [monthsAgo, day] of [[0, 1], [6, 25], [30, 12], [-9, 1]] as const) {
    const s = monthDay(monthsAgo, day);
    assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(s);
    assert.equal(Number.isNaN(parsed.getTime()), false, `${s} should parse`);
    assert.equal(s.slice(8, 10), String(day).padStart(2, "0"));
  }
});

test("monthDay steps whole months back without day overflow", () => {
  // Anchoring to day 1 before shifting the month avoids e.g. Mar-31 → Mar-03.
  const now = new Date();
  const back3 = new Date(monthDay(3, 15));
  const expected = new Date(now.getFullYear(), now.getMonth() - 3, 15);
  assert.equal(back3.getFullYear(), expected.getFullYear());
  assert.equal(back3.getMonth(), expected.getMonth());
});

test("monthKey is the YYYY-MM prefix and negative args go to the future", () => {
  assert.equal(monthKey(0), monthDay(0, 1).slice(0, 7));
  assert.match(monthKey(6), /^\d{4}-\d{2}$/);
  // A negative monthsAgo is a future month (used for renewal/target dates).
  assert.ok(monthKey(-3) > monthKey(0));
});
