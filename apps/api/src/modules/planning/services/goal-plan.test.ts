import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGoalPlan, equityShareOfInvestable, targetAllocation } from "./goal-plan.ts";

test("equityShareOfInvestable ignores 'other' assets", () => {
  assert.equal(equityShareOfInvestable(60, 40), 60); // no other
  assert.equal(equityShareOfInvestable(30, 20), 60); // 50% other diluting a 60/40 mix
  assert.equal(equityShareOfInvestable(0, 0), 0); // all other → no investable base
});

test("glide path: more equity the further the target date", () => {
  assert.deepEqual(targetAllocation("home", 12 * 12), { equityPct: 75, debtPct: 25 }); // 12y
  assert.deepEqual(targetAllocation("home", 8 * 12), { equityPct: 70, debtPct: 30 }); // 8y
  assert.deepEqual(targetAllocation("home", 6 * 12), { equityPct: 60, debtPct: 40 }); // 6y
  assert.deepEqual(targetAllocation("home", 4 * 12), { equityPct: 40, debtPct: 60 }); // 4y
  assert.deepEqual(targetAllocation("home", 2 * 12), { equityPct: 20, debtPct: 80 }); // 2y
  assert.deepEqual(targetAllocation("home", 6), { equityPct: 0, debtPct: 100 }); // <1y
});

test("emergency funds stay fully liquid regardless of horizon", () => {
  assert.deepEqual(targetAllocation("emergency_fund", 12 * 12), { equityPct: 0, debtPct: 100 });
});

test("an undated goal gets a balanced default", () => {
  assert.deepEqual(targetAllocation("vacation", null), { equityPct: 60, debtPct: 40 });
});

test("behind goal proposes a contribution split to the target mix", () => {
  const plan = buildGoalPlan({
    goalType: "retirement",
    monthsToTarget: 20 * 12, // long horizon → 75/25
    onTrack: false,
    requiredMonthlyPaise: 10_000_00, // ₹10,000
    currentEquityPct: 100,
    currentDebtPct: 0,
    currentOtherPct: 0,
    fundedPaise: 5_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.status, "behind");
  assert.equal(plan.targetEquityPct, 75);
  assert.equal(plan.monthlyEquityPaise, 7_500_00); // 75% of ₹10,000
  assert.equal(plan.monthlyDebtPaise, 2_500_00); // remainder
  // equity + debt split reconciles exactly to the required amount
  assert.equal(plan.monthlyEquityPaise + plan.monthlyDebtPaise, plan.recommendedMonthlyPaise);
});

test("on-track goal within the band is not flagged as drifted", () => {
  const plan = buildGoalPlan({
    goalType: "home",
    monthsToTarget: 6 * 12, // 60/40
    onTrack: true,
    requiredMonthlyPaise: 0,
    currentEquityPct: 65, // 65/35 invested → 65% of investable, 5pp from target 60
    currentDebtPct: 35,
    currentOtherPct: 0,
    fundedPaise: 10_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.status, "on_track");
  assert.equal(plan.allocationDrifted, false);
  assert.equal(plan.monthlyEquityPaise, 0);
});

test("a funded goal whose mix drifts beyond the band is flagged", () => {
  const plan = buildGoalPlan({
    goalType: "home",
    monthsToTarget: 6 * 12, // target 60% equity
    onTrack: true,
    requiredMonthlyPaise: 0,
    currentEquityPct: 90, // 90/10 invested → 90% equity, 30pp over target
    currentDebtPct: 10,
    currentOtherPct: 0,
    fundedPaise: 10_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.allocationDrifted, true);
});

test("a cash buffer alongside a balanced core does not fabricate a warning", () => {
  // A correctly balanced 60/40 equity/debt core plus a 50% cash buffer: over all
  // assets that's 30% equity / 20% debt / 50% other. Equity is still 60% of the
  // equity+debt portion (= target) and "other" is not a majority — no drift.
  const plan = buildGoalPlan({
    goalType: "home",
    monthsToTarget: 6 * 12, // target 60% equity
    onTrack: true,
    requiredMonthlyPaise: 0,
    currentEquityPct: 30,
    currentDebtPct: 20,
    currentOtherPct: 50,
    fundedPaise: 10_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.allocationDrifted, false);
});

test("a mid/long goal parked mostly in cash is flagged even when its slice matches", () => {
  // 3% equity / 1% debt / 96% cash: the invested slice is a perfect 75/25, so the
  // ratio check passes — but 96% of a goal that should hold equity is uninvested.
  const plan = buildGoalPlan({
    goalType: "retirement",
    monthsToTarget: 20 * 12, // target 75% equity
    onTrack: true,
    requiredMonthlyPaise: 0,
    currentEquityPct: 3,
    currentDebtPct: 1,
    currentOtherPct: 96,
    fundedPaise: 10_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.allocationDrifted, true);
});

test("an emergency fund fully in cash is NOT flagged (cash is the right place)", () => {
  const plan = buildGoalPlan({
    goalType: "emergency_fund", // target 0% equity → 'other' check disabled
    monthsToTarget: 5 * 12,
    onTrack: true,
    requiredMonthlyPaise: 0,
    currentEquityPct: 0,
    currentDebtPct: 0,
    currentOtherPct: 100,
    fundedPaise: 10_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.allocationDrifted, false);
});

test("an empty goal does not 'drift' — it just needs funding", () => {
  const plan = buildGoalPlan({
    goalType: "home",
    monthsToTarget: 6 * 12,
    onTrack: false,
    requiredMonthlyPaise: 5_000_00,
    currentEquityPct: 0,
    currentDebtPct: 0,
    currentOtherPct: 0,
    fundedPaise: 0,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.allocationDrifted, false);
});

test("undated goal → no_target status, null recommendation", () => {
  const plan = buildGoalPlan({
    goalType: "custom",
    monthsToTarget: null,
    onTrack: null,
    requiredMonthlyPaise: null,
    currentEquityPct: 50,
    currentDebtPct: 50,
    currentOtherPct: 0,
    fundedPaise: 1_00_000_00,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.status, "no_target");
  assert.equal(plan.recommendedMonthlyPaise, null);
  assert.equal(plan.monthlyEquityPaise, 0);
  assert.equal(plan.monthlyDebtPaise, 0);
});

test("committed SIPs partially cover the recommendation → per-leg gap", () => {
  const plan = buildGoalPlan({
    goalType: "retirement",
    monthsToTarget: 20 * 12, // 75/25
    onTrack: false,
    requiredMonthlyPaise: 10_000_00, // needs 7,500 equity + 2,500 debt
    currentEquityPct: 100,
    currentDebtPct: 0,
    currentOtherPct: 0,
    fundedPaise: 5_00_000_00,
    committedEquityPaise: 3_000_00, // an equity SIP covering part of it
    committedDebtPaise: 4_000_00, // a debt SIP that overshoots its leg
  });
  assert.equal(plan.committedMonthlyPaise, 7_000_00);
  assert.equal(plan.gapEquityPaise, 4_500_00); // 7,500 − 3,000
  assert.equal(plan.gapDebtPaise, 0); // over-committed leg floors at 0, not negative
  assert.equal(plan.gapMonthlyPaise, 4_500_00);
});

test("no SIPs → the whole recommendation is the gap", () => {
  const plan = buildGoalPlan({
    goalType: "home",
    monthsToTarget: 6 * 12,
    onTrack: false,
    requiredMonthlyPaise: 5_000_00,
    currentEquityPct: 0,
    currentDebtPct: 0,
    currentOtherPct: 0,
    fundedPaise: 0,
    committedEquityPaise: 0,
    committedDebtPaise: 0,
  });
  assert.equal(plan.committedMonthlyPaise, 0);
  assert.equal(plan.gapMonthlyPaise, plan.recommendedMonthlyPaise);
});
