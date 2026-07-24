import { test } from "node:test";
import assert from "node:assert/strict";
import { monthKey, todayInIST, toISODate } from "./date.ts";

test("toISODate formats as YYYY-MM-DD", () => {
  assert.equal(toISODate(new Date("2026-01-05T10:00:00.000Z")), "2026-01-05");
});

test("monthKey formats as YYYY-MM", () => {
  assert.equal(monthKey(new Date("2026-01-05T10:00:00.000Z")), "2026-01");
});

test("todayInIST returns a YYYY-MM-DD string", () => {
  const today = todayInIST();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("todayInIST is ahead of UTC date late at night IST (past UTC midnight)", () => {
  // 23:30 IST = 18:00 UTC same day, so IST date can be a day ahead of the UTC
  // date computed from a plain `new Date().toISOString()` around UTC's evening.
  // We can verify the IST formatter is timezone-correct with an injected instant.
  const fixed = new Date("2026-01-05T19:00:00.000Z"); // UTC 19:00 -> IST 00:30 next day
  const istDate = todayInIST(fixed);
  assert.equal(istDate, "2026-01-06");
  assert.notEqual(istDate, toISODate(fixed));
});
