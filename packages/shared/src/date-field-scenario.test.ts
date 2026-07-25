import { test } from "node:test";
import assert from "node:assert/strict";
import { ddmmyyyyToISO } from "./date.ts";

/**
 * Reproduction test for the "profile DOB not saved" bug.
 *
 * Root cause: DateField.handleBlur only calls onChange when the typed text
 * successfully parses (ddmmyyyyToISO) AND passes range validation (isInRange).
 * If either fails, onChange is NEVER called, the field reverts to the previous
 * value, and the parent state stays at "" — resulting in `{ dateOfBirth: null }`
 * being sent to the API.
 *
 * This test documents which inputs the parser (ddmmyyyyToISO) rejects (returns null)
 * vs accepts. For opted-in DateField instances (commitOnValidChange=true), invalid
 * input now reports invalidity via onValidityChange during typing, rather than
 * being silently dropped without feedback.
 */

test("ddmmyyyyToISO returns null for ISO format (user typing 1990-05-15 in a DD-MM-YYYY field)", () => {
  // ISO format is not recognized by the DD-MM-YYYY parser
  assert.equal(ddmmyyyyToISO("1990-05-15"), null);
  assert.equal(ddmmyyyyToISO("2026-07-24"), null);
});

test("ddmmyyyyToISO returns null for incomplete/partial dates", () => {
  assert.equal(ddmmyyyyToISO("15-05"), null);
  assert.equal(ddmmyyyyToISO("15"), null);
  assert.equal(ddmmyyyyToISO("15-"), null);
  assert.equal(ddmmyyyyToISO("15-05-"), null);
});

test("ddmmyyyyToISO returns null for impossible dates", () => {
  assert.equal(ddmmyyyyToISO("31-02-1990"), null); // Feb 31 doesn't exist
  assert.equal(ddmmyyyyToISO("30-02-1990"), null); // Feb 30 doesn't exist
  assert.equal(ddmmyyyyToISO("31-04-1990"), null); // April only has 30 days
  assert.equal(ddmmyyyyToISO("00-05-1990"), null); // Day 0 doesn't exist
  assert.equal(ddmmyyyyToISO("15-00-1990"), null); // Month 0 doesn't exist
  assert.equal(ddmmyyyyToISO("32-01-1990"), null); // Day 32 doesn't exist
  assert.equal(ddmmyyyyToISO("15-13-1990"), null); // Month 13 doesn't exist
});

test("ddmmyyyyToISO returns null for 2-digit years", () => {
  assert.equal(ddmmyyyyToISO("15-05-90"), null);
  assert.equal(ddmmyyyyToISO("15-05-26"), null);
});

test("ddmmyyyyToISO returns null for mixed/wrong separators", () => {
  assert.equal(ddmmyyyyToISO("15/05-1990"), null);
  assert.equal(ddmmyyyyToISO("15.05/1990"), null);
});

test("ddmmyyyyToISO SUCCEEDS for valid DD-MM-YYYY dates", () => {
  assert.equal(ddmmyyyyToISO("15-05-1990"), "1990-05-15");
  assert.equal(ddmmyyyyToISO("24-07-2026"), "2026-07-24");
  assert.equal(ddmmyyyyToISO("01-01-2000"), "2000-01-01");
  assert.equal(ddmmyyyyToISO("31-12-1999"), "1999-12-31");
});

test("DateField isInRange would reject future dates when max={todayInIST()}", () => {
  // If today is 2026-07-24, then any date > 2026-07-24 would fail isInRange
  // and thus handleBlur would revert to the previous value, never calling onChange.
  // Example: user types "25-07-2026" (tomorrow) -> parsed ISO is "2026-07-25"
  // -> isInRange("2026-07-25") returns false -> onChange never called -> revert
  // For opted-in fields, onValidityChange reports the range violation during typing.
  const tomorrowISO = ddmmyyyyToISO("25-07-2026");
  assert.equal(tomorrowISO, "2026-07-25");

  const todayISO = "2026-07-24";
  const max = todayISO;
  const isFutureDisallowed = tomorrowISO! > max;
  assert.equal(isFutureDisallowed, true);
});

/**
 * SCENARIO WALKTHROUGH:
 * 1. User opens Settings → Family, profile DOB field is empty (dob = "")
 * 2. User types "1990-05-15" (ISO format, natural for some users)
 * 3. User clicks Save
 * 4. Input's onBlur fires -> handleBlur runs
 * 5. ddmmyyyyToISO("1990-05-15") returns NULL (not DD-MM-YYYY format)
 * 6. handleBlur reverts localText to isoToDDMMYYYY("") = ""
 * 7. onChange is NEVER called -> parent dob stays ""
 * 8. handleSaveProfile sends { dateOfBirth: "" || null } = { dateOfBirth: null }
 * 9. API overwrites with NULL
 * 10. User sees: "not saved / it cleared it"
 *
 * Same failure for: partial dates, impossible dates, 2-digit years, future dates.
 */
