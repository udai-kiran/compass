import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  GlidePathScheduleSchema,
  InstrumentGuidanceSchema,
  RebalancingPlanSchema,
  TaxAwareRebalancingPlanSchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { getGoalProgress } from "../services/goals.ts";
import { getProjectionSettings } from "../services/projection-settings.ts";
import { buildGlidePathSchedule } from "../services/goal-plan.ts";
import { buildInstrumentGuidance } from "../services/instrument-guidance.ts";
import { buildRebalancingPlan } from "../services/rebalancing-plan.ts";
import { buildTaxAwareRebalancingPlan } from "../services/tax-aware-rebalancing.ts";
import type { SwitchGainData } from "../services/tax-aware-rebalancing.ts";

const goalIdParam = z.object({ goalId: z.string().uuid() });
const legQuery = z.object({
  leg: z.enum(["equity", "debt"]),
  horizonMonths: z.coerce.number().int().min(1).max(600).optional(),
});

function computeMonthsToTarget(goal: {
  targetDate: string | null;
  targetMonths: number | null;
}): number | null {
  if (goal.targetDate !== null) {
    return Math.max(
      0,
      Math.round(
        (new Date(goal.targetDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24 * 30.44),
      ),
    );
  }
  if (goal.targetMonths !== null) {
    return goal.targetMonths;
  }
  return null;
}

export async function goalAnalysisRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /api/goals/:goalId/glide-path
  r.get(
    "/api/goals/:goalId/glide-path",
    {
      schema: {
        params: goalIdParam,
        response: {
          200: GlidePathScheduleSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { goalId } = req.params;
      const userId = req.session!.userId;

      let goal;
      try {
        goal = await getGoalProgress(app.db, userId, goalId);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 404) {
          return reply.code(404).send({ message: "Goal not found" });
        }
        throw err;
      }

      const settings = await getProjectionSettings(app.db, userId);
      const monthsToTarget = computeMonthsToTarget(goal);
      const debtReturnBps = Math.round(settings.equityReturnBps * 0.6);

      return buildGlidePathSchedule({
        goalType: goal.type,
        monthsToTarget,
        targetPaise: goal.targetPaise,
        fundedPaise: goal.fundedPaise,
        monthlyInflowPaise: goal.monthlyInflowPaise,
        equityReturnBps: settings.equityReturnBps,
        debtReturnBps,
      });
    },
  );

  // GET /api/goals/:goalId/instrument-guidance
  r.get(
    "/api/goals/:goalId/instrument-guidance",
    {
      schema: {
        params: goalIdParam,
        querystring: legQuery,
        response: {
          200: InstrumentGuidanceSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { goalId } = req.params;
      const userId = req.session!.userId;

      let goal;
      try {
        goal = await getGoalProgress(app.db, userId, goalId);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 404) {
          return reply.code(404).send({ message: "Goal not found" });
        }
        throw err;
      }

      const monthsToTarget = computeMonthsToTarget(goal);
      const horizonMonths = req.query.horizonMonths ?? monthsToTarget ?? 60;

      return buildInstrumentGuidance(req.query.leg, horizonMonths, [], new Date());
    },
  );

  // GET /api/goals/:goalId/rebalancing-plan
  r.get(
    "/api/goals/:goalId/rebalancing-plan",
    {
      schema: {
        params: goalIdParam,
        response: {
          200: RebalancingPlanSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { goalId } = req.params;
      const userId = req.session!.userId;

      let goal;
      try {
        goal = await getGoalProgress(app.db, userId, goalId);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 404) {
          return reply.code(404).send({ message: "Goal not found" });
        }
        throw err;
      }

      const settings = await getProjectionSettings(app.db, userId);
      const monthsToTarget = computeMonthsToTarget(goal);
      const debtReturnBps = Math.round(settings.equityReturnBps * 0.6);

      const glideSteps = buildGlidePathSchedule({
        goalType: goal.type,
        monthsToTarget,
        targetPaise: goal.targetPaise,
        fundedPaise: goal.fundedPaise,
        monthlyInflowPaise: goal.monthlyInflowPaise,
        equityReturnBps: settings.equityReturnBps,
        debtReturnBps,
      });

      return buildRebalancingPlan({
        fundedPaise: goal.fundedPaise,
        currentEquityPct: goal.equityPct,
        currentDebtPct: goal.debtPct,
        targetEquityPct: goal.plan.targetEquityPct,
        targetDebtPct: goal.plan.targetDebtPct,
        currentEquitySipPaise: goal.plan.committedEquityPaise,
        currentDebtSipPaise: goal.plan.committedDebtPaise,
        goalType: goal.type,
        glideSteps,
      });
    },
  );

  // GET /api/goals/:goalId/tax-aware-rebalancing
  r.get(
    "/api/goals/:goalId/tax-aware-rebalancing",
    {
      schema: {
        params: goalIdParam,
        response: {
          200: TaxAwareRebalancingPlanSchema,
          404: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { goalId } = req.params;
      const userId = req.session!.userId;

      let goal;
      try {
        goal = await getGoalProgress(app.db, userId, goalId);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 404) {
          return reply.code(404).send({ message: "Goal not found" });
        }
        throw err;
      }

      const settings = await getProjectionSettings(app.db, userId);
      const monthsToTarget = computeMonthsToTarget(goal);
      const debtReturnBps = Math.round(settings.equityReturnBps * 0.6);

      const glideSteps = buildGlidePathSchedule({
        goalType: goal.type,
        monthsToTarget,
        targetPaise: goal.targetPaise,
        fundedPaise: goal.fundedPaise,
        monthlyInflowPaise: goal.monthlyInflowPaise,
        equityReturnBps: settings.equityReturnBps,
        debtReturnBps,
      });

      const plan = buildRebalancingPlan({
        fundedPaise: goal.fundedPaise,
        currentEquityPct: goal.equityPct,
        currentDebtPct: goal.debtPct,
        targetEquityPct: goal.plan.targetEquityPct,
        targetDebtPct: goal.plan.targetDebtPct,
        currentEquitySipPaise: goal.plan.committedEquityPaise,
        currentDebtSipPaise: goal.plan.committedDebtPaise,
        goalType: goal.type,
        glideSteps,
      });

      const switchGainData: SwitchGainData[] = plan.actions
        .filter((a) => a.type === "switch_corpus")
        .map(
          (): SwitchGainData => ({
            estimatedLtcgPaise: 0,
            estimatedStcgPaise: 0,
            estimatedExemptPaise: 0,
            earliestStcgFlipDate: null,
            lockedCategories: [],
          }),
        );

      return buildTaxAwareRebalancingPlan({
        plan,
        switchGainData,
        fyLtcgAlreadyRealizedPaise: 0,
      });
    },
  );
}
