import assert from "node:assert/strict";
import { test } from "node:test";
import { computePayslip } from "./payroll.ts";

test("computePayslip nets gross minus every deduction", () => {
  const r = computePayslip(15_000_00, [
    { kind: "tds", amountPaise: 1_800_00 },
    { kind: "epf", amountPaise: 900_00 },
    { kind: "professional_tax", amountPaise: 200 },
  ]);
  assert.equal(r.taxPaise, 1_800_00 + 200);
  assert.equal(r.epfPaise, 900_00);
  assert.equal(r.otherPaise, 0);
  assert.equal(r.netPaise, 15_000_00 - 1_800_00 - 900_00 - 200);
});

test("computePayslip rolls TDS and professional tax into tax, keeps EPF separate", () => {
  const r = computePayslip(1_000_00, [
    { kind: "tds", amountPaise: 100_00 },
    { kind: "professional_tax", amountPaise: 20_00 },
    { kind: "epf", amountPaise: 120_00 },
    { kind: "other", amountPaise: 30_00 },
  ]);
  assert.equal(r.taxPaise, 120_00);
  assert.equal(r.epfPaise, 120_00);
  assert.equal(r.otherPaise, 30_00);
  assert.equal(r.netPaise, 1_000_00 - 120_00 - 120_00 - 30_00);
});

test("computePayslip with no deductions is all take-home", () => {
  const r = computePayslip(500_00, []);
  assert.deepEqual(r, { netPaise: 500_00, taxPaise: 0, epfPaise: 0, otherPaise: 0 });
});
