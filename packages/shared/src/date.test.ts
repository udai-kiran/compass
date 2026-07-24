import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAge, ddmmyyyyToISO, formatDisplayDate, isoToDDMMYYYY, monthKey, todayInIST, toISODate } from "./date.ts";

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

// isoToDDMMYYYY tests
test("isoToDDMMYYYY converts YYYY-MM-DD to DD-MM-YYYY", () => {
  assert.equal(isoToDDMMYYYY("2026-07-24"), "24-07-2026");
});

test("isoToDDMMYYYY preserves zero-padded day and month", () => {
  assert.equal(isoToDDMMYYYY("2026-01-05"), "05-01-2026");
});

test("isoToDDMMYYYY handles all 12 months correctly", () => {
  const expected = [
    "15-01-2026",
    "15-02-2026",
    "15-03-2026",
    "15-04-2026",
    "15-05-2026",
    "15-06-2026",
    "15-07-2026",
    "15-08-2026",
    "15-09-2026",
    "15-10-2026",
    "15-11-2026",
    "15-12-2026",
  ];
  for (let month = 1; month <= 12; month++) {
    const isoDate = `2026-${month.toString().padStart(2, "0")}-15`;
    assert.equal(isoToDDMMYYYY(isoDate), expected[month - 1]);
  }
});

test("isoToDDMMYYYY passthrough on malformed input", () => {
  assert.equal(isoToDDMMYYYY(""), "");
  assert.equal(isoToDDMMYYYY("not-a-date"), "not-a-date");
  assert.equal(isoToDDMMYYYY("2026-1-5"), "2026-1-5");
});

test("isoToDDMMYYYY passthrough on invalid month", () => {
  assert.equal(isoToDDMMYYYY("2026-13-01"), "2026-13-01");
  assert.equal(isoToDDMMYYYY("2026-00-15"), "2026-00-15");
});

test("isoToDDMMYYYY passthrough on invalid day", () => {
  assert.equal(isoToDDMMYYYY("2026-01-00"), "2026-01-00");
});

test("isoToDDMMYYYY handles leap year Feb 29 correctly", () => {
  assert.equal(isoToDDMMYYYY("2024-02-29"), "29-02-2024");
});

test("isoToDDMMYYYY passthrough on invalid Feb 29 in non-leap year", () => {
  assert.equal(isoToDDMMYYYY("2026-02-29"), "2026-02-29");
});

test("isoToDDMMYYYY passthrough on April 31", () => {
  assert.equal(isoToDDMMYYYY("2026-04-31"), "2026-04-31");
});

// ddmmyyyyToISO tests
test("ddmmyyyyToISO parses DD-MM-YYYY to YYYY-MM-DD", () => {
  assert.equal(ddmmyyyyToISO("24-07-2026"), "2026-07-24");
});

test("ddmmyyyyToISO accepts slash separator", () => {
  assert.equal(ddmmyyyyToISO("24/07/2026"), "2026-07-24");
});

test("ddmmyyyyToISO accepts dot separator", () => {
  assert.equal(ddmmyyyyToISO("24.07.2026"), "2026-07-24");
});

test("ddmmyyyyToISO accepts single-digit day and month", () => {
  assert.equal(ddmmyyyyToISO("4-7-2026"), "2026-07-04");
  assert.equal(ddmmyyyyToISO("4/7/2026"), "2026-07-04");
});

test("ddmmyyyyToISO returns canonical zero-padded ISO", () => {
  assert.equal(ddmmyyyyToISO("1-1-2026"), "2026-01-01");
  assert.equal(ddmmyyyyToISO("9-12-2026"), "2026-12-09");
});

test("ddmmyyyyToISO validates leap year Feb 29", () => {
  assert.equal(ddmmyyyyToISO("29-02-2024"), "2024-02-29");
  assert.equal(ddmmyyyyToISO("29-02-2026"), null);
});

test("ddmmyyyyToISO rejects April 31", () => {
  assert.equal(ddmmyyyyToISO("31-04-2026"), null);
});

test("ddmmyyyyToISO rejects month zero", () => {
  assert.equal(ddmmyyyyToISO("15-00-2026"), null);
});

test("ddmmyyyyToISO rejects day zero", () => {
  assert.equal(ddmmyyyyToISO("00-07-2026"), null);
});

test("ddmmyyyyToISO rejects 2-digit year", () => {
  assert.equal(ddmmyyyyToISO("24-07-26"), null);
});

test("ddmmyyyyToISO returns null on empty input", () => {
  assert.equal(ddmmyyyyToISO(""), null);
  assert.equal(ddmmyyyyToISO("   "), null);
});

test("ddmmyyyyToISO returns null on malformed input", () => {
  assert.equal(ddmmyyyyToISO("not-a-date"), null);
  assert.equal(ddmmyyyyToISO("24/07"), null);
  assert.equal(ddmmyyyyToISO("24/07/2026/extra"), null);
});

test("ddmmyyyyToISO rejects sub-1000 four-digit year like 0999", () => {
  assert.equal(ddmmyyyyToISO("01-01-0999"), null);
  assert.equal(ddmmyyyyToISO("24-07-0100"), null);
  assert.equal(ddmmyyyyToISO("31-12-0500"), null);
});

test("ddmmyyyyToISO accepts valid 4-digit year >= 1000", () => {
  assert.equal(ddmmyyyyToISO("24-07-2026"), "2026-07-24");
  assert.equal(ddmmyyyyToISO("01-01-1000"), "1000-01-01");
  assert.equal(ddmmyyyyToISO("15-06-1999"), "1999-06-15");
});

test("ddmmyyyyToISO rejects mixed separators", () => {
  assert.equal(ddmmyyyyToISO("24-07/2026"), null);
  assert.equal(ddmmyyyyToISO("24/07.2026"), null);
  assert.equal(ddmmyyyyToISO("24.07-2026"), null);
});

test("ddmmyyyyToISO rejects overlong day field", () => {
  assert.equal(ddmmyyyyToISO("001-07-2026"), null);
  assert.equal(ddmmyyyyToISO("024-07-2026"), null);
});

test("ddmmyyyyToISO rejects overlong month field", () => {
  assert.equal(ddmmyyyyToISO("24-007-2026"), null);
  assert.equal(ddmmyyyyToISO("24-012-2026"), null);
});

test("ddmmyyyyToISO rejects overlong year field", () => {
  assert.equal(ddmmyyyyToISO("24-07-02026"), null);
  assert.equal(ddmmyyyyToISO("24-07-20260"), null);
});

test("ddmmyyyyToISO month-end round-trip sanity cases", () => {
  assert.equal(ddmmyyyyToISO("31-01-2026"), "2026-01-31");
  assert.equal(ddmmyyyyToISO("30-04-2026"), "2026-04-30");
  assert.equal(ddmmyyyyToISO("31-04-2026"), null); // April has only 30 days
  assert.equal(ddmmyyyyToISO("28-02-2026"), "2026-02-28");
  assert.equal(ddmmyyyyToISO("29-02-2026"), null); // 2026 not a leap year
  assert.equal(ddmmyyyyToISO("31-12-2026"), "2026-12-31");
});

// calculateAge tests
test("calculateAge returns correct age for past date of birth", () => {
  // Person born 2000-05-15, tested on 2026-07-24 IST
  const now = new Date("2026-07-24T06:00:00Z"); // IST 11:30
  const age = calculateAge("2000-05-15", now);
  assert.equal(age, 26);
});

test("calculateAge returns correct age when birthday not yet reached this year", () => {
  // Person born 2000-08-15, tested on 2026-07-24 (birthday is in August, hasn't happened yet)
  const now = new Date("2026-07-24T06:00:00Z");
  const age = calculateAge("2000-08-15", now);
  assert.equal(age, 25); // Still 25, will turn 26 in August
});

test("calculateAge returns correct age when birthday already passed this year", () => {
  // Person born 2000-01-15, tested on 2026-07-24 (birthday was in January)
  const now = new Date("2026-07-24T06:00:00Z");
  const age = calculateAge("2000-01-15", now);
  assert.equal(age, 26);
});

test("calculateAge returns null for null date of birth", () => {
  const age = calculateAge(null);
  assert.equal(age, null);
});

test("calculateAge returns null for future date of birth", () => {
  // Person born 2030-05-15, tested on 2026-07-24
  const now = new Date("2026-07-24T06:00:00Z");
  const age = calculateAge("2030-05-15", now);
  assert.equal(age, null);
});

test("calculateAge handles birthday on exact date", () => {
  // Person born 2000-07-24, tested on 2026-07-24 (today is their birthday)
  const now = new Date("2026-07-24T06:00:00Z");
  const age = calculateAge("2000-07-24", now);
  assert.equal(age, 26);
});

test("calculateAge handles edge case of birthday tomorrow", () => {
  // Person born 2000-07-25, tested on 2026-07-24 (birthday is tomorrow)
  const now = new Date("2026-07-24T06:00:00Z");
  const age = calculateAge("2000-07-25", now);
  assert.equal(age, 25); // Still 25, will turn 26 tomorrow
});
