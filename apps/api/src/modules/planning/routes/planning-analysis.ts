import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  DataCompletenessReportSchema,
  IncomeSurplusResultSchema,
  MultiGoalAllocationPlanSchema,
  IncomeAdequacyReportSchema,
  type Goal,
} from "@compass/shared";
import { getIncomeSurplus } from "../services/income-surplus.ts";
import { getDataCompletenessReport } from "../services/data-completeness.ts";
import { listGoals, getGoalProgress } from "../services/goals.ts";
import { allocateAcrossGoals } from "../services/multi-goal-allocation.ts";
import { buildIncomeAdequacyReport } from "../services/income-adequacy.ts";
import type { UnderfundedGoal } from "../services/income-adequacy.ts";

/**
 * GET /api/planning/income-surplus
 * GET /api/planning/data-completeness
 *
 * OWNER-ONLY SCOPING: Both endpoints return data for the authenticated user's
 * own accounts only. `withSharing` (lib/sharing.ts) is deliberately NOT used
 * because it currently has zero production call sites anywhere in the codebase.
 * Every existing endpoint is owner-only; making these sharing-aware would be
 * inconsistent with the rest of the app. This decision is reversible and is
 * tracked for a future sharing-rollout decision (task 061).
 *
 * For data-completeness specifically: shared accounts visible elsewhere in the
 * household UI are omitted from readiness reporting.
 *
 * RESIDUAL REAL-DB 500 RISKS (AC12):
 * (a) Number(bigintString) / Drizzle mode:"number" can exceed
 *     Number.MAX_SAFE_INTEGER, which the contract's .safe() then correctly
 *     rejects → 500. No DB constraint or runtime guard prevents this.
 * (b) statement_reconciliations.period is unconstrained text (spines.ts:204-207)
 *     while the contract demands strict YYYY-MM, so malformed legacy data → 500.
 * These are recorded, not fixed, in this task.
 */
export async function planningAnalysisRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/planning/income-surplus",
    {
      schema: {
        querystring: z.object({
          lookbackMonths: z.coerce.number().int().min(1).max(120).default(12),
        }),
        response: { 200: IncomeSurplusResultSchema },
      },
    },
    async (req) =>
      getIncomeSurplus(app.db, req.session!.userId, req.query.lookbackMonths),
  );

  r.get(
    "/api/planning/data-completeness",
    {
      schema: {
        // `today` is deliberately NOT exposed: it is a determinism seam for
        // tests (data-completeness.ts:162-165). Letting a client move the
        // readiness report's reference date is a correctness hazard for no
        // benefit. This route defines NO querystring schema, so query params
        // are not processed by the validator at all — ?today=... reaches the
        // route handler but the handler calls getDataCompletenessReport with
        // only (db, userId), omitting the third argument entirely. The service
        // then defaults today = new Date(). The query param has no effect and
        // the returned asOf always reflects the server's current date.
        response: { 200: DataCompletenessReportSchema },
      },
    },
    async (req) => getDataCompletenessReport(app.db, req.session!.userId),
  );

  r.get(
    "/api/planning/multi-goal-allocation",
    {
      schema: {
        response: { 200: MultiGoalAllocationPlanSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      const goals = await listGoals(app.db, userId);
      const activeGoals = goals.filter((g) => !g.archived);
      const surplus = await getIncomeSurplus(app.db, userId);
      if (surplus.conservativeSurplusPaise === null) {
        return { perGoal: [], totalAllocatedPaise: 0, freeCashPaise: 0 };
      }
      const progresses = await Promise.all(
        activeGoals.map((g) => getGoalProgress(app.db, userId, g.id)),
      );

      const entries = progresses.map((p, i) => ({
        id: activeGoals[i]!.id,
        goalType: activeGoals[i]!.type,
        monthsToTarget: monthsToTargetOf(activeGoals[i]!),
        requiredMonthlyPaise: p.plan.gapMonthlyPaise,
        fundedPaise: p.fundedPaise,
        targetPaise: p.effectiveTargetPaise,
        blendedReturnBps: p.blendedReturnBps,
        sortOrder: i,
      }));

      const availableSurplus = surplus.conservativeSurplusPaise;
      return allocateAcrossGoals(entries, availableSurplus);
    },
  );

  r.get(
    "/api/planning/income-adequacy",
    {
      schema: {
        response: { 200: IncomeAdequacyReportSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      const goals = await listGoals(app.db, userId);
      const activeGoals = goals.filter((g) => !g.archived);
      const surplus = await getIncomeSurplus(app.db, userId);
      if (surplus.conservativeSurplusPaise === null) {
        return {
          totalShortfallPaise: 0,
          hasShortfall: false,
          conservativeSurplusPaise: null,
          optimisticSurplusPaise: null,
          levers: [],
        };
      }
      const progresses = await Promise.all(
        activeGoals.map((g) => getGoalProgress(app.db, userId, g.id)),
      );

      const entries = progresses.map((p, i) => ({
        id: activeGoals[i]!.id,
        goalType: activeGoals[i]!.type,
        monthsToTarget: monthsToTargetOf(activeGoals[i]!),
        requiredMonthlyPaise: p.plan.gapMonthlyPaise,
        fundedPaise: p.fundedPaise,
        targetPaise: p.effectiveTargetPaise,
        blendedReturnBps: p.blendedReturnBps,
        sortOrder: i,
      }));

      const availableSurplus = surplus.conservativeSurplusPaise;
      const plan = allocateAcrossGoals(entries, availableSurplus);

      const allocationByGoalId = new Map(plan.perGoal.map((r) => [r.goalId, r]));
      const progressByGoalId = new Map(progresses.map((p) => [p.id, p]));

      const underfunded: UnderfundedGoal[] = entries
        .filter((e) => {
          const alloc = allocationByGoalId.get(e.id);
          return alloc && !alloc.fullyCovered && (e.requiredMonthlyPaise ?? 0) > 0;
        })
        .map((e) => {
          const alloc = allocationByGoalId.get(e.id)!;
          const progress = progressByGoalId.get(e.id)!;
          return {
            goalId: e.id,
            goalName: progress.name,
            monthsToTarget: e.monthsToTarget,
            targetPaise: e.targetPaise,
            fundedPaise: e.fundedPaise,
            blendedReturnBps: e.blendedReturnBps,
            allocatedMonthlyPaise: alloc.allocatedMonthlyPaise,
            shortfallPaise: (e.requiredMonthlyPaise ?? 0) - alloc.allocatedMonthlyPaise,
            slipMonths: alloc.slipMonths,
          };
        });

      const sorted = [...surplus.months].sort((a, b) => a.incomePaise - b.incomePaise);
      const mid = Math.floor(sorted.length / 2);
      const medianMonthlyIncomePaise =
        sorted.length === 0 ? 0 : (sorted[mid]?.incomePaise ?? 0);

      return buildIncomeAdequacyReport({
        underfundedGoals: underfunded,
        conservativeSurplusPaise: surplus.conservativeSurplusPaise,
        optimisticSurplusPaise: surplus.optimisticSurplusPaise,
        medianMonthlyIncomePaise,
      });
    },
  );
}

function monthsToTargetOf(g: Goal): number | null {
  if (g.targetDate) {
    return Math.max(
      0,
      Math.round(
        (new Date(g.targetDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24 * 30.44),
      ),
    );
  }
  return g.targetMonths ?? null;
}
