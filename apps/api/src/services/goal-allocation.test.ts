import assert from "node:assert/strict";
import test from "node:test";
import {
  accountAllocationClass,
  allocationPercentages,
  holdingAllocationClass,
  sortAssetsByAllocation,
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
  assert.equal(holdingAllocationClass("stock", "other"), "equity");
  assert.equal(holdingAllocationClass("stock", "specified_fund"), "debt");
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

test("sortAssetsByAllocation groups equity before debt before other", () => {
  const input = [
    { id: "1", name: "Gold ETF", valuePaise: 5000, allocationClass: "other" as const },
    { id: "2", name: "PPF", valuePaise: 20000, allocationClass: "debt" as const },
    { id: "3", name: "Nifty 50 Index Fund", valuePaise: 30000, allocationClass: "equity" as const },
    { id: "4", name: "NPS Tier 1", valuePaise: 8000, allocationClass: "other" as const },
    { id: "5", name: "Corporate Bond Fund", valuePaise: 15000, allocationClass: "debt" as const },
  ];
  const sorted = sortAssetsByAllocation(input);
  assert.deepEqual(
    sorted.map((a) => a.allocationClass),
    ["equity", "debt", "debt", "other", "other"],
  );
});

test("sortAssetsByAllocation orders within a group by value descending", () => {
  const input = [
    { id: "1", name: "Small Cap Fund", valuePaise: 10000, allocationClass: "equity" as const },
    { id: "2", name: "Large Cap Fund", valuePaise: 50000, allocationClass: "equity" as const },
    { id: "3", name: "Mid Cap Fund", valuePaise: 25000, allocationClass: "equity" as const },
  ];
  const sorted = sortAssetsByAllocation(input);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ["2", "3", "1"],
  );
});

test("sortAssetsByAllocation does not mutate the input array", () => {
  const input = [
    { id: "1", name: "Gold ETF", valuePaise: 5000, allocationClass: "other" as const },
    { id: "2", name: "PPF", valuePaise: 20000, allocationClass: "debt" as const },
    { id: "3", name: "Nifty 50 Index Fund", valuePaise: 30000, allocationClass: "equity" as const },
  ];
  const before = input.map((a) => a.id);
  sortAssetsByAllocation(input);
  assert.deepEqual(
    input.map((a) => a.id),
    before,
  );
});

test("sortAssetsByAllocation breaks a value tie by name, then by id", () => {
  const sameValueDifferentName = [
    { id: "1", name: "Zeta Fund", valuePaise: 10000, allocationClass: "equity" as const },
    { id: "2", name: "Alpha Fund", valuePaise: 10000, allocationClass: "equity" as const },
  ];
  assert.deepEqual(
    sortAssetsByAllocation(sameValueDifferentName).map((a) => a.id),
    ["2", "1"],
  );

  const sameValueSameName = [
    { id: "b", name: "Same Fund", valuePaise: 10000, allocationClass: "equity" as const },
    { id: "a", name: "Same Fund", valuePaise: 10000, allocationClass: "equity" as const },
  ];
  assert.deepEqual(
    sortAssetsByAllocation(sameValueSameName).map((a) => a.id),
    ["a", "b"],
  );
});

test("sortAssetsByAllocation returns an empty array for empty input", () => {
  assert.deepEqual(sortAssetsByAllocation([]), []);
});
