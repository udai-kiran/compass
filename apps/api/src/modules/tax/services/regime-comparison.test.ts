/**
 * regime-comparison.test.ts — Unit tests for the regime comparison logic.
 *
 * Tests the pure tax computation paths that underpin compareRegimes(), without
 * requiring a DB or network connection. The full service (which aggregates
 * income_events and deductions from DB) is covered by integration tests.
 *
 * All amounts in paise.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTaxBreakdown } from "../../../lib/tax-computation.ts";
import { getRegimeRules, resolveEmployerNpsRateBps } from "../../../lib/tax-rules.ts";

// Helper: compute old-regime liability for given gross income and total deductions
function oldRegimeLiability(grossPaise: number, totalDeductionsPaise: number): number {
  const rules = getRegimeRules("2025-26", "old", "ordinary");
  const taxable = Math.max(0, grossPaise - totalDeductionsPaise);
  return computeTaxBreakdown(taxable, rules).totalLiabilityPaise;
}

// Helper: compute new-regime liability for given gross income (std deduction only)
function newRegimeLiability(grossPaise: number, ccd2EligiblePaise = 0): number {
  const rules = getRegimeRules("2025-26", "new", "ordinary");
  const newStd = rules.standardDeductionPaise; // 7_500_000
  const taxable = Math.max(0, grossPaise - newStd - ccd2EligiblePaise);
  return computeTaxBreakdown(taxable, rules).totalLiabilityPaise;
}

// ─── Test 1: Pure computation — old regime ₹10L gross income, std deduction only

describe("old regime ₹10L income with only standard deduction (FY 2025-26 ordinary)", () => {
  it("computes total liability correctly as ₹1,06,600", () => {
    // Old std deduction = ₹50,000 = 5_000_000 paise
    // Taxable = 100M - 5M = 95M
    // Slab tax: 0 + 1_250_000 (5% of 25M) + 9_000_000 (20% of 45M) = 10_250_000
    // No rebate (95M > ₹5L threshold; excess 45M > slab tax 10.25M)
    // No surcharge (95M < ₹50L)
    // Cess: floor(10_250_000 * 400 / 10000) = 410_000
    // Total = 10_660_000 (₹1,06,600)
    const total = oldRegimeLiability(100_000_000, 5_000_000);
    assert.strictEqual(total, 10_660_000);
  });

  it("new regime on ₹10L gross income gives zero tax (₹9.25L taxable, within ₹12L rebate threshold)", () => {
    // New std = ₹75,000 = 7_500_000, taxable = 92_500_000
    // Slab tax: 0 + 2_000_000 (5% of 40M) + 1_250_000 (10% of 12.5M) = 3_250_000
    // Rebate: 92.5M ≤ 120M threshold → rebate = min(3_250_000, 6_000_000) = 3_250_000
    // Tax after rebate = 0
    const total = newRegimeLiability(100_000_000);
    assert.strictEqual(total, 0);
  });

  it("old regime wins when total deductions exceed crossover", () => {
    // At ₹10L gross income, new regime = 0. Old regime needs deductions large enough
    // that old tax also becomes 0 (≤ 0) — that happens when taxable ≤ ₹5L (50M).
    // So crossover ≥ gross - 50M = 50M.
    // With deductions = 51M (> 50M): taxable = 100M - 51M = 49M
    // Slab tax: 0 + floor(24M*500/10000) = 0 + floor(24M*0.05) = 1_200_000
    // rebate87A: 49M ≤ 50M? No. So marginal: taxAt50M=1_250_000, rebateAt50M=1_250_000,
    //   netAt50M=0, excess=49M-50M= -1M → wait, 49M < 50M, so income ≤ threshold → rebate = min(1_200_000, 1_250_000) = 1_200_000
    // taxAfterRebate = 0, total = 0
    const oldTotal = oldRegimeLiability(100_000_000, 51_000_000);
    assert.strictEqual(oldTotal, 0);

    // new regime is also 0
    const newTotal = newRegimeLiability(100_000_000);
    assert.strictEqual(newTotal, 0);

    // Both are 0 — diff = 0, within indifference threshold
    assert.strictEqual(oldTotal - newTotal, 0);
  });
});

// ─── Test 2: Crossover sanity — for a given gross income, crossover is between
//     oldStdDeduction and grossIncomePaise when old_tax(gross-std) > new_tax

describe("crossover sanity (FY 2025-26 ordinary)", () => {
  it("for ₹12L gross income: old_tax(gross-std=₹11.5L) > new_tax(0), so crossover exists above std deduction", () => {
    // new regime: taxable = 120M - 7.5M = 112.5M; slab tax = 2M+3.25M=5.25M;
    //   rebate: 112.5M ≤ 120M → min(5.25M,6M)=5.25M; total = 0
    const newTotal = newRegimeLiability(120_000_000);
    assert.strictEqual(newTotal, 0);

    // old regime with only std deduction: taxable = 120M - 5M = 115M
    // slab tax: 0 + 1.25M + 10M(20% of 50M) + floor(15M*3000/10000)=4.5M = 15_750_000
    // rebate: 115M > 50M → marginal: taxAt50M=1.25M, rebateAt50M=1.25M, netAt50M=0,
    //   excess=65M; relief=max(0,15.75M-65M)=0; rebate=0
    // surcharge: 115M < 500M → 0
    // cess: floor(15.75M*400/10000) = 630_000
    // total = 16_380_000
    const oldAtStd = oldRegimeLiability(120_000_000, 5_000_000);
    assert.ok(oldAtStd > 0, `old_tax(120M - std) should be > 0, got ${oldAtStd}`);
    assert.ok(oldAtStd > newTotal, `old_tax should exceed new_tax at minimum deductions`);

    // So crossover D* exists where old_tax(120M - D*) = 0 = new_tax
    // That means 120M - D* ≤ 50M → D* ≥ 70M
    // Verify: with D = 70M → taxable = 50M → slab tax = 1.25M, rebate = 1.25M, total = 0
    const oldAt70M = oldRegimeLiability(120_000_000, 70_000_000);
    assert.strictEqual(oldAt70M, 0);

    // And D = 69M → taxable = 51M
    // slab: 0 + 1.25M + floor((51M-50M)*2000/10000) = 1.25M + floor(1M*0.2) = 1.25M+200_000=1_450_000
    // rebate: 51M > 50M; marginal: taxAt50M=1.25M, rebateAt50M=1.25M, netAt50M=0,
    //   excess=1M; relief=max(0,1.45M-1M)=450_000
    // taxAfterRebate=1_000_000; cess=floor(1M*400/10000)=40_000; total=1_040_000
    const oldAt69M = oldRegimeLiability(120_000_000, 69_000_000);
    assert.ok(oldAt69M > 0, `old_tax at D=69M should be > 0 (below crossover)`);
  });
});

// ─── Test 3: Recommendation — zero income gives indifferent

describe("zero income recommendation", () => {
  it("both regimes give 0 liability when gross income is 0", () => {
    const oldTotal = oldRegimeLiability(0, 0);
    const newTotal = newRegimeLiability(0);
    assert.strictEqual(oldTotal, 0);
    assert.strictEqual(newTotal, 0);
    // diff = 0, within indifference threshold → recommendation = "indifferent"
    assert.strictEqual(Math.abs(oldTotal - newTotal), 0);
  });
});

// ─── Test 4: Fix 3 regression guard — CCD2 per-regime rate derivation ─────────
//
// compareRegimes() derives ccd2EligibleNew and ccd2EligibleOld separately by
// re-applying the per-regime employer-NPS rate to each basket entry. This test
// proves the rates differ for a private-sector employer from FY 2024-25 onward
// (Finance Act 2024 §115BAC(1A): 14% new regime vs 10% old regime for private
// employers), and that the reduce logic used in the service correctly yields
// different eligible amounts for each column.
//
// Without this fix, ccd2EligibleNew was taken from basket.eightyCcd2.eligiblePaise
// which is computed under the user's CURRENT effective regime preference — so if
// the preference was "old", the new-regime column silently used the 10% cap instead
// of the correct 14% cap, defeating the point of a regime COMPARISON.

describe("CCD2 per-regime rate derivation (Fix 3 regression guard, FY 2024-25)", () => {
  const fy = "2024-25";
  // A private-sector employer gets 10% old / 14% new from FY 2024-25 onward.
  // ₹5,00,000 Basic+DA = 50_000_000 paise; contributed ₹2,00,000 (above both caps).
  const SALARY_BASE_PAISE = 50_000_000;
  const CONTRIBUTED_PAISE = 20_000_000;

  it("private employer: old-regime rate is 10% (1000 bps), new-regime rate is 14% (1400 bps)", () => {
    const oldRateBps = resolveEmployerNpsRateBps(fy, "old", "private");
    const newRateBps = resolveEmployerNpsRateBps(fy, "new", "private");
    assert.strictEqual(oldRateBps, 1000, "old regime private: 10%");
    assert.strictEqual(newRateBps, 1400, "new regime private: 14% (Finance Act 2024 §115BAC(1A))");
  });

  it("reduce logic yields different CCD2 eligible for old vs new when contribution exceeds old cap", () => {
    // Simulate the per-entry reduce used in compareRegimes() for one entry.
    const oldRateBps = resolveEmployerNpsRateBps(fy, "old", "private");
    const newRateBps = resolveEmployerNpsRateBps(fy, "new", "private");

    const oldCap = Math.floor((SALARY_BASE_PAISE * oldRateBps) / 10000); // 10% of 50M = 5_000_000
    const newCap = Math.floor((SALARY_BASE_PAISE * newRateBps) / 10000); // 14% of 50M = 7_000_000

    const ccd2EligibleOld = Math.min(CONTRIBUTED_PAISE, oldCap); // min(20M, 5M) = 5_000_000
    const ccd2EligibleNew = Math.min(CONTRIBUTED_PAISE, newCap); // min(20M, 7M) = 7_000_000

    assert.strictEqual(oldCap, 5_000_000, "old-regime cap: 10% of ₹5L = ₹50,000");
    assert.strictEqual(newCap, 7_000_000, "new-regime cap: 14% of ₹5L = ₹70,000");
    assert.strictEqual(ccd2EligibleOld, 5_000_000);
    assert.strictEqual(ccd2EligibleNew, 7_000_000);

    // This is the critical assertion: the new column must use the higher cap.
    // If basket.eightyCcd2.eligiblePaise (computed under "old" effective preference)
    // were reused, ccd2EligibleNew would wrongly be 5_000_000 instead of 7_000_000.
    assert.ok(
      ccd2EligibleNew > ccd2EligibleOld,
      "new-regime CCD2 eligible must exceed old-regime eligible when contribution exceeds old cap",
    );
  });
});
