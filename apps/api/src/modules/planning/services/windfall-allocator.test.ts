import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateWindfall, type WindfallGoalInput, type WindfallEmiInput } from "./windfall-allocator.ts";

const emergencyGoal: WindfallGoalInput = {
  id: "g-emg",
  name: "Emergency Fund",
  goalType: "emergency_fund",
  monthsToTarget: 6,
  targetPaise: 3_000_000_00, // 3L
  fundedPaise: 1_000_000_00, // 1L (short by 2L)
  blendedReturnBps: 600,
  requiredMonthlyPaise: 35_000_00,
  sortOrder: 0,
};

const homeGoal: WindfallGoalInput = {
  id: "g-home",
  name: "House Deposit",
  goalType: "home",
  monthsToTarget: 60,
  targetPaise: 20_000_000_00, // 20L
  fundedPaise: 5_000_000_00, // 5L
  blendedReturnBps: 1000,
  requiredMonthlyPaise: 200_000_00,
  sortOrder: 1,
};

const retirementGoal: WindfallGoalInput = {
  id: "g-ret",
  name: "Retirement",
  goalType: "retirement",
  monthsToTarget: 240,
  targetPaise: 500_000_000_00, // 5Cr
  fundedPaise: 50_000_000_00, // 50L
  blendedReturnBps: 1100,
  requiredMonthlyPaise: 500_000_00,
  sortOrder: 2,
};

const sampleEmi: WindfallEmiInput = {
  templateId: "emi-1",
  name: "Home Loan",
  outstandingPaise: 3_000_000_00, // ₹30L (30,00,000 paise)
  annualRateBps: 850,
  installmentPaise: 45_000_00, // ₹45,000/mo (covers interest of ~₹17,708)
  remainingInstallments: 180,
};

test("emergency fund shortfall is prioritised first", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00, // 5L
    goals: [emergencyGoal, homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.ok(result.emergencyFundTopUp !== null);
  assert.equal(result.emergencyFundTopUp!.allocatedPaise, 2_000_000_00); // shortfall = 2L
  assert.ok(result.goalAllocations.length > 0, "remaining should go to goals");
});

test("high-interest debt is cleared after emergency fund", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [emergencyGoal, homeGoal],
    emis: [],
    highInterestDebtPaise: 1_000_000_00, // 1L revolving
    isWindfallTaxable: false,
  });

  assert.ok(result.emergencyFundTopUp !== null);
  assert.equal(result.emergencyFundTopUp!.allocatedPaise, 2_000_000_00);
  assert.ok(result.highInterestDebtPayoff !== null);
  assert.equal(result.highInterestDebtPayoff!.allocatedPaise, 1_000_000_00);
});

test("windfall smaller than emergency fund gap goes entirely to emergency fund", () => {
  const result = allocateWindfall({
    windfallPaise: 1_000_000_00, // 1L, shortfall is 2L
    goals: [emergencyGoal, homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.ok(result.emergencyFundTopUp !== null);
  assert.equal(result.emergencyFundTopUp!.allocatedPaise, 1_000_000_00);
  assert.equal(result.goalAllocations.length, 0);
  assert.equal(result.recommendation, "emergency_fund_first");
});

test("debt prepay options are computed for each EMI", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [homeGoal],
    emis: [sampleEmi],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.equal(result.debtPrepayOptions.length, 1);
  assert.ok(result.debtPrepayOptions[0]!.interestSavedPaise > 0);
  assert.ok(result.debtPrepayOptions[0]!.tenureSavedInstallments > 0);
});

test("goal allocations include months pulled forward", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.ok(result.goalAllocations.length > 0);
  const homeAlloc = result.goalAllocations.find((g) => g.goalId === "g-home");
  assert.ok(homeAlloc !== undefined);
  assert.ok(homeAlloc!.monthsPulledForward !== null);
  assert.ok(homeAlloc!.monthsPulledForward! > 0);
});

test("no goals: recommendation is no_goals", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.equal(result.recommendation, "no_goals");
  assert.equal(result.unallocatedPaise, 5_000_000_00);
});

test("taxable windfall gets a tax note", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: true,
  });

  assert.ok(result.taxNote !== null);
  assert.ok(result.taxNote!.includes("taxable"));
});

test("non-taxable windfall has null tax note", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.equal(result.taxNote, null);
});

test("fully funded emergency goal is skipped", () => {
  const fundedEmergency: WindfallGoalInput = {
    ...emergencyGoal,
    fundedPaise: 3_000_000_00, // matches target
  };
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [fundedEmergency, homeGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  assert.equal(result.emergencyFundTopUp, null);
  assert.ok(result.goalAllocations.length > 0);
});

test("all amounts are integer paise", () => {
  const result = allocateWindfall({
    windfallPaise: 5_000_000_00,
    goals: [emergencyGoal, homeGoal, retirementGoal],
    emis: [sampleEmi],
    highInterestDebtPaise: 50_000_00,
    isWindfallTaxable: true,
  });

  assert.ok(Number.isInteger(result.windfallPaise));
  assert.ok(Number.isInteger(result.unallocatedPaise));
  if (result.emergencyFundTopUp) {
    assert.ok(Number.isInteger(result.emergencyFundTopUp.allocatedPaise));
  }
  for (const g of result.goalAllocations) {
    assert.ok(Number.isInteger(g.allocatedPaise));
  }
  for (const d of result.debtPrepayOptions) {
    assert.ok(Number.isInteger(d.interestSavedPaise));
  }
});

test("multiple goals are allocated in priority order", () => {
  const result = allocateWindfall({
    windfallPaise: 10_000_000_00, // 10L
    goals: [emergencyGoal, homeGoal, retirementGoal],
    emis: [],
    highInterestDebtPaise: 0,
    isWindfallTaxable: false,
  });

  // Emergency fund gets its shortfall first (2L)
  assert.ok(result.emergencyFundTopUp !== null);
  assert.equal(result.emergencyFundTopUp!.allocatedPaise, 2_000_000_00);
  // Remaining 8L goes to goals
  assert.ok(result.goalAllocations.length > 0);
  const totalGoalAlloc = result.goalAllocations.reduce((s, g) => s + g.allocatedPaise, 0);
  assert.ok(totalGoalAlloc > 0);
});
