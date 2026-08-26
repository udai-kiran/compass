/**
 * debt-windfall.ts — shared Zod response schemas for Phase 15 (Debt & windfall).
 * Money is always integer paise (minor units).
 */
import { z } from "zod";

function paiseField() {
  return z.number().int().safe();
}

// ── Rate-reset impact ─────────────────────────────────────────────────────────

export const RateResetImpactSchema = z.object({
  currentRateBps: z.number().int(),
  newRateBps: z.number().int(),
  currentInstallmentPaise: paiseField(),
  currentTotalInstallments: z.number().int(),
  remainingInstallments: z.number().int(),
  outstandingPaise: paiseField(),
  sameEmi: z.object({
    installmentPaise: paiseField(),
    newTotalInstallments: z.number().int(),
    tenureChangedBy: z.number().int(),
    totalInterestPaise: paiseField(),
    interestDeltaPaise: z.number().int().safe(),
  }),
  sameTenure: z.object({
    newInstallmentPaise: paiseField(),
    installmentDeltaPaise: z.number().int().safe(),
    totalInterestPaise: paiseField(),
    interestDeltaPaise: z.number().int().safe(),
  }),
  baselineRemainingInterestPaise: paiseField(),
});
export type RateResetImpact = z.output<typeof RateResetImpactSchema>;

// ── Prepayment option ─────────────────────────────────────────────────────────

export const PrepaymentOptionSchema = z.object({
  strategy: z.enum(["tenure_reduction", "emi_reduction"]),
  lumpSumPaise: paiseField(),
  newOutstandingPaise: paiseField(),
  newRemainingInstallments: z.number().int().nullable(),
  tenureSavedInstallments: z.number().int().nullable(),
  newInstallmentPaise: paiseField().nullable(),
  installmentReductionPaise: paiseField().nullable(),
  totalRemainingInterestPaise: paiseField(),
  interestSavedPaise: paiseField(),
});
export type PrepaymentOption = z.output<typeof PrepaymentOptionSchema>;

// ── Investment alternative ────────────────────────────────────────────────────

export const InvestmentAlternativeSchema = z.object({
  lumpSumPaise: paiseField(),
  assumedReturnBps: z.number().int(),
  horizonMonths: z.number().int(),
  projectedValuePaise: paiseField(),
  projectedGainPaise: paiseField(),
  postTaxGainPaise: paiseField(),
  riskNote: z.string(),
});
export type InvestmentAlternative = z.output<typeof InvestmentAlternativeSchema>;

// ── Prepay vs invest result ───────────────────────────────────────────────────

export const PrepayVsInvestResultSchema = z.object({
  outstandingPaise: paiseField(),
  annualRateBps: z.number().int(),
  remainingInstallments: z.number().int(),
  lumpSumPaise: paiseField(),
  prepaymentChargesPaise: paiseField(),
  effectiveLumpSumPaise: paiseField(),
  tenureReduction: PrepaymentOptionSchema,
  emiReduction: PrepaymentOptionSchema,
  investAlternative: InvestmentAlternativeSchema,
  effectiveLoanRateBps: z.number().int(),
  section24bApplied: z.boolean(),
  recommendation: z.enum(["prepay", "invest", "emergency_fund_first", "high_interest_debt_first"]),
  recommendationReason: z.string(),
  assumptions: z.array(z.string()),
});
export type PrepayVsInvestResult = z.output<typeof PrepayVsInvestResultSchema>;

// ── Windfall allocation (task 15.2) ───────────────────────────────────────────

export const WindfallGoalImpactSchema = z.object({
  goalId: z.string(),
  goalName: z.string(),
  goalType: z.string(),
  allocatedPaise: paiseField(),
  monthsPulledForward: z.number().nullable(),
  reason: z.string(),
});
export type WindfallGoalImpact = z.output<typeof WindfallGoalImpactSchema>;

export const WindfallDebtOptionSchema = z.object({
  emiTemplateId: z.string(),
  emiName: z.string(),
  outstandingPaise: paiseField(),
  annualRateBps: z.number().int(),
  interestSavedPaise: paiseField(),
  tenureSavedInstallments: z.number().int(),
});
export type WindfallDebtOption = z.output<typeof WindfallDebtOptionSchema>;

export const WindfallAllocationResultSchema = z.object({
  windfallPaise: paiseField(),
  emergencyFundTopUp: WindfallGoalImpactSchema.nullable(),
  highInterestDebtPayoff: z.object({
    totalRevolvingPaise: paiseField(),
    allocatedPaise: paiseField(),
  }).nullable(),
  debtPrepayOptions: z.array(WindfallDebtOptionSchema),
  goalAllocations: z.array(WindfallGoalImpactSchema),
  unallocatedPaise: paiseField(),
  recommendation: z.enum([
    "emergency_fund_first",
    "clear_revolving_debt",
    "mixed_allocation",
    "invest_in_goals",
    "no_goals",
  ]),
  recommendationSummary: z.string(),
  assumptions: z.array(z.string()),
  taxNote: z.string().nullable(),
});
export type WindfallAllocationResult = z.output<typeof WindfallAllocationResultSchema>;
