import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIncomeAdequacyReport,
  type UnderfundedGoal,
  type CategorySpend,
} from "./income-adequacy.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<UnderfundedGoal> & { goalId: string }): UnderfundedGoal {
  return {
    goalId: overrides.goalId,
    goalName: overrides.goalName ?? `Goal ${overrides.goalId}`,
    // Use !== undefined so that an explicit null is preserved (not replaced by default).
    monthsToTarget: overrides.monthsToTarget !== undefined ? overrides.monthsToTarget : 60,
    targetPaise: overrides.targetPaise !== undefined ? overrides.targetPaise : 10_00_00_000, // ₹10L
    fundedPaise: overrides.fundedPaise ?? 0,
    blendedReturnBps: overrides.blendedReturnBps ?? 1200, // 12% p.a.
    allocatedMonthlyPaise: overrides.allocatedMonthlyPaise ?? 0,
    shortfallPaise: overrides.shortfallPaise ?? 1_00_00_000, // ₹1L shortfall
    slipMonths: overrides.slipMonths !== undefined ? overrides.slipMonths : 6,
  };
}

// ---------------------------------------------------------------------------
// Test 1: no shortfall — all goals fully covered
// ---------------------------------------------------------------------------

test("no shortfall: all goals covered → hasShortfall=false, levers=[], totalShortfall=0", () => {
  const result = buildIncomeAdequacyReport({
    underfundedGoals: [], // no underfunded goals at all
    conservativeSurplusPaise: 50_000_00,
    optimisticSurplusPaise: 80_000_00,
    medianMonthlyIncomePaise: 5_00_000_00,
  });

  assert.equal(result.hasShortfall, false);
  assert.equal(result.totalShortfallPaise, 0);
  assert.deepEqual(result.levers, []);
  assert.equal(result.conservativeSurplusPaise, 50_000_00);
  assert.equal(result.optimisticSurplusPaise, 80_000_00);
});

test("goals with shortfall=0 do not increase totalShortfall", () => {
  const goal = makeGoal({ goalId: "g1", shortfallPaise: 0, slipMonths: 0 });
  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 5_00_000_00,
  });

  assert.equal(result.hasShortfall, false);
  assert.equal(result.totalShortfallPaise, 0);
  assert.deepEqual(result.levers, []);
});

// ---------------------------------------------------------------------------
// Test 2: single underfunded goal — verify all 4 levers present
// ---------------------------------------------------------------------------

test("single underfunded goal: 4 levers returned in correct order", () => {
  const goal = makeGoal({
    goalId: "g1",
    goalName: "Emergency Fund",
    monthsToTarget: 24,
    targetPaise: 6_00_00_000, // ₹6L
    fundedPaise: 1_00_00_000, // ₹1L already
    blendedReturnBps: 700, // 7% p.a.
    allocatedMonthlyPaise: 15_000_00, // ₹15k/month allocated
    shortfallPaise: 5_000_00, // ₹5k shortfall
    slipMonths: 3,
  });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: 10_000_00,
    optimisticSurplusPaise: 20_000_00,
    medianMonthlyIncomePaise: 1_00_00_000, // ₹1L/month
  });

  assert.equal(result.hasShortfall, true);
  assert.equal(result.totalShortfallPaise, 5_000_00);
  assert.equal(result.levers.length, 4);
  assert.equal(result.levers[0]!.type, "extend_timeline");
  assert.equal(result.levers[1]!.type, "reduce_target");
  assert.equal(result.levers[2]!.type, "cut_expenses");
  assert.equal(result.levers[3]!.type, "increase_income");
});

// ---------------------------------------------------------------------------
// Test 3: income lever percentage calculation
// ---------------------------------------------------------------------------

test("income lever % calculation: shortfall=₹50k, median=₹5L → pctOfCurrentIncome=10", () => {
  const goal = makeGoal({
    goalId: "g1",
    shortfallPaise: 50_000_00, // ₹50,000
    slipMonths: 2,
  });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 5_00_000_00, // ₹5,00,000
  });

  const lever = result.levers.find((l) => l.type === "increase_income");
  assert.ok(lever && lever.type === "increase_income");
  assert.equal(lever.requiredMonthlyIncreasePaise, 50_000_00);
  assert.equal(lever.pctOfCurrentIncome, 10);
});

// ---------------------------------------------------------------------------
// Test 4: expense cut without categories → opportunities=[]
// ---------------------------------------------------------------------------

test("expense cut without categories: opportunities is empty", () => {
  const goal = makeGoal({ goalId: "g1", shortfallPaise: 10_000_00, slipMonths: 1 });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
    // topExpenseCategories not provided
  });

  const lever = result.levers.find((l) => l.type === "cut_expenses");
  assert.ok(lever && lever.type === "cut_expenses");
  assert.equal(lever.requiredMonthlyReductionPaise, 10_000_00);
  assert.deepEqual(lever.opportunities, []);
});

// ---------------------------------------------------------------------------
// Test 5: expense cut with categories — sorted desc, coversPct correct
// ---------------------------------------------------------------------------

test("expense cut with categories: sorted desc by spend, coversPct computed correctly", () => {
  const goal = makeGoal({ goalId: "g1", shortfallPaise: 20_000_00, slipMonths: 2 });

  const categories: CategorySpend[] = [
    { categoryName: "Dining Out", monthlyPaise: 5_000_00 },     // ₹5k → 25%
    { categoryName: "Subscriptions", monthlyPaise: 2_000_00 },  // ₹2k → 10%
    { categoryName: "Shopping", monthlyPaise: 10_000_00 },      // ₹10k → 50%
    { categoryName: "Transport", monthlyPaise: 3_000_00 },      // ₹3k → 15%
  ];

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
    topExpenseCategories: categories,
  });

  const lever = result.levers.find((l) => l.type === "cut_expenses");
  assert.ok(lever && lever.type === "cut_expenses");
  assert.equal(lever.requiredMonthlyReductionPaise, 20_000_00);
  assert.equal(lever.opportunities.length, 4);
  // Sorted by spend desc: Shopping, Dining Out, Transport, Subscriptions
  assert.equal(lever.opportunities[0]!.categoryName, "Shopping");
  assert.equal(lever.opportunities[0]!.monthlySpendPaise, 10_000_00);
  assert.equal(lever.opportunities[0]!.coversPct, 50);
  assert.equal(lever.opportunities[1]!.categoryName, "Dining Out");
  assert.equal(lever.opportunities[1]!.coversPct, 25);
  assert.equal(lever.opportunities[2]!.categoryName, "Transport");
  assert.equal(lever.opportunities[2]!.coversPct, 15);
  assert.equal(lever.opportunities[3]!.categoryName, "Subscriptions");
  assert.equal(lever.opportunities[3]!.coversPct, 10);
});

// ---------------------------------------------------------------------------
// Test 6: undated goal (monthsToTarget=null) → achievableTargetPaise=null
// ---------------------------------------------------------------------------

test("undated goal: reduce_target perGoal has null achievableTargetPaise", () => {
  const goal = makeGoal({
    goalId: "g1",
    goalName: "Vacation Fund",
    monthsToTarget: null,
    targetPaise: 5_00_00_000,
    fundedPaise: 0,
    allocatedMonthlyPaise: 5_000_00,
    shortfallPaise: 5_000_00,
    slipMonths: null, // unreachable/undated
  });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
  });

  const lever = result.levers.find((l) => l.type === "reduce_target");
  assert.ok(lever && lever.type === "reduce_target");
  assert.equal(lever.perGoal.length, 1);
  assert.equal(lever.perGoal[0]!.achievableTargetPaise, null);
  assert.equal(lever.perGoal[0]!.reductionPct, null);
});

// ---------------------------------------------------------------------------
// Test 7: no surplus (null) — service still works
// ---------------------------------------------------------------------------

test("null surplus: levers still computed correctly", () => {
  const goal = makeGoal({
    goalId: "g1",
    shortfallPaise: 8_000_00,
    slipMonths: 4,
  });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 80_000_00,
  });

  assert.equal(result.conservativeSurplusPaise, null);
  assert.equal(result.optimisticSurplusPaise, null);
  assert.equal(result.hasShortfall, true);
  assert.equal(result.levers.length, 4);
});

// ---------------------------------------------------------------------------
// Test 8: extend_timeline perGoal filtering
// ---------------------------------------------------------------------------

test("extend_timeline perGoal: slipMonths=null included, slipMonths=0 excluded, slipMonths>0 included", () => {
  const goals: UnderfundedGoal[] = [
    makeGoal({ goalId: "slip0", goalName: "Slip Zero", slipMonths: 0, shortfallPaise: 100 }),
    makeGoal({ goalId: "slip3", goalName: "Slip Three", slipMonths: 3, monthsToTarget: 12, shortfallPaise: 100 }),
    makeGoal({ goalId: "unreachable", goalName: "Unreachable", slipMonths: null, monthsToTarget: 24, shortfallPaise: 100 }),
  ];

  const result = buildIncomeAdequacyReport({
    underfundedGoals: goals,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
  });

  const lever = result.levers.find((l) => l.type === "extend_timeline");
  assert.ok(lever && lever.type === "extend_timeline");

  const ids = lever.perGoal.map((g) => g.goalId);
  assert.ok(!ids.includes("slip0"), "slipMonths=0 should be excluded");
  assert.ok(ids.includes("slip3"), "slipMonths>0 should be included");
  assert.ok(ids.includes("unreachable"), "slipMonths=null should be included");

  const slip3Entry = lever.perGoal.find((g) => g.goalId === "slip3");
  assert.ok(slip3Entry);
  assert.equal(slip3Entry.originalMonthsToTarget, 12);
  assert.equal(slip3Entry.newMonthsToTarget, 15); // 12 + 3
  assert.equal(slip3Entry.slipMonths, 3);

  const unreachableEntry = lever.perGoal.find((g) => g.goalId === "unreachable");
  assert.ok(unreachableEntry);
  assert.equal(unreachableEntry.newMonthsToTarget, null);
  assert.equal(unreachableEntry.slipMonths, null);
});

// ---------------------------------------------------------------------------
// Test 9: levers ordering is always [extend, reduce, cut, income]
// ---------------------------------------------------------------------------

test("levers ordering is always extend_timeline, reduce_target, cut_expenses, increase_income", () => {
  const goal = makeGoal({ goalId: "g1", shortfallPaise: 5_000_00, slipMonths: 1 });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: 1_000_00,
    optimisticSurplusPaise: 2_000_00,
    medianMonthlyIncomePaise: 1_00_000_00,
  });

  const types = result.levers.map((l) => l.type);
  assert.deepEqual(types, ["extend_timeline", "reduce_target", "cut_expenses", "increase_income"]);
});

// ---------------------------------------------------------------------------
// Test 10: pctOfCurrentIncome with zero income → 0, not throws
// ---------------------------------------------------------------------------

test("pctOfCurrentIncome with zero median income returns 0 without throwing", () => {
  const goal = makeGoal({ goalId: "g1", shortfallPaise: 10_000_00, slipMonths: 2 });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 0,
  });

  const lever = result.levers.find((l) => l.type === "increase_income");
  assert.ok(lever && lever.type === "increase_income");
  assert.equal(lever.pctOfCurrentIncome, 0);
  assert.equal(lever.requiredMonthlyIncreasePaise, 10_000_00);
});

// ---------------------------------------------------------------------------
// Test 11: reduce_target FV calculation for a dated, partially funded goal
// ---------------------------------------------------------------------------

test("reduce_target: achievable FV computed correctly for a partially funded goal", () => {
  // 0% return for easy math: FV = funded + monthly * n
  // funded=0, monthly=10_000_00, n=12, return=0 → FV=1_20_00_000
  const goal = makeGoal({
    goalId: "g1",
    goalName: "Car",
    monthsToTarget: 12,
    targetPaise: 2_00_00_000, // ₹2L target
    fundedPaise: 0,
    blendedReturnBps: 0, // 0% return for predictable math
    allocatedMonthlyPaise: 10_000_00, // ₹10k/month
    shortfallPaise: 10_000_00,
    slipMonths: 3,
  });

  const result = buildIncomeAdequacyReport({
    underfundedGoals: [goal],
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
  });

  const lever = result.levers.find((l) => l.type === "reduce_target");
  assert.ok(lever && lever.type === "reduce_target");
  const entry = lever.perGoal[0]!;
  // achievable = 0 + 10_000_00 * 12 = 1_20_00_000 (₹1.2L)
  assert.equal(entry.achievableTargetPaise, 1_20_00_000);
  // reductionPct = (2_00_00_000 - 1_20_00_000) / 2_00_00_000 * 100 = 40%
  assert.equal(entry.reductionPct, 40);
});

// ---------------------------------------------------------------------------
// Test 12: multiple goals sum shortfall correctly
// ---------------------------------------------------------------------------

test("multiple goals: totalShortfallPaise is the sum of all goal shortfalls", () => {
  const goals: UnderfundedGoal[] = [
    makeGoal({ goalId: "g1", shortfallPaise: 5_000_00, slipMonths: 1 }),
    makeGoal({ goalId: "g2", shortfallPaise: 15_000_00, slipMonths: 2 }),
    makeGoal({ goalId: "g3", shortfallPaise: 10_000_00, slipMonths: 0 }),
  ];

  const result = buildIncomeAdequacyReport({
    underfundedGoals: goals,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    medianMonthlyIncomePaise: 1_00_000_00,
  });

  assert.equal(result.totalShortfallPaise, 30_000_00);
  assert.equal(result.hasShortfall, true);

  const cutLever = result.levers.find((l) => l.type === "cut_expenses");
  assert.ok(cutLever && cutLever.type === "cut_expenses");
  assert.equal(cutLever.requiredMonthlyReductionPaise, 30_000_00);

  const incomeLever = result.levers.find((l) => l.type === "increase_income");
  assert.ok(incomeLever && incomeLever.type === "increase_income");
  assert.equal(incomeLever.requiredMonthlyIncreasePaise, 30_000_00);
});
