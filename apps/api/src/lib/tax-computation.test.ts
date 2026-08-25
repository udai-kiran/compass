/**
 * tax-computation.test.ts — Unit tests for the pure tax computation engine.
 *
 * No DB, no I/O. All amounts in paise.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSlabTax, computeTaxBreakdown } from "./tax-computation.ts";
import { getRegimeRules } from "./tax-rules.ts";

// ─── computeSlabTax — old regime FY 2025-26 ordinary ─────────────────────────

describe("computeSlabTax — old regime FY 2025-26 ordinary", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");

  it("income=0 → 0", () => {
    assert.strictEqual(computeSlabTax(0, rules.slabs), 0);
  });

  it("income=25_000_000 (₹2.5L, at 0% boundary) → 0", () => {
    assert.strictEqual(computeSlabTax(25_000_000, rules.slabs), 0);
  });

  it("income=50_000_000 (₹5L) → 1_250_000 (₹12,500)", () => {
    // 5% of (₹5L - ₹2.5L) = 5% of 25M paise = 1_250_000
    assert.strictEqual(computeSlabTax(50_000_000, rules.slabs), 1_250_000);
  });

  it("income=100_000_000 (₹10L) → 11_250_000 (₹1,12,500)", () => {
    // 1_250_000 + 20% of 50M = 1_250_000 + 10_000_000
    assert.strictEqual(computeSlabTax(100_000_000, rules.slabs), 11_250_000);
  });
});

// ─── computeSlabTax — new regime FY 2025-26 ──────────────────────────────────

describe("computeSlabTax — new regime FY 2025-26", () => {
  const rules = getRegimeRules("2025-26", "new", "ordinary");

  it("income=0 → 0", () => {
    assert.strictEqual(computeSlabTax(0, rules.slabs), 0);
  });

  it("income=40_000_000 (₹4L, at 0% boundary) → 0", () => {
    assert.strictEqual(computeSlabTax(40_000_000, rules.slabs), 0);
  });

  it("income=80_000_000 (₹8L) → 2_000_000 (₹20,000)", () => {
    // 5% of (₹8L - ₹4L) = 5% of 40M paise = 2_000_000
    assert.strictEqual(computeSlabTax(80_000_000, rules.slabs), 2_000_000);
  });

  it("income=120_000_000 (₹12L) → 6_000_000 (₹60,000)", () => {
    // 2_000_000 + 10% of 40M = 2_000_000 + 4_000_000
    assert.strictEqual(computeSlabTax(120_000_000, rules.slabs), 6_000_000);
  });
});

// ─── computeTaxBreakdown — new regime FY 2025-26 ─────────────────────────────

describe("computeTaxBreakdown — new regime FY 2025-26", () => {
  const rules = getRegimeRules("2025-26", "new", "ordinary");

  it("taxable=120_000_000 (₹12L) → zero tax due to full 87A rebate", () => {
    const bd = computeTaxBreakdown(120_000_000, rules);
    assert.strictEqual(bd.taxOnSlabsPaise, 6_000_000);
    assert.strictEqual(bd.rebate87APaise, 6_000_000);
    assert.strictEqual(bd.taxAfterRebatePaise, 0);
    assert.strictEqual(bd.surchargePaise, 0);
    assert.strictEqual(bd.marginalReliefPaise, 0);
    assert.strictEqual(bd.cessPaise, 0);
    assert.strictEqual(bd.totalLiabilityPaise, 0);
  });

  it("taxable=122_500_000 (₹12.25L) → marginal relief at 87A threshold → ₹26,000 total", () => {
    // slabTax = 6_000_000 + 15%*2_500_000 = 6_375_000
    // marginal relief: netAtThreshold=0, excess=2_500_000, relief=3_875_000
    // taxAfterRebate = 2_500_000, cess = 100_000, total = 2_600_000
    const bd = computeTaxBreakdown(122_500_000, rules);
    assert.strictEqual(bd.taxOnSlabsPaise, 6_375_000);
    assert.strictEqual(bd.rebate87APaise, 3_875_000);
    assert.strictEqual(bd.taxAfterRebatePaise, 2_500_000);
    assert.strictEqual(bd.surchargePaise, 0);
    assert.strictEqual(bd.marginalReliefPaise, 0);
    assert.strictEqual(bd.cessPaise, 100_000);
    assert.strictEqual(bd.totalLiabilityPaise, 2_600_000);
  });
});

// ─── computeTaxBreakdown — old regime FY 2025-26 with surcharge marginal relief

describe("computeTaxBreakdown — old regime FY 2025-26 ordinary, ₹51L income with surcharge marginal relief", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");

  it("taxable=510_000_000 (₹51L) → correct surcharge marginal relief", () => {
    const bd = computeTaxBreakdown(510_000_000, rules);
    // slab tax
    assert.strictEqual(bd.taxOnSlabsPaise, 134_250_000);
    // rebate: 510M > 50M threshold, and excess (460M) > slabTax → no relief → rebate=0
    assert.strictEqual(bd.rebate87APaise, 0);
    assert.strictEqual(bd.taxAfterRebatePaise, 134_250_000);
    // surcharge: prescribed=13_425_000, but marginal relief applies
    assert.strictEqual(bd.surchargePaise, 7_000_000);
    assert.strictEqual(bd.marginalReliefPaise, 6_425_000);
    assert.strictEqual(bd.taxAfterSurchargePaise, 141_250_000);
    // cess = floor(141_250_000 * 400 / 10000) = 5_650_000
    assert.strictEqual(bd.cessPaise, 5_650_000);
    assert.strictEqual(bd.totalLiabilityPaise, 146_900_000);
  });
});

// ─── computeTaxBreakdown — old regime §87A hard cliff ────────────────────────
//
// Fix regression guard: the old code applied marginal relief in BOTH regimes.
// For income = threshold + 1 paise = 50_000_001 (₹5L + 1p, old regime FY 2025-26),
// the old code granted rebate of 1_249_999, leaving taxAfterRebate = 1 (near-zero).
// The correct old-regime rule is a hard cliff: income above the threshold loses
// the ENTIRE rebate, so rebate87A must be 0.

describe("computeTaxBreakdown — old regime §87A hard cliff (FY 2025-26 ordinary)", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");
  // rebate87A.thresholdPaise = lakh(5) = 50_000_000
  // Test at exactly threshold + 1 paise — the canonical cliff case.
  const TAXABLE = 50_000_001; // ₹5,00,000.01 — one paise above the ₹5L threshold

  it("slabTax at threshold+1 is 1_250_000 (the 20% band contributes floor(1 * 2000/10000) = 0)", () => {
    // 5% of [₹2.5L+1 .. ₹5L] = 5% of 25_000_000 = 1_250_000
    // 20% of [₹5L+1 .. TAXABLE] = 20% of 1 paise = floor(0.2) = 0
    assert.strictEqual(computeSlabTax(TAXABLE, rules.slabs), 1_250_000);
  });

  it("rebate87APaise === 0 — old regime cliff: no marginal relief above threshold", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    assert.strictEqual(bd.rebate87APaise, 0, "old regime must lose the entire rebate at threshold+1p");
  });

  it("totalLiabilityPaise equals full slabTax + cess (no rebate, no surcharge)", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    // slabTax = 1_250_000; no rebate; no surcharge (income << ₹50L); cess = 50_000
    assert.strictEqual(bd.taxOnSlabsPaise, 1_250_000);
    assert.strictEqual(bd.rebate87APaise, 0);
    assert.strictEqual(bd.taxAfterRebatePaise, 1_250_000);
    assert.strictEqual(bd.surchargePaise, 0);
    assert.strictEqual(bd.cessPaise, 50_000); // floor(1_250_000 * 400 / 10000)
    assert.strictEqual(bd.totalLiabilityPaise, 1_300_000);
  });
});

// ─── computeTaxBreakdown — negative / zero clamping ──────────────────────────

describe("computeTaxBreakdown — clamping", () => {
  const rules = getRegimeRules("2025-26", "new", "ordinary");

  it("negative taxable income is clamped to 0", () => {
    const bd = computeTaxBreakdown(-1_000_000, rules);
    assert.strictEqual(bd.taxableIncomePaise, 0);
    assert.strictEqual(bd.totalLiabilityPaise, 0);
  });
});
