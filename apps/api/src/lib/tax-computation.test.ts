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
// For income = threshold + ₹10 = 50_001_000 (₹5L+₹10, old regime FY 2025-26),
// the old code granted rebate of 1_249_800, leaving taxAfterRebate = 400 (near-zero).
// The correct old-regime rule is a hard cliff: income above the threshold loses
// the ENTIRE rebate, so rebate87A must be 0.
//
// Note: the canonical 1-paise case (50_000_001) is now handled separately below
// because §288A rounds 50_000_001 down to 50_000_000 (exactly at the threshold),
// granting a full rebate of ₹0 liability — see the §288A cliff-savings test.

describe("computeTaxBreakdown — old regime §87A hard cliff (FY 2025-26 ordinary)", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");
  // rebate87A.thresholdPaise = 50_000_000 (₹5L)
  // Use threshold + ₹10 = 50_001_000, which is already a multiple of 1000 so
  // §288A leaves it unchanged — the cliff still fires.
  const TAXABLE = 50_001_000; // ₹5,00,010 — ₹10 above the ₹5L threshold

  it("slabTax at TAXABLE (₹5L+₹10) is 1_250_200 (5% slab: 1_250_000; 20% of ₹10: 200)", () => {
    // 5% of [₹2.5L+1 .. ₹5L] = 5% of 25_000_000 = 1_250_000
    // 20% of [₹5L+1 .. TAXABLE] = 20% of 1_000 paise = floor(200) = 200
    assert.strictEqual(computeSlabTax(TAXABLE, rules.slabs), 1_250_200);
  });

  it("rebate87APaise === 0 — old regime cliff: no marginal relief above threshold", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    assert.strictEqual(bd.rebate87APaise, 0, "old regime must lose the entire rebate above threshold");
  });

  it("totalLiabilityPaise equals slabTax + cess rounded to nearest ₹10 (§288B)", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    // §288A: 50_001_000 / 1000 = 50001 (exact) → no change
    assert.strictEqual(bd.taxableIncomePaise, 50_001_000);
    assert.strictEqual(bd.taxOnSlabsPaise, 1_250_200);
    assert.strictEqual(bd.rebate87APaise, 0);
    assert.strictEqual(bd.taxAfterRebatePaise, 1_250_200);
    assert.strictEqual(bd.surchargePaise, 0);
    assert.strictEqual(bd.cessPaise, 50_008); // floor(1_250_200 * 400 / 10000)
    // §288B: raw total = 1_250_200 + 50_008 = 1_300_208; rounded to nearest ₹10 → 1_300_000
    assert.strictEqual(bd.totalLiabilityPaise, 1_300_000); // §288B rounds 1_300_208 → 1_300_000
  });
});

// ─── computeTaxBreakdown — §288A cliff-savings test ──────────────────────────
//
// Old regime taxable = 50_000_001 paise (₹5,00,000.01 — one paise above ₹5L).
// §288A rounds this DOWN to 50_000_000 (exactly at the ₹5L threshold), so the
// full §87A rebate applies and total liability is ₹0.  Without §288A, a raw
// paise engine would charge ~₹13,000 (slabTax 1_250_000 + cess 50_000).

describe("computeTaxBreakdown — §288A rounds 50_000_001 to threshold → zero liability (FY 2025-26 old)", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");
  const TAXABLE = 50_000_001; // ₹5,00,000.01 — 1 paise over the ₹5L §87A threshold

  it("§288A rounds 50_000_001 down to 50_000_000 (nearest ₹10)", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    // round(50_000_001 / 1000) = round(50000.001) = 50000 → 50_000_000
    assert.strictEqual(bd.taxableIncomePaise, 50_000_000);
  });

  it("at the rounded threshold income ≤ threshold → full §87A rebate → totalLiabilityPaise === 0", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    // slabTax(50_000_000) = 1_250_000; threshold = 50_000_000 → at threshold → rebate granted
    assert.strictEqual(bd.taxOnSlabsPaise, 1_250_000);
    assert.strictEqual(bd.rebate87APaise, 1_250_000);
    assert.strictEqual(bd.taxAfterRebatePaise, 0);
    assert.strictEqual(bd.cessPaise, 0);
    assert.strictEqual(bd.totalLiabilityPaise, 0);
  });
});

// ─── computeTaxBreakdown — §288B statutory rounding of total liability ────────
//
// Pick a taxable income whose raw liability (slab tax + cess) is NOT a multiple
// of ₹10 paise-wise, and verify §288B rounds it to the nearest ₹10.

describe("computeTaxBreakdown — §288B rounds total liability to nearest ₹10 (FY 2025-26 old)", () => {
  const rules = getRegimeRules("2025-26", "old", "ordinary");
  // TAXABLE = ₹10,00,010 = 100_001_000 paise (already a multiple of 1000, §288A no-op)
  // slabTax: 1_250_000 (5%) + 10_000_000 (20%) + floor(1000*3000/10000)=300 = 11_250_300
  // cess: floor(11_250_300 * 400 / 10000) = 450_012
  // raw total: 11_250_300 + 450_012 = 11_700_312 (not a multiple of 1000)
  // §288B: round(11_700_312 / 1000) = round(11700.312) = 11700 → 11_700_000
  const TAXABLE = 100_001_000; // ₹10,00,010

  it("raw pre-§288B total (11_700_312) is not a ₹10 multiple; returned value is rounded", () => {
    const bd = computeTaxBreakdown(TAXABLE, rules);
    assert.strictEqual(bd.totalLiabilityPaise % 1000, 0, "§288B: totalLiabilityPaise must be a multiple of 1000 paise (₹10)");
    assert.strictEqual(bd.totalLiabilityPaise, 11_700_000); // §288B rounds 11_700_312 → 11_700_000
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
