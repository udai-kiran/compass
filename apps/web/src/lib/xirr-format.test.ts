import { test } from "node:test";
import assert from "node:assert/strict";
import { formatXirrBps, portfolioXirrHint, xirrAriaLabel, xirrHint, xirrTone } from "./xirr-format.ts";

test("formatXirrBps renders null as the em-dash, never a fabricated zero", () => {
  const result = formatXirrBps(null);
  assert.equal(result, "—");
  assert.notEqual(result, "0.00%");
  assert.notEqual(result, "0%");
});

test("formatXirrBps renders a positive rate with an explicit plus sign", () => {
  assert.equal(formatXirrBps(1423), "+14.23%");
});

test("formatXirrBps renders a negative rate with the built-in minus sign", () => {
  assert.equal(formatXirrBps(-810), "-8.10%");
});

test("formatXirrBps renders exactly-zero bps as a real 0.00%, not the unknown dash", () => {
  // A computed flat return is a genuine fact distinct from "we don't know" —
  // it must not collapse into the same em-dash used for null.
  const result = formatXirrBps(0);
  assert.equal(result, "0.00%");
  assert.notEqual(result, "—");
});

test("formatXirrBps renders a large value over 100%", () => {
  assert.equal(formatXirrBps(12345), "+123.45%");
});

test("formatXirrBps rounds a tiny value to two decimal places", () => {
  assert.equal(formatXirrBps(1), "+0.01%");
});

test("xirrTone maps null, positive, negative, and zero bps to distinct tones", () => {
  assert.equal(xirrTone(null), "unknown");
  assert.equal(xirrTone(500), "positive");
  assert.equal(xirrTone(-500), "negative");
  assert.equal(xirrTone(0), "flat");
});

test("xirrHint explains an available rate", () => {
  assert.equal(xirrHint(1423), "XIRR — money-weighted annualised return");
});

test("xirrHint never promises an action that may not work", () => {
  // A holding whose events carry no unit counts looks fully exited to the API,
  // so its valuation is ignored — telling the user to add one would be advice
  // that provably fails. The message must state only what we know.
  const result = xirrHint(null);
  assert.equal(result, "XIRR isn't available for this cash-flow history yet");
  assert.ok(!result.toLowerCase().includes("add a current value"));
});

test("portfolioXirrHint never promises an action that may not work", () => {
  const result = portfolioXirrHint(null);
  assert.equal(
    result,
    "Portfolio XIRR isn't available for the current cash-flow history yet",
  );
  assert.ok(!result.toLowerCase().includes("add a current value"));
});

test("formatXirrBps renders negative zero as a plain 0.00%, not -0.00%", () => {
  // -0 > 0 is false, so no plus sign is added; toFixed then normalises the
  // sign away, so the result must read as a plain positive-looking zero.
  const result = formatXirrBps(-0);
  assert.equal(result, "0.00%");
  assert.notEqual(result, "-0.00%");
  assert.notEqual(result, "—");
});

test("formatXirrBps documents its behaviour on a non-integer input", () => {
  // The API's Zod schema guarantees bps is always an integer; this does not
  // endorse fractional input, it just documents what the function does if
  // one ever slips through.
  assert.equal(formatXirrBps(1423.7), "+14.24%");
});

test("xirrTone treats negative zero as flat", () => {
  assert.equal(xirrTone(-0), "flat");
});

test("portfolioXirrHint returns the generic explanation whenever bps is non-null", () => {
  assert.equal(portfolioXirrHint(1200), "XIRR — money-weighted annualised return");
});

test("xirrAriaLabel spells out unavailability in words, never a bare dash", () => {
  const result = xirrAriaLabel(null, "some hint");
  assert.equal(result, "XIRR unavailable. some hint");
  // A screen reader must get words, not a dash character.
  assert.ok(!result.includes("—"));
});

test("xirrAriaLabel states the rate and its meaning when available", () => {
  assert.equal(xirrAriaLabel(1423, "ignored"), "XIRR +14.23% per year");
});
