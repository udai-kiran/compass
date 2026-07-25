import { test } from "node:test";
import assert from "node:assert/strict";
import { dateValidationMessage, resolveDateInput } from "./date-field-commit.ts";

const TODAY = "2026-07-25";

/** The Settings → Profile date-of-birth field: opted in, no future dates. */
function dob(text: string, event: "change" | "blur", committedValue = "") {
  return resolveDateInput({
    text,
    committedValue,
    max: TODAY,
    event,
    keepInvalid: true,
  });
}

/** A field that has not opted in (the other DateField call sites). */
function legacy(text: string, event: "change" | "blur", committedValue = "") {
  return resolveDateInput({ text, committedValue, event, keepInvalid: false });
}

test("valid DD-MM-YYYY commits the ISO date while typing", () => {
  const r = dob("15-05-1990", "change");
  assert.equal(r.commit, "1990-05-15");
  assert.equal(r.valid, true);
  // Text is left exactly as typed so reformatting never fights the caret.
  assert.equal(r.text, "15-05-1990");
});

test("valid DD-MM-YYYY normalises the display on blur", () => {
  const r = dob("1-1-2000", "blur");
  assert.equal(r.commit, "2000-01-01");
  assert.equal(r.text, "01-01-2000");
  assert.equal(r.valid, true);
});

test("REGRESSION: blur keeps invalid text and reports invalid instead of wiping it", () => {
  // The reported bug: clicking Save blurs the input first. Invalid text used to be
  // reverted *and* reported valid, so the submit that followed sent null and the
  // typed date disappeared with no explanation.
  const r = dob("1990-05-15", "blur"); // ISO typed into a DD-MM-YYYY field
  assert.equal(r.commit, null, "must not push a value to the parent");
  assert.equal(r.text, "1990-05-15", "must not discard what the user typed");
  assert.equal(r.valid, false, "parent must be able to block its Save button");
  assert.equal(r.message, "Enter a valid date in DD-MM-YYYY format");
});

test("REGRESSION: blurring a partial date does not clear an already-saved value", () => {
  const r = dob("15-05", "blur", "1990-05-15");
  assert.equal(r.commit, null);
  assert.equal(r.valid, false);
  assert.equal(r.text, "15-05");
});

test("future dates are rejected with a bound-specific message", () => {
  const r = dob("26-07-2026", "blur");
  assert.equal(r.commit, null);
  assert.equal(r.valid, false);
  assert.equal(r.message, "Date must be on or before 25-07-2026");
});

test("dates before an explicit min are rejected with a bound-specific message", () => {
  const r = resolveDateInput({
    text: "31-12-1999",
    committedValue: "",
    min: "2000-01-01",
    event: "blur",
    keepInvalid: true,
  });
  assert.equal(r.commit, null);
  assert.equal(r.valid, false);
  assert.equal(r.message, "Date must be on or after 01-01-2000");
});

test("impossible calendar dates are rejected", () => {
  for (const bad of ["31-02-1990", "30-02-1990", "31-04-1990", "32-01-1990", "15-13-1990"]) {
    const r = dob(bad, "blur");
    assert.equal(r.commit, null, `${bad} must not commit`);
    assert.equal(r.valid, false, `${bad} must be invalid`);
  }
});

test("clearing the field commits an empty value and is valid", () => {
  const r = dob("", "blur", "1990-05-15");
  assert.equal(r.commit, "", "empty means clear — parent maps this to null");
  assert.equal(r.valid, true);
  assert.equal(r.text, "");
});

test("whitespace-only input clears rather than erroring", () => {
  const r = dob("   ", "blur", "1990-05-15");
  assert.equal(r.commit, "");
  assert.equal(r.valid, true);
  assert.equal(r.text, "");
});

test("a once-invalid field becomes valid again as soon as the date parses", () => {
  assert.equal(dob("15-05-19", "change").valid, false);
  const fixed = dob("15-05-1990", "change");
  assert.equal(fixed.valid, true);
  assert.equal(fixed.commit, "1990-05-15");
});

test("non-opted-in fields keep the old blur behaviour: revert to the committed value", () => {
  const r = legacy("nonsense", "blur", "1990-05-15");
  assert.equal(r.commit, null);
  assert.equal(r.text, "15-05-1990", "reverts to the last committed value");
  assert.equal(r.valid, true, "legacy fields never report invalid");
});

test("non-opted-in fields revert to empty when nothing was committed", () => {
  const r = legacy("nonsense", "blur", "");
  assert.equal(r.commit, null);
  assert.equal(r.text, "");
  assert.equal(r.valid, true);
});

test("non-opted-in fields never commit while typing, even for a valid date", () => {
  // These fields only report to their parent on blur; typing just updates the text.
  const valid = legacy("15-05-1990", "change");
  assert.equal(valid.commit, null, "valid text must still wait for blur");
  assert.equal(valid.text, "15-05-1990");
  assert.equal(valid.valid, true, "legacy fields never report invalid");

  const partial = legacy("15-05", "change");
  assert.equal(partial.commit, null);
  assert.equal(partial.text, "15-05", "typing is never rewritten");
  assert.equal(partial.valid, true);
});

test("non-opted-in fields do not fire onValidityChange per keystroke", () => {
  // Backwards compatibility: before the refactor these fields only invoked the
  // callback on blur/calendar-click, so reporting on every keystroke would change
  // the contract for the ~19 call sites that don't opt in.
  assert.equal(legacy("15-05-1990", "change").report, false);
  assert.equal(legacy("nonsense", "change").report, false);
  assert.equal(legacy("", "change").report, false);
  // On blur they report again, exactly as before.
  assert.equal(legacy("15-05-1990", "blur").report, true);
  assert.equal(legacy("nonsense", "blur").report, true);
  assert.equal(legacy("", "blur").report, true);
});

test("opted-in fields report on every event, valid or not", () => {
  for (const event of ["change", "blur"] as const) {
    assert.equal(dob("15-05-1990", event).report, true, `valid/${event}`);
    assert.equal(dob("15-05-19", event).report, true, `invalid/${event}`);
    assert.equal(dob("26-07-2026", event).report, true, `out-of-range/${event}`);
    assert.equal(dob("", event).report, true, `cleared/${event}`);
  }
});

test("dateValidationMessage prefers the format hint when parsing failed", () => {
  assert.equal(
    dateValidationMessage(null, "2000-01-01", TODAY),
    "Enter a valid date in DD-MM-YYYY format",
  );
});

test("alternate separators are accepted", () => {
  assert.equal(dob("15/05/1990", "blur").commit, "1990-05-15");
  assert.equal(dob("15.05.1990", "blur").commit, "1990-05-15");
});
