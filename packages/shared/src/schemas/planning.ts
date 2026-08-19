/**
 * planning.ts — shared Zod response schemas for the v2.2.0 planning endpoints.
 *
 * Source of truth: the service files in apps/api/src/modules/planning/services/
 * and apps/api/src/lib/instrument-rules.ts. Compile-time parity assertions live
 * in apps/api/src/modules/planning/services/planning-schemas.test.ts.
 *
 * Money is always integer paise (minor units). The local `paiseField` helper
 * uses z.number().int().safe(). In the installed Zod 4.4.3, `.int()` already
 * rejects NaN, ±Infinity, and values outside the safe-integer range; `.safe()`
 * is therefore redundant but is retained as an explicit safe-integer guard and
 * as insurance should `.int()` semantics change in a future Zod release.
 *
 * Temporal strings come in two formats:
 *   YYYY-MM-DD → z.iso.date() (available in installed Zod v4)
 *   YYYY-MM    → explicit regex refinement (year-month, not a full ISO date)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Local money helper — NOT exported (brief prohibits a new public PaiseSchema)
// ---------------------------------------------------------------------------

/**
 * Integer paise field. In Zod 4.4.3, `.int()` already rejects NaN, ±Infinity,
 * and values outside the safe-integer range; `.safe()` is retained as a
 * redundant-but-explicit safe-integer guard for documentation clarity.
 */
function paiseField() {
  return z.number().int().safe();
}

// ---------------------------------------------------------------------------
// Temporal helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD ISO date string (z.iso.date() available in installed Zod v4). */
const isoDateString = z.iso.date();

/** YYYY-MM year-month string (not a full ISO date). */
const yearMonthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a YYYY-MM year-month string");

// ---------------------------------------------------------------------------
// 1. Income surplus schemas
// ---------------------------------------------------------------------------

export const MonthlyIncomeSchema = z.object({
  /** "YYYY-MM" period key */
  month: yearMonthString,
  incomePaise: paiseField(),
  likelyBonus: z.boolean(),
});
export type MonthlyIncome = z.output<typeof MonthlyIncomeSchema>;

export const CommittedOutflowSchema = z.object({
  monthlyPaise: paiseField(),
  kind: z.enum(["recurring", "sip"]),
  label: z.string(),
});
export type CommittedOutflow = z.output<typeof CommittedOutflowSchema>;

export const IncomeSurplusResultSchema = z.object({
  historyMonths: z.number().int(),
  months: z.array(MonthlyIncomeSchema),
  committedOutflows: z.array(CommittedOutflowSchema),
  totalCommittedPaise: paiseField(),
  /** null when historyMonths < 3 */
  conservativeSurplusPaise: paiseField().nullable(),
  /** null when historyMonths < 3 */
  optimisticSurplusPaise: paiseField().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});
export type IncomeSurplusResult = z.output<typeof IncomeSurplusResultSchema>;

// ---------------------------------------------------------------------------
// 2. Data completeness schemas
// ---------------------------------------------------------------------------

export const AccountReadinessSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  accountType: z.string(),
  /** ISO date of most recent committed import; null if never imported */
  lastImportedAt: isoDateString.nullable(),
  /** age of last import in days; null if never imported */
  lastImportDaysAgo: z.number().int().nullable(),
  /** count of unmatched statement lines; null for non-card accounts */
  unmatchedStatementLines: z.number().int().nullable(),
  /** ISO date of most recent holding valuation; null if no valuations */
  lastValuationAt: isoDateString.nullable(),
  /** age of last valuation in days; null if no valuations */
  lastValuationDaysAgo: z.number().int().nullable(),
  dataFreshness: z.enum(["fresh", "stale", "missing"]),
});
export type AccountReadiness = z.output<typeof AccountReadinessSchema>;

export const DataCompletenessReportSchema = z.object({
  /** Today's date (ISO YYYY-MM-DD) */
  asOf: isoDateString,
  accounts: z.array(AccountReadinessSchema),
  unresolvedDraftCount: z.number().int(),
  /** ISO date of most recent net-worth snapshot; null if never run */
  lastSnapshotAt: isoDateString.nullable(),
  /** age of last net-worth snapshot in days; null if never run */
  lastSnapshotDaysAgo: z.number().int().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  confidenceReasons: z.array(z.string()),
});
export type DataCompletenessReport = z.output<typeof DataCompletenessReportSchema>;

// ---------------------------------------------------------------------------
// 3. Multi-goal allocation schemas
// ---------------------------------------------------------------------------

export const GoalAllocationResultSchema = z.object({
  goalId: z.string(),
  allocatedMonthlyPaise: paiseField(),
  fullyCovered: z.boolean(),
  /** null = goal unreachable at allocated rate; 0 = covered or undated */
  slipMonths: z.number().int().nullable(),
});
export type GoalAllocationResult = z.output<typeof GoalAllocationResultSchema>;

export const MultiGoalAllocationPlanSchema = z.object({
  perGoal: z.array(GoalAllocationResultSchema),
  totalAllocatedPaise: paiseField(),
  freeCashPaise: paiseField(),
});
export type MultiGoalAllocationPlan = z.output<typeof MultiGoalAllocationPlanSchema>;

// ---------------------------------------------------------------------------
// 4. Glide-path schedule schemas
// ---------------------------------------------------------------------------

export const GlideStepSchema = z.object({
  /** ISO date string YYYY-MM-DD when this step's allocation takes effect */
  fromDate: isoDateString,
  /** ISO date string YYYY-MM-DD when the next step begins */
  toDate: isoDateString,
  equityPct: z.number(),
  debtPct: z.number(),
  monthsRemaining: z.number().int(),
  /**
   * Monthly contribution needed to reach targetPaise from projected corpus.
   * 0 = already funded. null = targetPaise was null.
   */
  requiredMonthlyPaise: paiseField().nullable(),
  /** Current estimated corpus (paise) at the START of this step. */
  projectedCorpusPaise: paiseField(),
});
export type GlideStep = z.output<typeof GlideStepSchema>;

/** The response contract for the glide-path endpoint (array of steps). */
export const GlidePathScheduleSchema = z.array(GlideStepSchema);
export type GlidePathSchedule = z.output<typeof GlidePathScheduleSchema>;

// ---------------------------------------------------------------------------
// 5. Rebalancing plan schemas
// ---------------------------------------------------------------------------

export const DriftAnalysisSchema = z.object({
  equityCurrentPaise: paiseField(),
  equityTargetPaise: paiseField(),
  debtCurrentPaise: paiseField(),
  debtTargetPaise: paiseField(),
  overweightLeg: z.enum(["equity", "debt", "none"]),
  driftPaise: paiseField(),
});
export type DriftAnalysis = z.output<typeof DriftAnalysisSchema>;

export const ContributionRedirectionActionSchema = z.object({
  type: z.literal("redirect_contributions"),
  fromLeg: z.enum(["equity", "debt"]),
  toLeg: z.enum(["equity", "debt"]),
  monthlyAmountPaise: paiseField(),
  estimatedClosureMonths: z.number().int(),
});
export type ContributionRedirectionAction = z.output<typeof ContributionRedirectionActionSchema>;

export const CorpusSwitchActionSchema = z.object({
  type: z.literal("switch_corpus"),
  fromLeg: z.enum(["equity", "debt"]),
  toLeg: z.enum(["equity", "debt"]),
  amountPaise: paiseField(),
});
export type CorpusSwitchAction = z.output<typeof CorpusSwitchActionSchema>;

export const RebalancingActionSchema = z.discriminatedUnion("type", [
  ContributionRedirectionActionSchema,
  CorpusSwitchActionSchema,
]);
export type RebalancingAction = z.output<typeof RebalancingActionSchema>;

export const DeRiskingEventSchema = z.object({
  /** ISO date string — when the allocation shift takes effect */
  fromDate: isoDateString,
  fromEquityPct: z.number(),
  fromDebtPct: z.number(),
  toEquityPct: z.number(),
  toDebtPct: z.number(),
  equityToSwitchPaise: paiseField(),
});
export type DeRiskingEvent = z.output<typeof DeRiskingEventSchema>;

export const RebalancingPlanSchema = z.object({
  drift: DriftAnalysisSchema,
  actions: z.array(RebalancingActionSchema),
  deRiskingSchedule: z.array(DeRiskingEventSchema),
});
export type RebalancingPlan = z.output<typeof RebalancingPlanSchema>;

// ---------------------------------------------------------------------------
// 6. Instrument guidance schemas
// ---------------------------------------------------------------------------

export const InstrumentCategorySchema = z.enum([
  "elss",
  "ppf",
  "epf_vpf",
  "ssy",
  "nsc",
  "tax_saver_fd",
  "sgb",
  "equity_mf",
  "debt_mf",
  "liquid_mf",
  "fd",
  "rd",
  "direct_stock",
  "equity_etf",
  "nps",
]);
export type InstrumentCategory = z.output<typeof InstrumentCategorySchema>;

export const AllocationLegSchema = z.enum(["equity", "debt"]);
export type AllocationLeg = z.output<typeof AllocationLegSchema>;

export const SuitabilityTierSchema = z.enum(["ideal", "suitable", "caution"]);
export type SuitabilityTier = z.output<typeof SuitabilityTierSchema>;

export const InstrumentSuggestionSchema = z.object({
  category: InstrumentCategorySchema,
  label: z.string(),
  tier: SuitabilityTierSchema,
  rationale: z.string(),
  lockInConflict: z.boolean(),
  /** Summary of lock-in constraints if present, else null */
  lockInSummary: z.string().nullable(),
  taxSummary: z.string(),
  liquiditySummary: z.string(),
  alreadyHeld: z.boolean(),
});
export type InstrumentSuggestion = z.output<typeof InstrumentSuggestionSchema>;

export const InstrumentGuidanceSchema = z.object({
  leg: AllocationLegSchema,
  horizonMonths: z.number().int(),
  suggestions: z.array(InstrumentSuggestionSchema),
});
export type InstrumentGuidance = z.output<typeof InstrumentGuidanceSchema>;

// ---------------------------------------------------------------------------
// 7. Income adequacy report schemas (task 6.5)
// ---------------------------------------------------------------------------

export const ExtendTimelinePerGoalSchema = z.object({
  goalId: z.string(),
  goalName: z.string(),
  originalMonthsToTarget: z.number().int().nullable(),
  newMonthsToTarget: z.number().int().nullable(),
  slipMonths: z.number().int().nullable(),
});

export const ExtendTimelineLeverSchema = z.object({
  type: z.literal("extend_timeline"),
  perGoal: z.array(ExtendTimelinePerGoalSchema),
});
export type ExtendTimelineLever = z.output<typeof ExtendTimelineLeverSchema>;

export const ReduceTargetPerGoalSchema = z.object({
  goalId: z.string(),
  goalName: z.string(),
  originalTargetPaise: paiseField().nullable(),
  achievableTargetPaise: paiseField().nullable(),
  reductionPct: z.number().nullable(),
});

export const ReduceTargetLeverSchema = z.object({
  type: z.literal("reduce_target"),
  perGoal: z.array(ReduceTargetPerGoalSchema),
});
export type ReduceTargetLever = z.output<typeof ReduceTargetLeverSchema>;

export const CutExpensesOpportunitySchema = z.object({
  categoryName: z.string(),
  monthlySpendPaise: paiseField(),
  coversPct: z.number(),
});

export const CutExpensesLeverSchema = z.object({
  type: z.literal("cut_expenses"),
  requiredMonthlyReductionPaise: paiseField(),
  opportunities: z.array(CutExpensesOpportunitySchema),
});
export type CutExpensesLever = z.output<typeof CutExpensesLeverSchema>;

export const IncomeIncreaseLeverSchema = z.object({
  type: z.literal("increase_income"),
  requiredMonthlyIncreasePaise: paiseField(),
  pctOfCurrentIncome: z.number(),
});
export type IncomeIncreaseLever = z.output<typeof IncomeIncreaseLeverSchema>;

export const AdequacyLeverSchema = z.discriminatedUnion("type", [
  ExtendTimelineLeverSchema,
  ReduceTargetLeverSchema,
  CutExpensesLeverSchema,
  IncomeIncreaseLeverSchema,
]);
export type AdequacyLever = z.output<typeof AdequacyLeverSchema>;

export const IncomeAdequacyReportSchema = z.object({
  totalShortfallPaise: paiseField(),
  hasShortfall: z.boolean(),
  conservativeSurplusPaise: paiseField().nullable(),
  optimisticSurplusPaise: paiseField().nullable(),
  levers: z.array(AdequacyLeverSchema),
});
export type IncomeAdequacyReport = z.output<typeof IncomeAdequacyReportSchema>;

// ---------------------------------------------------------------------------
// 8. Tax-aware rebalancing schemas (task 6.7)
// ---------------------------------------------------------------------------

export const SwitchTaxAnnotationSchema = z.object({
  actionIndex: z.number().int(),
  action: CorpusSwitchActionSchema,
  estimatedLtcgPaise: paiseField(),
  estimatedStcgPaise: paiseField(),
  estimatedExemptPaise: paiseField(),
  ltcgHeadroomBeforePaise: paiseField(),
  /** May be negative when LTCG exceeds headroom */
  ltcgHeadroomAfterPaise: z.number().int().safe(),
  ltcgFitsInHeadroom: z.boolean(),
  lockedCategoryDetails: z.array(
    z.object({
      category: InstrumentCategorySchema,
      lockInSummary: z.string(),
    }),
  ),
  earliestStcgFlipDate: isoDateString.nullable(),
  redirectionAvailable: z.boolean(),
  notRecommendedNow: z.boolean(),
  notRecommendedReason: z.string().nullable(),
});
export type SwitchTaxAnnotation = z.output<typeof SwitchTaxAnnotationSchema>;

export const TaxAwareRebalancingPlanSchema = z.object({
  plan: RebalancingPlanSchema,
  switchAnnotations: z.array(SwitchTaxAnnotationSchema),
  ltcgHeadroomPaise: paiseField(),
  redirectionNote: z.string(),
});
export type TaxAwareRebalancingPlan = z.output<typeof TaxAwareRebalancingPlanSchema>;
