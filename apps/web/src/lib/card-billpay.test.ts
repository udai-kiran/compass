import { test } from "node:test";
import assert from "node:assert/strict";
import { bankSupportsBillVpa, cardBillVpa } from "./card-billpay.ts";

test("builds Axis and ICICI VPAs from mobile + last4", () => {
  assert.equal(cardBillVpa("Axis", "9876543210", "1234"), "CC.9198765432101234@axisbank");
  assert.equal(cardBillVpa("axis bank", "9876543210", "1234"), "CC.9198765432101234@axisbank");
  assert.equal(cardBillVpa("ICICI", "9876543210", "1234"), "ccpay.98765432101234@icici");
});

test("banks without a mobile+last4 scheme return null", () => {
  // HDFC has no public VPA scheme; SBI needs the full card number, which we never store.
  assert.equal(cardBillVpa("HDFC", "9876543210", "1234"), null);
  assert.equal(cardBillVpa("SBI", "9876543210", "1234"), null);
  assert.equal(cardBillVpa("Some Co-op Bank", "9876543210", "1234"), null);
  assert.equal(bankSupportsBillVpa("HDFC"), false);
  assert.equal(bankSupportsBillVpa("Axis"), true);
  assert.equal(bankSupportsBillVpa(null), false);
});

test("incomplete or malformed inputs yield null, never a partial VPA", () => {
  assert.equal(cardBillVpa("Axis", null, "1234"), null);
  assert.equal(cardBillVpa("Axis", "9876543210", null), null);
  assert.equal(cardBillVpa("Axis", "98765", "1234"), null); // mobile too short
  assert.equal(cardBillVpa("Axis", "9876543210", "12"), null); // last4 too short
  assert.equal(cardBillVpa("Axis", "98765432100000", "1234"), null); // mobile too long
});

test("strips non-digits before validating length", () => {
  assert.equal(cardBillVpa("Axis", "98765 43210", "1234"), "CC.9198765432101234@axisbank");
  assert.equal(cardBillVpa("ICICI", "+91 98765-43210", "1234"), null); // 12 digits after strip
});
