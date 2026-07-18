import assert from "node:assert/strict";
import test from "node:test";
import {
  accountAllocationClass,
  allocationPercentages,
  holdingAllocationClass,
} from "./goal-allocation.ts";

test("credited-rate accounts are debt while generic investments are equity", () => {
  assert.equal(accountAllocationClass("epf"), "debt");
  assert.equal(accountAllocationClass("ppf"), "debt");
  assert.equal(accountAllocationClass("ssy"), "debt");
  assert.equal(accountAllocationClass("investment"), "equity");
  assert.equal(accountAllocationClass("bank"), "other");
});

test("fund classification uses explicit tax treatment", () => {
  assert.equal(holdingAllocationClass("mutual_fund", "equity"), "equity");
  assert.equal(holdingAllocationClass("mutual_fund", "specified_fund"), "debt");
  assert.equal(holdingAllocationClass("etf", "other"), "debt");
  assert.equal(holdingAllocationClass("gold", "other"), "other");
  assert.equal(holdingAllocationClass("nps", "other"), "other");
});

test("allocation percentages include other and reconcile to 100", () => {
  assert.deepEqual(
    allocationPercentages([
      { valuePaise: 60, allocationClass: "equity" },
      { valuePaise: 30, allocationClass: "debt" },
      { valuePaise: 10, allocationClass: "other" },
    ]),
    { equityPct: 60, debtPct: 30, otherPct: 10 },
  );
  assert.deepEqual(allocationPercentages([]), { equityPct: 0, debtPct: 0, otherPct: 0 });
});
