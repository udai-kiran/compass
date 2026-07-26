import assert from "node:assert/strict";
import test from "node:test";
import { requiredAmbFromInput, requiredAmbToInput } from "./required-amb.ts";

test("an empty field means no requirement (0)", () => {
  assert.equal(requiredAmbFromInput(""), 0);
});

test("a whole-rupee amount converts to paise", () => {
  assert.equal(requiredAmbFromInput("10000"), 1000000);
});

test("paise are preserved exactly for a two-decimal amount", () => {
  assert.equal(requiredAmbFromInput("1234.56"), 123456);
});

test("more precision than paise is rejected rather than rounded away", () => {
  // Same rationale as openingBalanceFromInput — binary floating point would
  // silently lose the paisa, so a third decimal is rejected outright.
  assert.equal(requiredAmbFromInput("1234.567"), null);
});

test("a negative amount is rejected — a requirement is a floor, never below zero", () => {
  assert.equal(requiredAmbFromInput("-5"), null);
});

test("junk input is rejected", () => {
  assert.equal(requiredAmbFromInput("abc"), null);
});

test("a bare dot is rejected", () => {
  assert.equal(requiredAmbFromInput("."), null);
});

test("a trailing dot is accepted so the field stays usable mid-typing", () => {
  assert.equal(requiredAmbFromInput("450."), 45000);
});

test("requiredAmbToInput round-trips through requiredAmbFromInput", () => {
  const cases = ["10000", "1234.56", "1"];
  for (const c of cases) {
    const paise = requiredAmbFromInput(c);
    assert.notEqual(paise, null);
    assert.equal(requiredAmbToInput(paise as number), c);
  }
});

test("zero required AMB shows as an empty field, not '0'", () => {
  assert.equal(requiredAmbToInput(0), "");
});

// MAX_REQUIRED_AMB_PAISE is 1,000,000,000 paise = ₹1,00,00,000 = 10,000,000
// rupees, so "10000000" is exactly the boundary and must be accepted; one
// paisa above that is ₹10,000,000.01, i.e. "10000000.01", and must be
// rejected. This mirrors the shared schema's `.max(MAX_REQUIRED_AMB_PAISE)` so
// the client and server bounds cannot disagree.
test("a required AMB at exactly the shared schema's cap is accepted", () => {
  assert.equal(requiredAmbFromInput("10000000"), 1_000_000_000);
});

test("a required AMB one paisa above the shared schema's cap is rejected", () => {
  assert.equal(requiredAmbFromInput("10000000.01"), null);
});
