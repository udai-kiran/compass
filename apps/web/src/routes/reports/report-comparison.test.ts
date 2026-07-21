import assert from "node:assert/strict";
import test from "node:test";
import type { Report } from "@compass/shared";
import { compareCategories, compareMerchants, previousPeriodKey } from "./report-comparison.ts";

const report = (overrides: Partial<Report> = {}): Report => ({
  period: "monthly",
  periodKey: "2026-07",
  from: "2026-07-01",
  to: "2026-07-31",
  incomePaise: 0,
  expensePaise: 0,
  netPaise: 0,
  savingsRatePct: 0,
  categories: [],
  topMerchants: [],
  ...overrides,
});

test("previousPeriodKey handles month and year rollover", () => {
  assert.equal(previousPeriodKey("monthly", "2026-01"), "2025-12");
  assert.equal(previousPeriodKey("annual", "2026"), "2025");
});

test("compareCategories includes categories present in only one period", () => {
  const id = "34a9bce1-5121-4a79-8538-e01506e9ec4d";
  const current = report({
    categories: [{ categoryId: null, name: "Uncategorized", spentPaise: 300 }],
  });
  const previous = report({ categories: [{ categoryId: id, name: "Food", spentPaise: 200 }] });
  assert.deepEqual(compareCategories(current, previous), [
    { id: "uncategorized", name: "Uncategorized", currentPaise: 300, previousPaise: 0 },
    { id, name: "Food", currentPaise: 0, previousPaise: 200 },
  ]);
});

test("compareMerchants retains spend and transaction counts", () => {
  const current = report({ topMerchants: [{ merchant: "Cafe", spentPaise: 500, count: 2 }] });
  const previous = report({ topMerchants: [{ merchant: "Cafe", spentPaise: 200, count: 1 }] });
  assert.deepEqual(compareMerchants(current, previous), [
    { merchant: "Cafe", currentPaise: 500, currentCount: 2, previousPaise: 200, previousCount: 1 },
  ]);
});
