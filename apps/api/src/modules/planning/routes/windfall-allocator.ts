import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { WindfallAllocationResultSchema } from "@compass/shared";
import { allocateWindfall } from "../services/windfall-allocator.ts";
import { listGoals, getGoalProgress } from "../services/goals.ts";
import { listEmis } from "../../credit/services/emis.ts";
import { getHouseholdRevolvingDebt } from "../../credit/services/revolving-debt.ts";
import type { WindfallGoalInput, WindfallEmiInput } from "../services/windfall-allocator.ts";

export async function windfallAllocatorRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/planning/windfall",
    {
      schema: {
        querystring: z.object({
          windfallPaise: z.coerce.number().int().min(1),
          isWindfallTaxable: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
        }),
        response: { 200: WindfallAllocationResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      // Load goals with progress (for fundedPaise)
      const goalList = await listGoals(app.db, userId);
      const goalInputs: WindfallGoalInput[] = [];

      for (const g of goalList) {
        if (g.archived) continue;
        try {
          const progress = await getGoalProgress(app.db, userId, g.id);
          const monthsToTarget = g.targetDate
            ? Math.max(0, Math.round((new Date(g.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44)))
            : null;
          goalInputs.push({
            id: g.id,
            name: g.name,
            goalType: g.type,
            monthsToTarget,
            targetPaise: progress.effectiveTargetPaise,
            fundedPaise: progress.fundedPaise,
            blendedReturnBps: progress.blendedReturnBps,
            requiredMonthlyPaise: progress.requiredMonthlyPaise,
            sortOrder: g.sortOrder,
          });
        } catch {
          // Skip goals we can't load progress for
        }
      }

      // Load EMIs
      const emiList = await listEmis(app.db, userId);
      const emiInputs: WindfallEmiInput[] = emiList
        .filter((e) => e.remainingInstallments > 0 && !e.paused)
        .map((e) => ({
          templateId: e.templateId,
          name: e.merchant,
          outstandingPaise: e.outstandingPaise,
          annualRateBps: e.annualRateBps,
          installmentPaise: e.installmentPaise,
          remainingInstallments: e.remainingInstallments,
        }));

      // Revolving debt
      let highInterestDebtPaise = 0;
      try {
        const debt = await getHouseholdRevolvingDebt(app.db, userId);
        highInterestDebtPaise = debt.totalRevolvingPaise;
      } catch { /* non-critical */ }

      return allocateWindfall({
        windfallPaise: req.query.windfallPaise,
        goals: goalInputs,
        emis: emiInputs,
        highInterestDebtPaise,
        isWindfallTaxable: req.query.isWindfallTaxable,
      });
    },
  );
}
