import { standardEmiPaise } from "@compass/shared";
import type {
  BudgetGuardResult,
  GoalImpactItem,
  GoalImpactResult,
  UtilizationLine,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { currentPeriodKey } from "../../../lib/periods.ts";
import { amortize } from "../../credit/services/emis.ts";
import { getUtilization } from "../../planning/services/budgets.ts";
import { getGoalProjectionInputs, listGoals } from "../../planning/services/goals.ts";
import type { ProjectionInput } from "../../planning/services/goal-projection.ts";
import { projectGoal } from "../../planning/services/goal-projection.ts";

export async function checkBudgetCap(
  db: Db,
  userId: string,
  cartTotalPaise: number,
  categoryId?: string,
): Promise<BudgetGuardResult> {
  const utilization = await getUtilization(db, userId, "monthly", currentPeriodKey("monthly"));
  return calculateBudgetCap(utilization.lines, cartTotalPaise, categoryId);
}

/** Pure budget-envelope reduction, kept separate from the live utilization read. */
export function calculateBudgetCap(
  allLines: UtilizationLine[],
  cartTotalPaise: number,
  categoryId?: string,
): BudgetGuardResult {
  const lines = categoryId ? allLines.filter((line) => line.categoryId === categoryId) : allLines;
  if (lines.length === 0) return null;

  const budgetedPaise = lines.reduce((sum, line) => sum + line.budgetedPaise, 0);
  const carryPaise = lines.reduce((sum, line) => sum + line.carryPaise, 0);
  const spentPaise = lines.reduce((sum, line) => sum + line.spentPaise, 0);
  const remainingPaise = lines.reduce((sum, line) => sum + line.remainingPaise, 0);
  const overBudgetPaise = Math.max(0, cartTotalPaise - remainingPaise);
  // Defensive: if DB-derived aggregates or subtraction produce unsafe integers,
  // return null rather than risk a 500 from response schema validation.
  if (
    !Number.isSafeInteger(budgetedPaise) ||
    !Number.isSafeInteger(carryPaise) ||
    !Number.isSafeInteger(spentPaise) ||
    !Number.isSafeInteger(remainingPaise) ||
    !Number.isSafeInteger(overBudgetPaise)
  ) {
    return null;
  }
  return {
    budgetedPaise,
    carryPaise,
    spentPaise,
    remainingPaise,
    cartTotalPaise,
    overBudgetPaise,
    categoryId: categoryId ?? null,
  };
}

type GoalProjection = {
  goalId: string;
  goalName: string;
  input: ProjectionInput;
};

/** Pure counterfactual used by the DB-backed guard and its focused tests. */
export function calculateGoalImpacts(
  amountPaise: number,
  goals: GoalProjection[],
): GoalImpactResult {
  if (goals.length === 0) return null;
  const totalInflow = goals.reduce((sum, goal) => sum + goal.input.monthlyInflowPaise, 0);
  const equalReduction = Math.floor(amountPaise / goals.length);

  return {
    impacts: goals.map(({ goalId, goalName, input }) => {
      const baseline = projectGoal(input);
      const reduction =
        totalInflow > 0
          ? Math.floor(amountPaise * (input.monthlyInflowPaise / totalInflow))
          : equalReduction;
      const impactedMonthlyInflowPaise = Math.max(0, input.monthlyInflowPaise - reduction);
      const impacted = projectGoal({ ...input, monthlyInflowPaise: impactedMonthlyInflowPaise });
      const baselineMonths = baseline.projectedMonths;
      const impactedMonths = impacted.projectedMonths;
      const delayMonths =
        baselineMonths !== null && impactedMonths !== null
          ? Math.round((impactedMonths - baselineMonths) * 10) / 10
          : null;
      const status: GoalImpactItem["status"] =
        baseline.fundedPaise >= input.targetPaise
          ? "completed"
          : input.monthsToTarget === null
            ? "undated"
            : baselineMonths === null
              ? "already_behind"
              : impactedMonths === null
                ? "unreachable"
                : (delayMonths ?? 0) <= 0
                  ? "no_impact"
                  : "delayed";
      return {
        goalId,
        goalName,
        baselineMonths,
        impactedMonths,
        delayMonths,
        baselineMonthlyInflowPaise: input.monthlyInflowPaise,
        impactedMonthlyInflowPaise,
        status,
      };
    }),
  };
}

export async function computeGoalImpact(
  db: Db,
  userId: string,
  amountPaise: number,
): Promise<GoalImpactResult> {
  const activeGoals = (await listGoals(db, userId)).filter((goal) => !goal.archived);
  const goals = await Promise.all(
    activeGoals.map(async (goal): Promise<GoalProjection> => ({
      goalId: goal.id,
      goalName: goal.name,
      input: await getGoalProjectionInputs(db, userId, goal.id),
    })),
  );
  return calculateGoalImpacts(amountPaise, goals);
}

export function decomposeEmi(
  principalPaise: number,
  tenureMonths: number,
  annualRateBps: number,
  processingFeeBps: number,
): {
  emiPaise: number;
  totalRepaymentPaise: number;
  interestPaise: number;
  processingFeePaise: number;
  extraCostPaise: number;
} {
  const emiPaise = standardEmiPaise(principalPaise, annualRateBps, tenureMonths);
  const { totalInterestPaise } = amortize(principalPaise, annualRateBps, emiPaise, tenureMonths, 0);
  const processingFee = (BigInt(principalPaise) * BigInt(processingFeeBps)) / 10_000n;
  if (processingFee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Processing fee exceeds a safe integer");
  }
  const processingFeePaise = Number(processingFee);
  const totalRepaymentPaise = principalPaise + totalInterestPaise;
  return {
    emiPaise,
    totalRepaymentPaise,
    interestPaise: totalInterestPaise,
    processingFeePaise,
    extraCostPaise: totalInterestPaise + processingFeePaise,
  };
}
