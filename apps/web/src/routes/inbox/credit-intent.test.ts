import assert from "node:assert/strict";
import test from "node:test";
import { INTENT_BADGE, isNonPaymentIntent } from "./credit-intent.ts";

test("isNonPaymentIntent: true for refund, cashback and chargeback", () => {
  assert.equal(isNonPaymentIntent("refund"), true);
  assert.equal(isNonPaymentIntent("cashback"), true);
  assert.equal(isNonPaymentIntent("chargeback"), true);
});

test("isNonPaymentIntent: false for repayment and null", () => {
  assert.equal(isNonPaymentIntent("repayment"), false);
  assert.equal(isNonPaymentIntent(null), false);
});

test("INTENT_BADGE: covers every non-null intent value with a label and className", () => {
  for (const intent of ["repayment", "refund", "cashback", "chargeback"] as const) {
    assert.ok(INTENT_BADGE[intent].label.length > 0);
    assert.ok(INTENT_BADGE[intent].className.length > 0);
  }
});
