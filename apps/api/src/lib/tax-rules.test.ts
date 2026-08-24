/**
 * tax-rules.test.ts — unit tests for lib/tax-rules.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getRegimeRules,
  getDeductionCap,
  getAdvanceTaxSchedule,
  coveredFys,
  resolveEmployerNpsRateBps,
  PREVENTIVE_CHECKUP_SUBLIMIT_PAISE,
} from "./tax-rules.ts";

const L = 100_000 * 100;   // 1 lakh in paise
const CR = 10_000_000 * 100; // 1 crore in paise

// ─── getRegimeRules ───────────────────────────────────────────────────────────

test("getRegimeRules: throws on unknown FY", () => {
  assert.throws(() => getRegimeRules("2020-21", "new"), /no rules found.*2020-21/);
  assert.throws(() => getRegimeRules("2030-31", "old"), /no rules found.*2030-31/);
});

test("getRegimeRules: throws on invalid FY format", () => {
  assert.throws(() => getRegimeRules("2025-2026", "new"), /invalid FY label/);
  assert.throws(() => getRegimeRules("bad", "old"), /invalid FY label/);
});

test("getRegimeRules: FY 2025-26 new regime has correct slabs (7 slabs) — statute-faithful inclusive uppers", () => {
  const rules = getRegimeRules("2025-26", "new");
  assert.equal(rules.fy, "2025-26");
  assert.equal(rules.regime, "new");
  assert.equal(rules.slabs.length, 7);

  // 0 to ₹4L: nil — upper is ₹4L exactly (inclusive)
  assert.equal(rules.slabs[0]!.lowerPaise, 0);
  assert.equal(rules.slabs[0]!.upperPaise, L * 4);
  assert.equal(rules.slabs[0]!.rateBps, 0);

  // ₹4L+1 to ₹8L: 5%
  assert.equal(rules.slabs[1]!.lowerPaise, L * 4 + 1);
  assert.equal(rules.slabs[1]!.upperPaise, L * 8);
  assert.equal(rules.slabs[1]!.rateBps, 500);

  // ₹8L+1 to ₹12L: 10%
  assert.equal(rules.slabs[2]!.lowerPaise, L * 8 + 1);
  assert.equal(rules.slabs[2]!.upperPaise, L * 12);
  assert.equal(rules.slabs[2]!.rateBps, 1000);

  // ₹12L+1 to ₹16L: 15%
  assert.equal(rules.slabs[3]!.lowerPaise, L * 12 + 1);
  assert.equal(rules.slabs[3]!.upperPaise, L * 16);
  assert.equal(rules.slabs[3]!.rateBps, 1500);

  // ₹16L+1 to ₹20L: 20%
  assert.equal(rules.slabs[4]!.lowerPaise, L * 16 + 1);
  assert.equal(rules.slabs[4]!.upperPaise, L * 20);
  assert.equal(rules.slabs[4]!.rateBps, 2000);

  // ₹20L+1 to ₹24L: 25%
  assert.equal(rules.slabs[5]!.lowerPaise, L * 20 + 1);
  assert.equal(rules.slabs[5]!.upperPaise, L * 24);
  assert.equal(rules.slabs[5]!.rateBps, 2500);

  // >₹24L: 30%
  assert.equal(rules.slabs[6]!.lowerPaise, L * 24 + 1);
  assert.equal(rules.slabs[6]!.upperPaise, null);
  assert.equal(rules.slabs[6]!.rateBps, 3000);
});

test("getRegimeRules: FY 2025-26 new regime standard deduction ₹75,000", () => {
  const rules = getRegimeRules("2025-26", "new");
  assert.equal(rules.standardDeductionPaise, 7_500_000);  // ₹75,000 in paise
});

test("getRegimeRules: FY 2025-26 new regime rebate 87A — ₹60,000 up to ₹12L income", () => {
  const rules = getRegimeRules("2025-26", "new");
  assert.ok(rules.rebate87A !== null);
  assert.equal(rules.rebate87A!.thresholdPaise, L * 12);   // ₹12L
  assert.equal(rules.rebate87A!.maxReliefPaise, 6_000_000); // ₹60,000
});

test("getRegimeRules: FY 2025-26 old regime ordinary has correct slabs (4 slabs) — statute-faithful inclusive uppers", () => {
  const rules = getRegimeRules("2025-26", "old");
  assert.equal(rules.slabs.length, 4);

  // 0 to ₹2.5L: nil — upper = ₹2.5L exactly
  assert.equal(rules.slabs[0]!.lowerPaise, 0);
  assert.equal(rules.slabs[0]!.upperPaise, L * 2.5);
  assert.equal(rules.slabs[0]!.rateBps, 0);

  // ₹2.5L+1 to ₹5L: 5%
  assert.equal(rules.slabs[1]!.lowerPaise, L * 2.5 + 1);
  assert.equal(rules.slabs[1]!.upperPaise, L * 5);
  assert.equal(rules.slabs[1]!.rateBps, 500);

  // ₹5L+1 to ₹10L: 20%
  assert.equal(rules.slabs[2]!.lowerPaise, L * 5 + 1);
  assert.equal(rules.slabs[2]!.upperPaise, L * 10);
  assert.equal(rules.slabs[2]!.rateBps, 2000);

  // >₹10L: 30%
  assert.equal(rules.slabs[3]!.lowerPaise, L * 10 + 1);
  assert.equal(rules.slabs[3]!.upperPaise, null);
  assert.equal(rules.slabs[3]!.rateBps, 3000);
});

test("getRegimeRules: FY 2025-26 old regime standard deduction ₹50,000", () => {
  const rules = getRegimeRules("2025-26", "old");
  assert.equal(rules.standardDeductionPaise, 5_000_000);  // ₹50,000
});

test("getRegimeRules: FY 2025-26 old regime rebate 87A — ₹12,500 up to ₹5L income", () => {
  const rules = getRegimeRules("2025-26", "old");
  assert.ok(rules.rebate87A !== null);
  assert.equal(rules.rebate87A!.thresholdPaise, L * 5);   // ₹5L
  assert.equal(rules.rebate87A!.maxReliefPaise, 1_250_000); // ₹12,500
});

test("getRegimeRules: cess is 400 bps (4%) for all regimes and FYs", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    assert.equal(getRegimeRules(fy, "old").cessBps, 400, `old regime ${fy} cess`);
    assert.equal(getRegimeRules(fy, "new").cessBps, 400, `new regime ${fy} cess`);
  }
});

test("getRegimeRules: marginalRelief is true for all regimes and FYs", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    assert.equal(getRegimeRules(fy, "old").marginalRelief, true);
    assert.equal(getRegimeRules(fy, "new").marginalRelief, true);
  }
});

test("getRegimeRules: FY 2023-24 new regime slabs start at 3L (revised by Finance Act 2023)", () => {
  const rules = getRegimeRules("2023-24", "new");
  // First slab: 0-3L nil (upper = lakh(3) inclusive)
  assert.equal(rules.slabs[0]!.upperPaise, L * 3);
  // Second slab: 3L+1 to 6L at 5%
  assert.equal(rules.slabs[1]!.lowerPaise, L * 3 + 1);
  assert.equal(rules.slabs[1]!.rateBps, 500);
});

test("getRegimeRules: FY 2024-25 new regime standard deduction ₹75,000", () => {
  const rules = getRegimeRules("2024-25", "new");
  assert.equal(rules.standardDeductionPaise, 7_500_000);
});

test("getRegimeRules: old regime surcharge — nil band ends at ₹50L (inclusive), 10% above ₹50L", () => {
  const rules = getRegimeRules("2025-26", "old");
  // Nil band upper = ₹50L exactly
  assert.equal(rules.surchargeSlabs[0]!.upperPaise, CR * 0.5);
  assert.equal(rules.surchargeSlabs[0]!.rateBps, 0);
  // Next band starts at ₹50L + 1 paise
  assert.equal(rules.surchargeSlabs[1]!.lowerPaise, CR * 0.5 + 1);
  assert.equal(rules.surchargeSlabs[1]!.rateBps, 1000);
});

test("getRegimeRules: old regime surcharge has 37% for income >5 crore", () => {
  const rules = getRegimeRules("2025-26", "old");
  const topSlab = rules.surchargeSlabs[rules.surchargeSlabs.length - 1]!;
  assert.equal(topSlab.rateBps, 3700);  // 37%
  assert.equal(topSlab.upperPaise, null);
});

test("getRegimeRules: new regime surcharge capped at 25% (no 37% band)", () => {
  const rules = getRegimeRules("2025-26", "new");
  const topSlab = rules.surchargeSlabs[rules.surchargeSlabs.length - 1]!;
  assert.equal(topSlab.rateBps, 2500);  // 25% max
});

// ─── G1: Taxpayer-type variants ───────────────────────────────────────────────

test("getRegimeRules: old regime ordinary defaults when taxpayerType not specified", () => {
  const rules = getRegimeRules("2025-26", "old");  // default = 'ordinary'
  assert.equal(rules.taxpayerType, "ordinary");
  assert.equal(rules.slabs[0]!.upperPaise, L * 2.5);  // ₹2.5L exemption
});

test("getRegimeRules: old regime senior citizen has ₹3L basic exemption (first slab upper = ₹3L)", () => {
  const rules = getRegimeRules("2025-26", "old", "senior");
  assert.equal(rules.taxpayerType, "senior");
  assert.equal(rules.slabs[0]!.lowerPaise, 0);
  assert.equal(rules.slabs[0]!.upperPaise, L * 3);   // ₹3L inclusive
  assert.equal(rules.slabs[0]!.rateBps, 0);
  // 5% slab: ₹3L+1 to ₹5L
  assert.equal(rules.slabs[1]!.lowerPaise, L * 3 + 1);
  assert.equal(rules.slabs[1]!.upperPaise, L * 5);
  assert.equal(rules.slabs[1]!.rateBps, 500);
  assert.equal(rules.slabs.length, 4);
});

test("getRegimeRules: old regime super-senior citizen has ₹5L basic exemption (no 5% slab)", () => {
  const rules = getRegimeRules("2025-26", "old", "super_senior");
  assert.equal(rules.taxpayerType, "super_senior");
  assert.equal(rules.slabs[0]!.lowerPaise, 0);
  assert.equal(rules.slabs[0]!.upperPaise, L * 5);   // ₹5L inclusive
  assert.equal(rules.slabs[0]!.rateBps, 0);
  // No 5% slab — directly 20% from ₹5L+1
  assert.equal(rules.slabs[1]!.lowerPaise, L * 5 + 1);
  assert.equal(rules.slabs[1]!.upperPaise, L * 10);
  assert.equal(rules.slabs[1]!.rateBps, 2000);
  assert.equal(rules.slabs.length, 3);
});

test("getRegimeRules: new regime ignores taxpayerType — senior maps to ordinary slabs", () => {
  const ordinary = getRegimeRules("2025-26", "new", "ordinary");
  const senior    = getRegimeRules("2025-26", "new", "senior");
  const superSr   = getRegimeRules("2025-26", "new", "super_senior");
  // All three should have the same slabs (same number and same first slab)
  assert.equal(senior.slabs.length, ordinary.slabs.length);
  assert.equal(superSr.slabs.length, ordinary.slabs.length);
  assert.equal(senior.slabs[0]!.upperPaise, ordinary.slabs[0]!.upperPaise);
  assert.equal(superSr.slabs[0]!.upperPaise, ordinary.slabs[0]!.upperPaise);
  // taxpayerType in returned object is 'ordinary' for new regime
  assert.equal(senior.taxpayerType, "ordinary");
  assert.equal(superSr.taxpayerType, "ordinary");
});

test("getRegimeRules: old regime senior variants present for all covered FYs", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    const senior   = getRegimeRules(fy, "old", "senior");
    const superSr  = getRegimeRules(fy, "old", "super_senior");
    assert.equal(senior.slabs[0]!.upperPaise, L * 3, `${fy} senior first-slab upper`);
    assert.equal(superSr.slabs[0]!.upperPaise, L * 5, `${fy} super-senior first-slab upper`);
  }
});

// ─── getDeductionCap ─────────────────────────────────────────────────────────

test("getDeductionCap: 80C cap is ₹1.5L for old regime", () => {
  const caps = getDeductionCap("80C", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.regime, "old");
  assert.equal(caps[0]!.capPaise, 15_000_000);  // ₹1,50,000
});

test("getDeductionCap: 80CCD(1B) cap is ₹50,000 for old regime", () => {
  const caps = getDeductionCap("80CCD(1B)", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.regime, "old");
  assert.equal(caps[0]!.capPaise, 5_000_000);  // ₹50,000
});

test("getDeductionCap: 80CCD(2) FY25-26 old regime — 10% private, 14% govt", () => {
  const caps = getDeductionCap("80CCD(2)", "2025-26");
  const oldCap = caps.find((c) => c.regime === "old");
  assert.ok(oldCap, "should have old regime entry");
  assert.equal(oldCap!.capPaise, 0);
  assert.ok(oldCap!.employerRatesBps, "should have employerRatesBps");
  const privateRate = oldCap!.employerRatesBps!.find((r) => r.employerType === "private");
  const govtRate    = oldCap!.employerRatesBps!.find((r) => r.employerType === "government");
  assert.equal(privateRate!.rateBpsOfBasic, 1000, "old regime private 10%");
  assert.equal(govtRate!.rateBpsOfBasic, 1400, "old regime govt 14%");
});

test("getDeductionCap: 80CCD(2) FY25-26 new regime — 14% for ALL employers (Finance Act 2024 §115BAC(1A))", () => {
  const caps = getDeductionCap("80CCD(2)", "2025-26");
  const newCap = caps.find((c) => c.regime === "new");
  assert.ok(newCap, "should have new regime entry");
  assert.equal(newCap!.capPaise, 0);
  assert.ok(newCap!.employerRatesBps);
  const privateRate = newCap!.employerRatesBps!.find((r) => r.employerType === "private");
  const govtRate    = newCap!.employerRatesBps!.find((r) => r.employerType === "government");
  assert.equal(privateRate!.rateBpsOfBasic, 1400, "new regime FY25-26 private 14%");
  assert.equal(govtRate!.rateBpsOfBasic, 1400, "new regime FY25-26 govt 14%");
});

test("getDeductionCap: 80CCD(2) FY23-24 new regime — still 10% private (Finance Act 2024 not yet effective)", () => {
  const caps = getDeductionCap("80CCD(2)", "2023-24");
  const newCap = caps.find((c) => c.regime === "new");
  assert.ok(newCap);
  const privateRate = newCap!.employerRatesBps!.find((r) => r.employerType === "private");
  assert.equal(privateRate!.rateBpsOfBasic, 1000, "new regime FY23-24 private still 10%");
});

test("getDeductionCap: 80CCD(2) returns 2 entries (old + new) for each covered FY", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    const caps = getDeductionCap("80CCD(2)", fy);
    assert.equal(caps.length, 2, `${fy} should have 2 entries (old + new)`);
  }
});

test("getDeductionCap: 80D_self cap is ₹25,000 (non-senior)", () => {
  const caps = getDeductionCap("80D_self", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.capPaise, 2_500_000);  // ₹25,000
  assert.equal(caps[0]!.regime, "old");
});

test("getDeductionCap: 80D_self_senior cap is ₹50,000 (senior taxpayer)", () => {
  const caps = getDeductionCap("80D_self_senior", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.capPaise, 5_000_000);  // ₹50,000
  assert.equal(caps[0]!.regime, "old");
});

test("getDeductionCap: 80D_parents cap is ₹25,000 (non-senior parents)", () => {
  const caps = getDeductionCap("80D_parents", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.capPaise, 2_500_000);  // ₹25,000
  assert.equal(caps[0]!.regime, "old");
});

test("getDeductionCap: 80D_parents_senior cap is ₹50,000 (senior-citizen parents)", () => {
  const caps = getDeductionCap("80D_parents_senior", "2025-26");
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.capPaise, 5_000_000);  // ₹50,000
});

test("getDeductionCap: returns empty array for unknown section within covered FY", () => {
  const caps = getDeductionCap("80XYZ", "2025-26");
  assert.deepEqual(caps, []);
});

test("getDeductionCap: throws on invalid FY label", () => {
  assert.throws(() => getDeductionCap("80C", "bad-fy"), /invalid FY label/);
});

test("getDeductionCap: throws for uncovered FY (e.g. 2030-31)", () => {
  assert.throws(() => getDeductionCap("80C", "2030-31"), /not in the covered deduction-cap/);
  assert.throws(() => getDeductionCap("80C", "2019-20"), /not in the covered deduction-cap/);
});

// ─── getAdvanceTaxSchedule ───────────────────────────────────────────────────

test("getAdvanceTaxSchedule: 4 instalments with correct cumulative percentages", () => {
  const sched = getAdvanceTaxSchedule("2025-26");
  assert.equal(sched.instalments.length, 4);
  assert.equal(sched.instalments[0]!.cumulativePct, 15);
  assert.equal(sched.instalments[1]!.cumulativePct, 45);
  assert.equal(sched.instalments[2]!.cumulativePct, 75);
  assert.equal(sched.instalments[3]!.cumulativePct, 100);
});

test("getAdvanceTaxSchedule: FY 2025-26 due dates are correct", () => {
  const sched = getAdvanceTaxSchedule("2025-26");
  assert.equal(sched.instalments[0]!.dueDate, "2025-06-15");
  assert.equal(sched.instalments[1]!.dueDate, "2025-09-15");
  assert.equal(sched.instalments[2]!.dueDate, "2025-12-15");
  assert.equal(sched.instalments[3]!.dueDate, "2026-03-15");
});

test("getAdvanceTaxSchedule: interest rate is 100 bps/month (1%) for 234B/234C", () => {
  const sched = getAdvanceTaxSchedule("2025-26");
  assert.equal(sched.interestRateBpsPerMonth, 100);
});

test("getAdvanceTaxSchedule: senior citizens are exempt", () => {
  const sched = getAdvanceTaxSchedule("2025-26");
  assert.equal(sched.seniorCitizenExempt, true);
});

test("getAdvanceTaxSchedule: FY 2023-24 due dates are in the correct year", () => {
  const sched = getAdvanceTaxSchedule("2023-24");
  assert.equal(sched.instalments[0]!.dueDate, "2023-06-15");
  assert.equal(sched.instalments[3]!.dueDate, "2024-03-15");
});

test("getAdvanceTaxSchedule: throws on unknown FY", () => {
  assert.throws(() => getAdvanceTaxSchedule("2019-20"), /no advance-tax schedule.*2019-20/);
});

test("getAdvanceTaxSchedule: throws on invalid FY format", () => {
  assert.throws(() => getAdvanceTaxSchedule("bad"), /invalid FY label/);
});

// ─── coveredFys ───────────────────────────────────────────────────────────────

test("coveredFys: returns expected FY list sorted", () => {
  const fys = coveredFys();
  assert.deepEqual(fys, ["2023-24", "2024-25", "2025-26", "2026-27"]);
});

// ─── Slab boundary consistency ────────────────────────────────────────────────

test("slab lower/upper boundaries are contiguous — no gaps or overlaps (all regimes, FYs, taxpayer types)", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    for (const [regime, taxpayerType] of [
      ["old", "ordinary"], ["old", "senior"], ["old", "super_senior"], ["new", "ordinary"],
    ] as const) {
      const rules = getRegimeRules(fy, regime, taxpayerType);
      for (let i = 1; i < rules.slabs.length; i++) {
        const prev = rules.slabs[i - 1]!;
        const curr = rules.slabs[i]!;
        assert.equal(
          curr.lowerPaise,
          prev.upperPaise! + 1,
          `${fy} ${regime} ${taxpayerType}: gap/overlap between slab ${i - 1} and ${i}`,
        );
      }
    }
  }
});

test("last slab in each regime+FY+taxpayerType has null upperPaise (no upper bound)", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    for (const [regime, taxpayerType] of [
      ["old", "ordinary"], ["old", "senior"], ["old", "super_senior"], ["new", "ordinary"],
    ] as const) {
      const rules = getRegimeRules(fy, regime, taxpayerType);
      const last = rules.slabs[rules.slabs.length - 1]!;
      assert.equal(last.upperPaise, null, `${fy} ${regime} ${taxpayerType}: last slab should have null upperPaise`);
    }
  }
});

test("surcharge slab boundaries are contiguous for all regimes and FYs", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    for (const regime of ["old", "new"] as const) {
      const rules = getRegimeRules(fy, regime);
      const slabs = rules.surchargeSlabs;
      for (let i = 1; i < slabs.length; i++) {
        const prev = slabs[i - 1]!;
        const curr = slabs[i]!;
        assert.equal(
          curr.lowerPaise,
          prev.upperPaise! + 1,
          `${fy} ${regime} surcharge: gap/overlap between slab ${i - 1} and ${i}`,
        );
      }
    }
  }
});

// ─── resolveEmployerNpsRateBps (task 13.7 Phase 1c) ──────────────────────────

test("resolveEmployerNpsRateBps: old regime — private=1000bps (10%), govt=1400bps (14%) for all FYs", () => {
  for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
    assert.equal(
      resolveEmployerNpsRateBps(fy, "old", "private"),
      1000,
      `${fy} old private should be 1000 bps`,
    );
    assert.equal(
      resolveEmployerNpsRateBps(fy, "old", "government"),
      1400,
      `${fy} old govt should be 1400 bps`,
    );
  }
});

test("resolveEmployerNpsRateBps: new regime FY23-24 — private=1000bps (10%), govt=1400bps (14%)", () => {
  // Finance Act 2024 §115BAC(1A) was not yet in effect for FY 2023-24.
  assert.equal(resolveEmployerNpsRateBps("2023-24", "new", "private"), 1000);
  assert.equal(resolveEmployerNpsRateBps("2023-24", "new", "government"), 1400);
});

test("resolveEmployerNpsRateBps: new regime FY24-25+ — 14% for ALL employers (Finance Act 2024 §115BAC(1A))", () => {
  for (const fy of ["2024-25", "2025-26", "2026-27"]) {
    assert.equal(
      resolveEmployerNpsRateBps(fy, "new", "private"),
      1400,
      `${fy} new private should be 1400 bps after Finance Act 2024`,
    );
    assert.equal(
      resolveEmployerNpsRateBps(fy, "new", "government"),
      1400,
      `${fy} new govt should be 1400 bps`,
    );
  }
});

test("resolveEmployerNpsRateBps: boundary year FY23-24 vs FY24-25 — private rate changes from 1000 to 1400 in new regime", () => {
  // Explicitly assert the boundary that changed with Finance Act 2024.
  assert.equal(resolveEmployerNpsRateBps("2023-24", "new", "private"), 1000, "FY23-24 new private = 1000");
  assert.equal(resolveEmployerNpsRateBps("2024-25", "new", "private"), 1400, "FY24-25 new private = 1400");
});

test("resolveEmployerNpsRateBps: throws on unknown FY", () => {
  assert.throws(
    () => resolveEmployerNpsRateBps("2020-21", "old", "private"),
    /not in the covered deduction-cap data set/,
  );
});

// ─── PREVENTIVE_CHECKUP_SUBLIMIT_PAISE (task 13.7 Phase 1c) ──────────────────

test("PREVENTIVE_CHECKUP_SUBLIMIT_PAISE is ₹5,000 (500_000 paise)", () => {
  assert.equal(PREVENTIVE_CHECKUP_SUBLIMIT_PAISE, 500_000);
});
