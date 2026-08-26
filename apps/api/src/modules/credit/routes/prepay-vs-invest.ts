import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { RateResetImpactSchema, PrepayVsInvestResultSchema } from "@compass/shared";
import { listEmis } from "../services/emis.ts";
import { computeRateResetImpact, computePrepayVsInvest } from "../services/prepay-vs-invest.ts";
import { HttpError } from "../../../lib/errors.ts";
import { getRegimePreference } from "../../tax/services/regime-preference.ts";
import { getHouseholdRevolvingDebt } from "../services/revolving-debt.ts";
import { currentFy } from "../../../lib/financial-year.ts";
import { listGoals, getGoalProgress } from "../../planning/services/goals.ts";

const templateIdParam = z.object({ templateId: z.string().uuid() });

export async function prepayVsInvestRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/emis/:templateId/rate-reset",
    {
      schema: {
        params: templateIdParam,
        querystring: z.object({ newRateBps: z.coerce.number().int().min(1).max(50_00) }),
        response: { 200: RateResetImpactSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const emis = await listEmis(app.db, userId);
      const emi = emis.find((e) => e.templateId === req.params.templateId);
      if (!emi) throw new HttpError(404, "EMI not found");

      return computeRateResetImpact({
        currentRateBps: emi.annualRateBps,
        newRateBps: req.query.newRateBps,
        principalPaise: emi.principalPaise,
        currentInstallmentPaise: emi.installmentPaise,
        currentTotalInstallments: emi.paidInstallments + emi.remainingInstallments,
        paidInstallments: emi.paidInstallments,
      });
    },
  );

  r.get(
    "/api/emis/:templateId/prepay-vs-invest",
    {
      schema: {
        params: templateIdParam,
        querystring: z.object({
          lumpSumPaise: z.coerce.number().int().min(1),
          prepaymentChargesPaise: z.coerce.number().int().min(0).default(0),
          investReturnBps: z.coerce.number().int().min(0).max(50_00).optional(),
          isHomeLoan: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
        }),
        response: { 200: PrepayVsInvestResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const emis = await listEmis(app.db, userId);
      const emi = emis.find((e) => e.templateId === req.params.templateId);
      if (!emi) throw new HttpError(404, "EMI not found");

      const fy = currentFy();
      let regime: "old" | "new" = "new";
      try {
        const pref = await getRegimePreference(app.db, userId, fy);
        regime = pref.effective;
      } catch { /* default new */ }

      let highInterestDebtPaise = 0;
      try {
        const debt = await getHouseholdRevolvingDebt(app.db, userId);
        highInterestDebtPaise = debt.totalRevolvingPaise;
      } catch { /* non-critical */ }

      let emergencyFundedPaise = 0;
      let emergencyTargetPaise: number | null = null;
      const goals = await listGoals(app.db, userId);
      const emergencyGoal = goals.find((g) => g.type === "emergency_fund");
      if (emergencyGoal) {
        try {
          const progress = await getGoalProgress(app.db, userId, emergencyGoal.id);
          emergencyFundedPaise = progress.fundedPaise;
          emergencyTargetPaise = progress.effectiveTargetPaise;
        } catch { /* non-critical */ }
      }

      const investReturnBps = req.query.investReturnBps ?? 1200;
      const isHomeLoan = req.query.isHomeLoan ?? (emi.loanAccountId !== null);

      return computePrepayVsInvest({
        outstandingPaise: emi.outstandingPaise,
        annualRateBps: emi.annualRateBps,
        installmentPaise: emi.installmentPaise,
        remainingInstallments: emi.remainingInstallments,
        lumpSumPaise: req.query.lumpSumPaise,
        prepaymentChargesPaise: req.query.prepaymentChargesPaise,
        regime, investReturnBps, isHomeLoan,
        emergencyFundedPaise, emergencyTargetPaise, highInterestDebtPaise,
      });
    },
  );
}
