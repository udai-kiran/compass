import assert from "node:assert/strict";
import { test } from "node:test";
import { sumSigned, txDirection } from "./transactions.ts";

test("sign conventions: negative amounts are outflows (expenses)", () => {
  assert.equal(txDirection(-50000), "outflow");
  assert.equal(txDirection(120000), "inflow");
});

test("sumSigned splits income and expense by sign", () => {
  const { incomePaise, expensePaise } = sumSigned([100000, -25000, -35000, 5000]);
  assert.equal(incomePaise, 105000);
  assert.equal(expensePaise, 60000);
});

test("sumSigned of empty list is zero", () => {
  assert.deepEqual(sumSigned([]), { incomePaise: 0, expensePaise: 0 });
});
