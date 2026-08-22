import assert from "node:assert/strict";
import test from "node:test";
import { FinancialGuardsQuerySchema, FinancialGuardsResponseSchema } from "@compass/shared";
import { calculateBudgetCap, calculateGoalImpacts, decomposeEmi } from "./financial-guards.ts";

test("decomposeEmi uses annual basis points and reconciles repayment", () => {
  const result = decomposeEmi(100_000, 12, 1_200, 100);

  assert.equal(result.totalRepaymentPaise, 100_000 + result.interestPaise);
  assert.equal(result.processingFeePaise, 1_000);
  assert.ok(result.interestPaise > 0);
});

test("decomposeEmi has no interest at zero bps and uses BigInt for a large processing fee", () => {
  const zeroRate = decomposeEmi(100_000, 3, 0, 0);
  const largeFee = decomposeEmi(9_000_000_000, 1, 0, 10_000);

  assert.deepEqual(zeroRate, {
    emiPaise: 33_333,
    totalRepaymentPaise: 100_000,
    interestPaise: 0,
    processingFeePaise: 0,
    extraCostPaise: 0,
  });
  assert.equal(largeFee.processingFeePaise, 9_000_000_000);
});

test("calculateBudgetCap handles rollover, overage, overspend, category selection, and no budgets", () => {
  const lines = [
    {
      categoryId: "00000000-0000-4000-8000-000000000010",
      budgetedPaise: 1_000,
      carryPaise: 250,
      spentPaise: 500,
      remainingPaise: 750,
      rollover: true,
    },
    {
      categoryId: "00000000-0000-4000-8000-000000000011",
      budgetedPaise: 500,
      carryPaise: 0,
      spentPaise: 800,
      remainingPaise: -300,
      rollover: false,
    },
  ];

  assert.deepEqual(calculateBudgetCap(lines, 800, lines[0]!.categoryId), {
    budgetedPaise: 1_000,
    carryPaise: 250,
    spentPaise: 500,
    remainingPaise: 750,
    cartTotalPaise: 800,
    overBudgetPaise: 50,
    categoryId: lines[0]!.categoryId,
  });
  assert.equal(calculateBudgetCap(lines, 1, lines[1]!.categoryId)?.overBudgetPaise, 301);
  assert.equal(calculateBudgetCap([], 100), null);
});

test("calculateGoalImpacts allocates a cart reduction proportionally and classifies projections", () => {
  const input = (
    monthlyInflowPaise: number,
    monthsToTarget: number | null,
    targetPaise = 100_000,
  ) => ({
    assets: [{ valuePaise: 0, annualReturnBps: 0 }],
    targetPaise,
    monthsToTarget,
    monthlyInflowPaise,
  });
  const impacts = calculateGoalImpacts(300, [
    { goalId: "00000000-0000-4000-8000-000000000001", goalName: "A", input: input(100, 24) },
    { goalId: "00000000-0000-4000-8000-000000000002", goalName: "B", input: input(200, 24) },
  ]);

  assert.equal(impacts?.impacts[0]?.impactedMonthlyInflowPaise, 0);
  assert.equal(impacts?.impacts[1]?.impactedMonthlyInflowPaise, 0);
  assert.equal(impacts?.impacts[0]?.status, "unreachable");
  assert.equal(impacts?.impacts[1]?.status, "unreachable");

  const statuses = calculateGoalImpacts(0, [
    {
      goalId: "00000000-0000-4000-8000-000000000003",
      goalName: "Undated",
      input: input(100, null),
    },
    { goalId: "00000000-0000-4000-8000-000000000004", goalName: "Done", input: input(100, 12, 0) },
    { goalId: "00000000-0000-4000-8000-000000000005", goalName: "Behind", input: input(0, 12) },
  ]);
  assert.deepEqual(
    statuses?.impacts.map((impact) => impact.status),
    ["undated", "completed", "already_behind"],
  );
  assert.equal(calculateGoalImpacts(100, []), null);
});

test("FinancialGuardsQuerySchema coerces GET query values and parses EMI offers", () => {
  const result = FinancialGuardsQuerySchema.parse({
    cartTotalPaise: "100000",
    emiOffers: JSON.stringify([
      { principalPaise: 100_000, tenureMonths: 12, annualRateBps: 1_200, processingFeeBps: 100 },
    ]),
  });

  assert.equal(result.cartTotalPaise, 100_000);
  assert.equal(result.emiOffers?.[0]?.annualRateBps, 1_200);
  assert.throws(() => FinancialGuardsQuerySchema.parse({ cartTotalPaise: "-1" }));
  assert.doesNotThrow(() =>
    FinancialGuardsResponseSchema.parse({ budget: null, goals: null, emi: null }),
  );
});

test("FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error", () => {
  const result = FinancialGuardsQuerySchema.safeParse({
    cartTotalPaise: "100000",
    emiOffers: "{bad",
  });
  assert.equal(result.success, false);
});
