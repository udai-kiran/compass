import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getGoalProgress } from "../services/goals.ts";
import { getProjectionSettings } from "../services/projection-settings.ts";
import { buildGlidePathSchedule } from "../services/goal-plan.ts";
import { generateRoadmapNarrative } from "../services/roadmap-narrative.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";
import { effectiveModel, type AiObserver } from "@compass/ai";
import { getAiSettings } from "../../automation/services/ai-settings.ts";
import { recordAiEvent } from "../../automation/services/events.ts";

const goalIdParam = z.object({ goalId: z.string().uuid() });

const RoadmapNarrativeResponseSchema = z
  .object({
    narrative: z.string(),
    generatedAt: z.string(),
  })
  .nullable();

/**
 * Compute months remaining to the goal's target date (or fall back to
 * targetMonths for emergency funds). Returns null for undated goals.
 */
function computeMonthsToTarget(goal: {
  targetDate: string | null;
  targetMonths: number | null;
}): number | null {
  if (goal.targetDate !== null) {
    return Math.max(
      0,
      Math.round(
        (new Date(goal.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44),
      ),
    );
  }
  if (goal.targetMonths !== null) {
    return goal.targetMonths;
  }
  return null;
}

/**
 * GET /api/goals/:goalId/roadmap-narrative
 *
 * Generates a plain-language narrative for the goal roadmap using the user's
 * AI provider. Returns null (200 with null body) when AI is disabled or
 * unavailable — the deterministic roadmap is always the primary output and
 * the narrative is assist-only.
 */
export async function roadmapNarrativeRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/goals/:goalId/roadmap-narrative",
    {
      schema: {
        params: goalIdParam,
        response: { 200: RoadmapNarrativeResponseSchema, 404: z.object({ message: z.string() }) },
      },
    },
    async (req) => {
      const { goalId } = req.params;
      const userId = req.session!.userId;

      const goal = await getGoalProgress(app.db, userId, goalId);

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

      const input = {
        goalName: goal.name,
        goalType: goal.type,
        targetPaise: goal.targetPaise,
        fundedPaise: goal.fundedPaise,
        monthsToTarget,
        glideSteps,
        targetEquityPct: goal.plan.targetEquityPct,
        targetDebtPct: goal.plan.targetDebtPct,
        allocationDrifted: goal.plan.allocationDrifted,
        recommendedMonthlyPaise: goal.plan.recommendedMonthlyPaise,
      };

      const meta = await getAiSettings(app.db, userId);
      const model = effectiveModel(meta.provider, meta.model);
      const observe: AiObserver = (obs) =>
        recordAiEvent(app.db, userId, {
          kind: "goal_roadmap",
          status: obs.ok ? "ok" : "error",
          provider: meta.provider,
          model,
          title: goal.name,
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        });

      return generateRoadmapNarrative(
        app.db,
        userId,
        mailboxSecret(app.config),
        app.config.AI_ALLOWED_BASE_URLS,
        input,
        observe,
      );
    },
  );
}
