/**
 * receipt-reconcile.test.ts — Unit tests for the pure reconciliation engine.
 *
 * Tests the `reconcile()` function only (no DB, no network).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, normalizeForMatch, type ReceiptLineInput, type DraftItemInput } from "./receipt-reconcile.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function line(overrides: Partial<ReceiptLineInput> & { id: string }): ReceiptLineInput {
  return {
    normalizedName: overrides.normalizedName ?? "item",
    catalogItemId: overrides.catalogItemId ?? null,
    pricePaise: overrides.pricePaise ?? null,
    quantityBase: overrides.quantityBase ?? null,
    unit: overrides.unit ?? null,
    ...overrides,
  };
}

function draft(overrides: Partial<DraftItemInput> & { id: string }): DraftItemInput {
  return {
    catalogItemId: overrides.catalogItemId ?? null,
    suggestedPricePaise: overrides.suggestedPricePaise ?? null,
    normalizedName: overrides.normalizedName ?? null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("reconcile: empty receipt and empty draft → all empty", () => {
  const result = reconcile([], []);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.priceDiffs, []);
  assert.deepEqual(result.ambiguous, []);
});

test("reconcile: empty receipt, non-empty draft → all missing", () => {
  const result = reconcile([], [draft({ id: "d1", catalogItemId: "cat1" })]);
  assert.deepEqual(result.missing, ["d1"]);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.extra, []);
});

test("reconcile: non-empty receipt, empty draft → all extra", () => {
  const result = reconcile([line({ id: "l1", catalogItemId: "cat1" })], []);
  assert.deepEqual(result.extra, ["l1"]);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.missing, []);
});

test("reconcile: exact catalogItemId match — 1:1", () => {
  const result = reconcile(
    [line({ id: "l1", catalogItemId: "cat1", pricePaise: 5000 })],
    [draft({ id: "d1", catalogItemId: "cat1", suggestedPricePaise: 5000 })],
  );
  assert.deepEqual(result.matched, [{ receiptLineId: "l1", draftItemId: "d1", priceDiffPaise: 0 }]);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.priceDiffs, []);
});

test("reconcile: exact match with price diff → goes to priceDiffs", () => {
  const result = reconcile(
    [line({ id: "l1", catalogItemId: "cat1", pricePaise: 6000 })],
    [draft({ id: "d1", catalogItemId: "cat1", suggestedPricePaise: 5000 })],
  );
  assert.deepEqual(result.priceDiffs, [{ receiptLineId: "l1", draftItemId: "d1", priceDiffPaise: 1000 }]);
  assert.deepEqual(result.matched, []);
});

test("reconcile: fuzzy name match with clear winner", () => {
  const result = reconcile(
    [line({ id: "l1", catalogItemId: null, normalizedName: "basmati rice" })],
    [draft({ id: "d1", catalogItemId: null, normalizedName: "basmati rice" })],
  );
  assert.deepEqual(result.matched, [{ receiptLineId: "l1", draftItemId: "d1", priceDiffPaise: null }]);
});

test("reconcile: fuzzy match — typo within 30% threshold", () => {
  // 'riice' vs 'rice': levenshtein=1, shorter=4, threshold=floor(4*0.3)=1. Should match.
  const result = reconcile(
    [line({ id: "l1", normalizedName: "riice" })],
    [draft({ id: "d1", normalizedName: "rice" })],
  );
  assert.deepEqual(result.matched, [{ receiptLineId: "l1", draftItemId: "d1", priceDiffPaise: null }]);
});

test("reconcile: fuzzy match beyond threshold → extra + missing", () => {
  // Very different strings → no match.
  const result = reconcile(
    [line({ id: "l1", normalizedName: "apple juice" })],
    [draft({ id: "d1", normalizedName: "basmati rice" })],
  );
  assert.deepEqual(result.extra, ["l1"]);
  assert.deepEqual(result.missing, ["d1"]);
  assert.deepEqual(result.matched, []);
});

test("reconcile: ambiguous fuzzy match → ambiguous status", () => {
  // Line "apple" vs draft items "appl1" and "appl2":
  // levenshtein("apple","appl1") = 1, threshold = floor(5*0.3) = 1. Within threshold.
  // levenshtein("apple","appl2") = 1, same. Margin = 0 < 2 → ambiguous.
  const result = reconcile(
    [line({ id: "l1", normalizedName: "apple" })],
    [
      draft({ id: "d1", normalizedName: "appl1" }),
      draft({ id: "d2", normalizedName: "appl2" }),
    ],
  );
  assert.deepEqual(result.ambiguous, ["l1"]);
});

test("reconcile: one-to-one constraint — same catalogItem only matched once", () => {
  // Two receipt lines with same catalogItemId — only first matched.
  const result = reconcile(
    [
      line({ id: "l1", catalogItemId: "cat1", pricePaise: 5000 }),
      line({ id: "l2", catalogItemId: "cat1", pricePaise: 4000 }),
    ],
    [draft({ id: "d1", catalogItemId: "cat1", suggestedPricePaise: 5000 })],
  );
  // l1 matched, l2 extra.
  assert.equal(result.matched.length + result.priceDiffs.length, 1);
  assert.equal(result.extra.length, 1);
  assert.deepEqual(result.extra, ["l2"]);
});

test("reconcile: null price → priceDiffPaise is null (no diff computed)", () => {
  const result = reconcile(
    [line({ id: "l1", catalogItemId: "cat1", pricePaise: null })],
    [draft({ id: "d1", catalogItemId: "cat1", suggestedPricePaise: null })],
  );
  // Matched but no diff computed.
  assert.deepEqual(result.matched, [{ receiptLineId: "l1", draftItemId: "d1", priceDiffPaise: null }]);
});

test("normalizeForMatch: lowercases, trims, collapses whitespace", () => {
  assert.equal(normalizeForMatch("  Basmati  Rice  "), "basmati rice");
  assert.equal(normalizeForMatch("MILK"), "milk");
  assert.equal(normalizeForMatch("dal  chawal"), "dal chawal");
});

test("reconcile: multiple exact matches — each paired one-to-one", () => {
  const result = reconcile(
    [
      line({ id: "l1", catalogItemId: "cat1", pricePaise: 100 }),
      line({ id: "l2", catalogItemId: "cat2", pricePaise: 200 }),
    ],
    [
      draft({ id: "d1", catalogItemId: "cat1", suggestedPricePaise: 100 }),
      draft({ id: "d2", catalogItemId: "cat2", suggestedPricePaise: 200 }),
    ],
  );
  assert.equal(result.matched.length, 2);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.missing, []);
});
