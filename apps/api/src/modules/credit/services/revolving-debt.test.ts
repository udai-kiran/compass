import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePaymentState, estimateMonthlyCharge } from "./revolving-debt.ts";

test("derivePaymentState: paid in full", () => {
  assert.equal(derivePaymentState(100_000, 5_000, 100_000), "paid_in_full");
});

test("derivePaymentState: minimum only", () => {
  assert.equal(derivePaymentState(100_000, 5_000, 5_000), "minimum_only");
});

test("derivePaymentState: partial payment", () => {
  assert.equal(derivePaymentState(100_000, 5_000, 3_000), "partial");
});

test("derivePaymentState: unpaid", () => {
  assert.equal(derivePaymentState(100_000, 5_000, 0), "unpaid");
});

test("derivePaymentState: unknown when totalDue is null", () => {
  assert.equal(derivePaymentState(null, 5_000, 0), "unknown");
});

test("estimateMonthlyCharge: 42% APR on ₹500 revolving balance", () => {
  // 50_000 paise (₹500) * 4200 bps / 10000 / 12 = ceil(1750) = 1750 paise ≈ ₹17.50/month
  assert.equal(estimateMonthlyCharge(50_000, 4200), 1750);
});

test("estimateMonthlyCharge: null when APR not set", () => {
  assert.equal(estimateMonthlyCharge(50_000, null), null);
});

test("estimateMonthlyCharge: null when no revolving balance", () => {
  assert.equal(estimateMonthlyCharge(0, 4200), null);
});
