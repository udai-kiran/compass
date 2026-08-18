import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRebalancingPlan,
  CONTRIBUTION_CORRECTION_MONTHS,
  type RebalancingPlanInput,
} from "./rebalancing-plan.ts";
import { buildGlidePathSchedule } from "./goal-plan.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<RebalancingPlanInput> = {}): RebalancingPlanInput {
  return {
    fundedPaise: 10_00_000_00, // ₹10L
    currentEquityPct: 60,
    currentDebtPct: 40,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 0,
    currentDebtSipPaise: 0,
    goalType: "home",
    glideSteps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Drift analysis
// ---------------------------------------------------------------------------

test("no drift when current matches target", () => {
  const plan = buildRebalancingPlan(makeInput());
  assert.equal(plan.drift.overweightLeg, "none");
  assert.equal(plan.drift.driftPaise, 0);
  assert.equal(plan.actions.length, 0);
});

test("equity overweight: correctly identifies drift amount", () => {
  // ₹10L corpus: 80% equity (₹8L), target 60% (₹6L) → drift ₹2L
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
  }));
  assert.equal(plan.drift.overweightLeg, "equity");
  assert.equal(plan.drift.driftPaise, 2_00_000_00); // ₹2L in paise
  assert.equal(plan.drift.equityCurrentPaise, 8_00_000_00);
  assert.equal(plan.drift.equityTargetPaise, 6_00_000_00);
});

test("debt overweight: correctly identifies drift amount", () => {
  // ₹10L corpus: 30% equity (₹3L), target 60% (₹6L) → debt overweight ₹3L
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 30,
    currentDebtPct: 70,
    targetEquityPct: 60,
    targetDebtPct: 40,
  }));
  assert.equal(plan.drift.overweightLeg, "debt");
  assert.equal(plan.drift.driftPaise, 3_00_000_00); // ₹3L
});

// ---------------------------------------------------------------------------
// Correction actions
// ---------------------------------------------------------------------------

test("redirect contributions preferred when closure within 18 months", () => {
  // Equity overweight by ₹2L; existing equity SIPs = ₹20k/month
  // closure = ceil(2_00_000_00 / 20_000_00) = 10 months ≤ 18 → redirect
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 20_000_00, // ₹20k
  }));
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0]!;
  assert.equal(action.type, "redirect_contributions");
  if (action.type === "redirect_contributions") {
    assert.equal(action.fromLeg, "equity");
    assert.equal(action.toLeg, "debt");
    assert.equal(action.monthlyAmountPaise, 20_000_00);
    assert.equal(action.estimatedClosureMonths, 10);
  }
});

test("corpus switch when redirection would take > 18 months", () => {
  // Equity overweight by ₹2L; existing equity SIPs = ₹5k/month
  // closure = ceil(2_00_000_00 / 5_000_00) = 40 months > 18 → switch
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 5_000_00, // ₹5k
  }));
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0]!;
  assert.equal(action.type, "switch_corpus");
  if (action.type === "switch_corpus") {
    assert.equal(action.fromLeg, "equity");
    assert.equal(action.toLeg, "debt");
    assert.equal(action.amountPaise, 2_00_000_00);
  }
});

test("corpus switch when no SIPs to redirect", () => {
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 0,
  }));
  assert.equal(plan.actions[0]?.type, "switch_corpus");
});

test("emergency fund: never produces correction actions even if 'overweight'", () => {
  // An emergency fund should be 0/100; putting 50% in equity is drift, but
  // the emergency fund is exempt from forced actions.
  const plan = buildRebalancingPlan(makeInput({
    goalType: "emergency_fund",
    currentEquityPct: 50,
    currentDebtPct: 50,
    targetEquityPct: 0,
    targetDebtPct: 100,
    currentEquitySipPaise: 10_000_00,
  }));
  assert.equal(plan.actions.length, 0);
});

// ---------------------------------------------------------------------------
// De-risking schedule
// ---------------------------------------------------------------------------

test("empty deRiskingSchedule when no glide steps", () => {
  const plan = buildRebalancingPlan(makeInput({ glideSteps: [] }));
  assert.equal(plan.deRiskingSchedule.length, 0);
});

test("empty deRiskingSchedule when only one glide step", () => {
  const steps = buildGlidePathSchedule({
    goalType: "home", monthsToTarget: 6, // < 12 months → single band, no threshold crossed
    targetPaise: null, fundedPaise: 0, monthlyInflowPaise: 0,
    equityReturnBps: 1200, debtReturnBps: 700,
    today: new Date("2026-08-18"),
  });
  assert.equal(steps.length, 1); // 6 months: 0/100, no threshold crossed
  const plan = buildRebalancingPlan(makeInput({ glideSteps: steps }));
  assert.equal(plan.deRiskingSchedule.length, 0);
});

test("de-risking schedule has one event per band transition in the glide path", () => {
  // 24-month goal → 2 steps (20/80 then 0/100): one de-risking event at month 12
  const steps = buildGlidePathSchedule({
    goalType: "home", monthsToTarget: 24,
    targetPaise: null, fundedPaise: 5_00_000_00, // ₹5L funded
    monthlyInflowPaise: 0,
    equityReturnBps: 1200, debtReturnBps: 700,
    today: new Date("2026-08-18"),
  });
  assert.equal(steps.length, 2);
  const plan = buildRebalancingPlan(makeInput({
    currentEquityPct: 20, currentDebtPct: 80,
    targetEquityPct: 20, targetDebtPct: 80,
    glideSteps: steps,
  }));
  assert.equal(plan.deRiskingSchedule.length, 1);
  const evt = plan.deRiskingSchedule[0]!;
  assert.equal(evt.fromEquityPct, 20);
  assert.equal(evt.toEquityPct, 0);
  // equityToSwitchPaise = projectedCorpus at step[1].start × 20/100 > 0
  assert.ok(evt.equityToSwitchPaise > 0);
});

test("CONTRIBUTION_CORRECTION_MONTHS is 18", () => {
  assert.equal(CONTRIBUTION_CORRECTION_MONTHS, 18);
});
