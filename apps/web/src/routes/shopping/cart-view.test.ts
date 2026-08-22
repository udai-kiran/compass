/**
 * Unit tests for pure cart-view helpers (task 12.2).
 * Uses node:test — no React renderer needed.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CartDraftItem, CartDraftWithItems, CatalogItem, FinancialGuardsResponse, PriceSource } from "@compass/shared";
import {
  draftSummary,
  groupItemsBySource,
  guardSummaryText,
  itemDisplayName,
  priceLine,
} from "./cart-view.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SOURCE_A: PriceSource = {
  id: "src-a",
  name: "Blinkit",
  kind: "quick_commerce",
  url: null,
  isActive: true,
  deliveryFeePaise: 2000,
  minCartPaise: 19900,
  deliveryEtaBand: "instant",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const SOURCE_B: PriceSource = {
  id: "src-b",
  name: "BigBasket",
  kind: "ecommerce",
  url: null,
  isActive: false, // inactive
  deliveryFeePaise: null,
  minCartPaise: null,
  deliveryEtaBand: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

function makeItem(overrides: Partial<CartDraftItem> = {}): CartDraftItem {
  return {
    id: "item-1",
    cartDraftId: "draft-1",
    catalogItemId: "cat-1",
    quantityBase: 500,
    unit: "g",
    reason: "Expected to run out soon",
    suggestedPricePaise: 10000,
    suggestedSourceId: "src-a",
    substitutionForItemId: null,
    priceDeltaPaise: null,
    isRemoved: false,
    createdAt: new Date("2025-06-01"),
    ...overrides,
  };
}

function makeDraft(items: CartDraftItem[]): CartDraftWithItems {
  return {
    id: "draft-1",
    status: "draft",
    priceSourceId: null,
    totalPaise: items.reduce((s, i) => s + (i.isRemoved ? 0 : (i.suggestedPricePaise ?? 0)), 0),
    generatedAt: new Date("2025-06-01"),
    createdAt: new Date("2025-06-01"),
    updatedAt: new Date("2025-06-01"),
    items,
  };
}

// ─── groupItemsBySource ───────────────────────────────────────────────────────

describe("groupItemsBySource", () => {
  test("groups items by source, calculates subtotals for active items only", () => {
    const sourcesMap = new Map([
      ["src-a", SOURCE_A],
      ["src-b", SOURCE_B],
    ]);
    const items = [
      makeItem({ id: "i1", suggestedSourceId: "src-a", suggestedPricePaise: 10000, isRemoved: false }),
      makeItem({ id: "i2", suggestedSourceId: "src-a", suggestedPricePaise: 5000, isRemoved: true }),
      makeItem({ id: "i3", suggestedSourceId: "src-b", suggestedPricePaise: 20000, isRemoved: false }),
    ];
    const groups = groupItemsBySource(items, sourcesMap);
    assert.equal(groups.length, 2);

    const groupA = groups.find((g) => g.sourceId === "src-a")!;
    assert.ok(groupA, "Expected group for src-a");
    assert.equal(groupA.sourceName, "Blinkit");
    assert.equal(groupA.items.length, 2);
    // subtotal: only active item (i1), not removed (i2)
    assert.equal(groupA.subtotalPaise, 10000);
    assert.equal(groupA.isActive, true);
    assert.equal(groupA.deliveryFeePaise, 2000);

    const groupB = groups.find((g) => g.sourceId === "src-b")!;
    assert.ok(groupB, "Expected group for src-b");
    assert.equal(groupB.sourceName, "BigBasket");
    assert.equal(groupB.isActive, false);
    assert.equal(groupB.subtotalPaise, 20000);
  });

  test("null sourceId goes into Unknown source group", () => {
    const sourcesMap = new Map<string, PriceSource>();
    const items = [
      makeItem({ id: "i1", suggestedSourceId: null, suggestedPricePaise: 7500, isRemoved: false }),
    ];
    const groups = groupItemsBySource(items, sourcesMap);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.sourceId, null);
    assert.equal(groups[0]!.sourceName, "Unknown source");
    assert.equal(groups[0]!.subtotalPaise, 7500);
  });

  test("empty items produces empty groups", () => {
    const groups = groupItemsBySource([], new Map());
    assert.equal(groups.length, 0);
  });

  test("null and unknown sourceIds are consolidated into one Unknown source group", () => {
    const sourcesMap = new Map<string, PriceSource>();
    const items = [
      makeItem({ id: "unknown-id", suggestedSourceId: "nonexistent", suggestedPricePaise: 3000 }),
      makeItem({ id: "null-id", suggestedSourceId: null, suggestedPricePaise: 5000 }),
      makeItem({ id: "another-unknown-id", suggestedSourceId: "also-missing", suggestedPricePaise: 2000 }),
    ];
    const groups = groupItemsBySource(items, sourcesMap);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.sourceName, "Unknown source");
    assert.equal(groups[0]!.sourceId, null);
    assert.equal(groups[0]!.isActive, false);
    assert.equal(groups[0]!.items.length, 3);
    assert.equal(groups[0]!.subtotalPaise, 10000);
  });

  test("removed items included in group but not in subtotal", () => {
    const sourcesMap = new Map([["src-a", SOURCE_A]]);
    const items = [
      makeItem({ id: "i1", suggestedPricePaise: 10000, isRemoved: true }),
      makeItem({ id: "i2", suggestedPricePaise: 5000, isRemoved: false }),
    ];
    const groups = groupItemsBySource(items, sourcesMap);
    assert.equal(groups[0]!.items.length, 2);
    assert.equal(groups[0]!.subtotalPaise, 5000);
  });
});

// ─── draftSummary ─────────────────────────────────────────────────────────────

describe("draftSummary", () => {
  test("all priced active items", () => {
    const items = [
      makeItem({ id: "i1", suggestedPricePaise: 10000, isRemoved: false }),
      makeItem({ id: "i2", suggestedPricePaise: 5000, isRemoved: false }),
    ];
    const summary = draftSummary(makeDraft(items));
    assert.equal(summary.totalItems, 2);
    assert.equal(summary.activeItems, 2);
    assert.equal(summary.removedCount, 0);
    assert.equal(summary.unpricedCount, 0);
    assert.equal(summary.totalPaise, 15000);
    assert.equal(summary.hasSubstitutions, false);
  });

  test("some items removed", () => {
    const items = [
      makeItem({ id: "i1", suggestedPricePaise: 10000, isRemoved: false }),
      makeItem({ id: "i2", suggestedPricePaise: 5000, isRemoved: true }),
    ];
    const summary = draftSummary(makeDraft(items));
    assert.equal(summary.totalItems, 2);
    assert.equal(summary.activeItems, 1);
    assert.equal(summary.removedCount, 1);
    assert.equal(summary.totalPaise, 10000);
  });

  test("some items unpriced", () => {
    const items = [
      makeItem({ id: "i1", suggestedPricePaise: 10000, isRemoved: false }),
      makeItem({ id: "i2", suggestedPricePaise: null, isRemoved: false }),
    ];
    const summary = draftSummary(makeDraft(items));
    assert.equal(summary.unpricedCount, 1);
    assert.equal(summary.totalPaise, 10000);
  });

  test("all items removed → activeItems 0", () => {
    const items = [
      makeItem({ id: "i1", isRemoved: true }),
      makeItem({ id: "i2", isRemoved: true }),
    ];
    const summary = draftSummary(makeDraft(items));
    assert.equal(summary.activeItems, 0);
    assert.equal(summary.removedCount, 2);
    assert.equal(summary.totalPaise, 0);
  });

  test("has substitutions", () => {
    const items = [
      makeItem({ id: "i1", substitutionForItemId: "other-item-id" }),
    ];
    const summary = draftSummary(makeDraft(items));
    assert.equal(summary.hasSubstitutions, true);
  });

  test("zero items", () => {
    const summary = draftSummary(makeDraft([]));
    assert.equal(summary.totalItems, 0);
    assert.equal(summary.activeItems, 0);
    assert.equal(summary.totalPaise, 0);
  });
});

// ─── guardSummaryText ─────────────────────────────────────────────────────────

describe("guardSummaryText", () => {
  function makeGuards(overrides: Partial<FinancialGuardsResponse> = {}): FinancialGuardsResponse {
    return {
      budget: null,
      goals: null,
      emi: null,
      ...overrides,
    };
  }

  test("budget over → hasOverage true, budgetLine contains 'over budget'", () => {
    const guards = makeGuards({
      budget: {
        budgetedPaise: 100000,
        carryPaise: 0,
        spentPaise: 80000,
        remainingPaise: -10000,
        cartTotalPaise: 30000,
        overBudgetPaise: 10000,
        categoryId: null,
      },
    });
    const result = guardSummaryText(guards);
    assert.equal(result.hasOverage, true);
    assert.ok(result.budgetLine?.includes("over budget"), `budgetLine was: ${result.budgetLine}`);
  });

  test("budget under → hasOverage false, budgetLine contains 'remaining'", () => {
    const guards = makeGuards({
      budget: {
        budgetedPaise: 100000,
        carryPaise: 0,
        spentPaise: 20000,
        remainingPaise: 50000,
        cartTotalPaise: 30000,
        overBudgetPaise: 0,
        categoryId: null,
      },
    });
    const result = guardSummaryText(guards);
    assert.equal(result.hasOverage, false);
    assert.ok(result.budgetLine?.includes("remaining"), `budgetLine was: ${result.budgetLine}`);
  });

  test("null budget → budgetLine null", () => {
    const guards = makeGuards({ budget: null });
    const result = guardSummaryText(guards);
    assert.equal(result.budgetLine, null);
    assert.equal(result.hasOverage, false);
  });

  test("goal delayed → appears in goalLines", () => {
    const guards = makeGuards({
      goals: {
        impacts: [
          {
            goalId: "g1",
            goalName: "Vacation",
            baselineMonths: 10,
            impactedMonths: 12,
            delayMonths: 2,
            baselineMonthlyInflowPaise: 50000,
            impactedMonthlyInflowPaise: 45000,
            status: "delayed",
          },
        ],
      },
    });
    const result = guardSummaryText(guards);
    assert.equal(result.goalLines.length, 1);
    assert.ok(result.goalLines[0]!.includes("Vacation"), `goal line was: ${result.goalLines[0]}`);
    assert.ok(result.goalLines[0]!.includes("delayed"), `goal line was: ${result.goalLines[0]}`);
  });

  test("goal unreachable → appears in goalLines", () => {
    const guards = makeGuards({
      goals: {
        impacts: [
          {
            goalId: "g1",
            goalName: "Car",
            baselineMonths: null,
            impactedMonths: null,
            delayMonths: null,
            baselineMonthlyInflowPaise: 0,
            impactedMonthlyInflowPaise: 0,
            status: "unreachable",
          },
        ],
      },
    });
    const result = guardSummaryText(guards);
    assert.equal(result.goalLines.length, 1);
    assert.ok(result.goalLines[0]!.includes("unreachable"), `goal line was: ${result.goalLines[0]}`);
  });

  test("goal no_impact → not in goalLines", () => {
    const guards = makeGuards({
      goals: {
        impacts: [
          {
            goalId: "g1",
            goalName: "Emergency Fund",
            baselineMonths: 6,
            impactedMonths: 6,
            delayMonths: 0,
            baselineMonthlyInflowPaise: 50000,
            impactedMonthlyInflowPaise: 50000,
            status: "no_impact",
          },
        ],
      },
    });
    const result = guardSummaryText(guards);
    assert.equal(result.goalLines.length, 0);
  });

  test("null goals → empty goalLines", () => {
    const guards = makeGuards({ goals: null });
    const result = guardSummaryText(guards);
    assert.deepEqual(result.goalLines, []);
  });
});

// ─── itemDisplayName ──────────────────────────────────────────────────────────

describe("itemDisplayName", () => {
  const catalogItem: CatalogItem = {
    id: "cat-1",
    canonicalName: "Whole Wheat Flour",
    brand: "Aashirvaad",
    categoryId: null,
    packQuantityBase: 5000,
    unit: "g",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  };

  test("known catalog item → canonicalName", () => {
    const catalogMap = new Map([["cat-1", catalogItem]]);
    const result = itemDisplayName({ catalogItemId: "cat-1" }, catalogMap);
    assert.equal(result, "Whole Wheat Flour");
  });

  test("null catalogItemId → Unknown item", () => {
    const catalogMap = new Map([["cat-1", catalogItem]]);
    const result = itemDisplayName({ catalogItemId: null }, catalogMap);
    assert.equal(result, "Unknown item");
  });

  test("unknown catalogItemId → Unknown item", () => {
    const catalogMap = new Map<string, CatalogItem>();
    const result = itemDisplayName({ catalogItemId: "not-found" }, catalogMap);
    assert.equal(result, "Unknown item");
  });
});

// ─── priceLine ────────────────────────────────────────────────────────────────

describe("priceLine", () => {
  const sourcesMap = new Map([["src-a", SOURCE_A]]);

  test("known source and price → formatted output", () => {
    const result = priceLine({ suggestedPricePaise: 10000, suggestedSourceId: "src-a" }, sourcesMap);
    assert.equal(result.sourceText, "Blinkit");
    assert.equal(result.caveat, "from draft generation");
    // formatINR(10000) = ₹100.00 (or similar)
    assert.ok(result.priceText.includes("100"), `priceText was: ${result.priceText}`);
  });

  test("null price → priceText is dash", () => {
    const result = priceLine({ suggestedPricePaise: null, suggestedSourceId: "src-a" }, sourcesMap);
    assert.equal(result.priceText, "—");
  });

  test("null sourceId → Unknown source", () => {
    const result = priceLine({ suggestedPricePaise: 5000, suggestedSourceId: null }, sourcesMap);
    assert.equal(result.sourceText, "Unknown source");
  });

  test("unknown sourceId → Unknown source", () => {
    const result = priceLine({ suggestedPricePaise: 5000, suggestedSourceId: "not-found" }, sourcesMap);
    assert.equal(result.sourceText, "Unknown source");
  });

  test("caveat is always from draft generation", () => {
    const result = priceLine({ suggestedPricePaise: 5000, suggestedSourceId: null }, new Map());
    assert.equal(result.caveat, "from draft generation");
  });
});
