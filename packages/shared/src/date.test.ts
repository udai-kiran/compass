import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDisplayDate, monthKey, todayInIST, toISODate } from "./date.ts";

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

test("formatDisplayDate converts YYYY-MM-DD to DD-Mon-YYYY", () => {
  assert.equal(formatDisplayDate("2026-12-31"), "31-Dec-2026");
});

test("formatDisplayDate preserves zero-padded day", () => {
  assert.equal(formatDisplayDate("2026-01-05"), "05-Jan-2026");
});

test("formatDisplayDate handles all 12 months correctly", () => {
  const expected = [
    "15-Jan-2026",
    "15-Feb-2026",
    "15-Mar-2026",
    "15-Apr-2026",
    "15-May-2026",
    "15-Jun-2026",
    "15-Jul-2026",
    "15-Aug-2026",
    "15-Sep-2026",
    "15-Oct-2026",
    "15-Nov-2026",
    "15-Dec-2026",
  ];
  for (let month = 1; month <= 12; month++) {
    const isoDate = `2026-${month.toString().padStart(2, "0")}-15`;
    assert.equal(formatDisplayDate(isoDate), expected[month - 1]);
  }
});

test("formatDisplayDate returns original string unchanged for malformed input", () => {
  assert.equal(formatDisplayDate(""), "");
  assert.equal(formatDisplayDate("2026-13-01"), "2026-13-01");
  assert.equal(formatDisplayDate("2026-02-30"), "2026-02-30");
  assert.equal(formatDisplayDate("not-a-date"), "not-a-date");
  assert.equal(formatDisplayDate("2026-1-5"), "2026-1-5");
});

test("formatDisplayDate handles leap year Feb 29 correctly", () => {
  // Valid leap year (2024 is divisible by 4 and not a century exception)
  assert.equal(formatDisplayDate("2024-02-29"), "29-Feb-2024");
});

test("formatDisplayDate rejects invalid Feb 29 in non-leap year", () => {
  // 2026 is not a leap year
  assert.equal(formatDisplayDate("2026-02-29"), "2026-02-29");
});

test("formatDisplayDate rejects Feb 29 in century non-leap year", () => {
  // 1900 is divisible by 100 but not 400, so not a leap year
  assert.equal(formatDisplayDate("1900-02-29"), "1900-02-29");
});

test("formatDisplayDate accepts Feb 29 in century leap year", () => {
  // 2000 is divisible by 400, so it is a leap year
  assert.equal(formatDisplayDate("2000-02-29"), "29-Feb-2000");
});

test("formatDisplayDate rejects April 31 (30-day month)", () => {
  // April has only 30 days
  assert.equal(formatDisplayDate("2026-04-31"), "2026-04-31");
});

test("formatDisplayDate rejects month zero", () => {
  assert.equal(formatDisplayDate("2026-00-15"), "2026-00-15");
});

test("formatDisplayDate rejects day zero", () => {
  assert.equal(formatDisplayDate("2026-01-00"), "2026-01-00");
});
