import { test } from "node:test";
import assert from "node:assert/strict";
import { projectGoal } from "./goal-projection.ts";

test("funded value and blended return are value-weighted over earning assets", () => {
  const r = projectGoal({
    assets: [
      { valuePaise: 100_000, annualReturnBps: 700 }, // ₹1,000 @ 7%
      { valuePaise: 300_000, annualReturnBps: 1200 }, // ₹3,000 @ 12%
    ],
    targetPaise: 1_000_000,
    monthsToTarget: null,
    monthlyInflowPaise: 0,
  });
  assert.equal(r.fundedPaise, 400_000);
  // (100000*700 + 300000*1200) / 400000 = 1075 bps
  assert.equal(r.blendedReturnBps, 1075);
});

test("growth makes the projected value exceed a flat sum of contributions", () => {
  const withGrowth = projectGoal({
    assets: [{ valuePaise: 1_000_000, annualReturnBps: 1200 }],
    targetPaise: 5_000_000,
    monthsToTarget: 120, // 10 years
    monthlyInflowPaise: 10_000, // ₹100/mo
  });
  const flatSum = 1_000_000 + 10_000 * 120; // no growth at all
  assert.ok(withGrowth.projectedValuePaise !== null);
  assert.ok(withGrowth.projectedValuePaise! > flatSum, "growth should beat the flat sum");
  // 10L compounding at 12% for 10y ≈ 31L; inflow carries it past the ₹50L target.
  assert.equal(withGrowth.onTrack, true);
  assert.ok(withGrowth.shortfallPaise! < 0, "ahead of target ⇒ negative shortfall");
  // Corpus alone (~31L) is short of target, so a monthly is still required — but
  // below the ₹100/mo actually being contributed, which is why the goal is on track.
  assert.ok(withGrowth.requiredMonthlyPaise! > 0 && withGrowth.requiredMonthlyPaise! < 10_000);
});

test("a PPF-only goal compounds at its stored rate", () => {
  const n = 12;
  const r = projectGoal({
    assets: [{ valuePaise: 1_000_000, annualReturnBps: 710 }],
    targetPaise: 2_000_000,
    monthsToTarget: n,
    monthlyInflowPaise: 0,
  });
  // No inflow: projected = 10L · 1.071 = 10,71,000
  assert.equal(r.projectedValuePaise, 1_071_000);
  assert.equal(r.onTrack, false);
  assert.equal(r.shortfallPaise, 2_000_000 - 1_071_000);
});

test("behind/ahead flips at the boundary via required monthly", () => {
  const base = {
    assets: [{ valuePaise: 0, annualReturnBps: 0 }],
    targetPaise: 120_000,
    monthsToTarget: 12,
  };
  // 0% everywhere, ₹1,000 target over 12 months ⇒ needs exactly 10,000 paise/mo.
  const behind = projectGoal({ ...base, monthlyInflowPaise: 9_000 });
  assert.equal(behind.onTrack, false);
  assert.equal(behind.requiredMonthlyPaise, 10_000);

  const onTrack = projectGoal({ ...base, monthlyInflowPaise: 10_000 });
  assert.equal(onTrack.onTrack, true);
  assert.equal(onTrack.projectedValuePaise, 120_000);
});

test("without a target date, projectedMonths solves for the finish line", () => {
  const r = projectGoal({
    assets: [{ valuePaise: 0, annualReturnBps: 0 }],
    targetPaise: 120_000,
    monthsToTarget: null,
    monthlyInflowPaise: 10_000,
  });
  assert.equal(r.projectedValuePaise, null);
  assert.equal(r.requiredMonthlyPaise, null);
  assert.equal(r.onTrack, null);
  // 0% growth: 120000 / 10000 = 12 months exactly.
  assert.equal(r.projectedMonths, 12);
});

test("already-funded goal reports zero months to reach", () => {
  const r = projectGoal({
    assets: [{ valuePaise: 500_000, annualReturnBps: 1200 }],
    targetPaise: 400_000,
    monthsToTarget: null,
    monthlyInflowPaise: 0,
  });
  assert.equal(r.projectedMonths, 0);
});

test("an unreachable goal (no inflow, no growth, short) reports null months", () => {
  const r = projectGoal({
    assets: [{ valuePaise: 100_000, annualReturnBps: 0 }],
    targetPaise: 500_000,
    monthsToTarget: null,
    monthlyInflowPaise: 0,
  });
  assert.equal(r.projectedMonths, null);
});
