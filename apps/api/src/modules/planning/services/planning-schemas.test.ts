/**
 * planning-schemas.test.ts — parity assertions + runtime safeParse tests for
 * all 6 planning response schemas from packages/shared/src/schemas/planning.ts.
 *
 * Tier A (4 pure): GlidePathSchedule, RebalancingPlan, InstrumentGuidance,
 *   MultiGoalAllocationPlan — call the real service function and safeParse actual output.
 * Tier B (2 DB-backed): IncomeSurplusResult, DataCompletenessReport — build
 *   satisfies-annotated fixtures from exported pure helpers, no fake Db.
 *
 * Compile-time parity: 6 bidirectional Assert<Equal<z.output<...>, ServiceType>>
 * assertions (the 7th is for HouseholdRevolvingDebt in credit-schemas.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Service imports — aliased to avoid same-name collision with the schema type aliases.
import type {
  IncomeSurplusResult as ServiceIncomeSurplusResult,
  IncomeSurplusComputation,
  MonthlyIncome as ServiceMonthlyIncome,
  CommittedOutflow as ServiceCommittedOutflow,
} from "./income-surplus.ts";
import { computeIncomeSurplus } from "./income-surplus.ts";

import type { DataCompletenessReport as ServiceDataCompletenessReport } from "./data-completeness.ts";
import { computeConfidence } from "./data-completeness.ts";

import type { MultiGoalAllocationPlan as ServiceMultiGoalAllocationPlan } from "./multi-goal-allocation.ts";
import { allocateAcrossGoals } from "./multi-goal-allocation.ts";

import type { GlideStep as ServiceGlideStep } from "./goal-plan.ts";
import { buildGlidePathSchedule } from "./goal-plan.ts";

import type { RebalancingPlan as ServiceRebalancingPlan } from "./rebalancing-plan.ts";
import { buildRebalancingPlan } from "./rebalancing-plan.ts";

import type { InstrumentGuidance as ServiceInstrumentGuidance } from "./instrument-guidance.ts";
import { buildInstrumentGuidance } from "./instrument-guidance.ts";

import type { IncomeAdequacyReport as ServiceIncomeAdequacyReport } from "./income-adequacy.ts";

import type { TaxAwareRebalancingPlan as ServiceTaxAwareRebalancingPlan } from "./tax-aware-rebalancing.ts";

// Schema imports from the shared package.
import {
  // Barrel smoke: all required names from TASK.md complete export list.
  MonthlyIncomeSchema,
  CommittedOutflowSchema,
  IncomeSurplusResultSchema,
  AccountReadinessSchema,
  DataCompletenessReportSchema,
  GoalAllocationResultSchema,
  MultiGoalAllocationPlanSchema,
  GlideStepSchema,
  GlidePathScheduleSchema,
  DriftAnalysisSchema,
  ContributionRedirectionActionSchema,
  CorpusSwitchActionSchema,
  RebalancingActionSchema,
  DeRiskingEventSchema,
  RebalancingPlanSchema,
  InstrumentCategorySchema,
  AllocationLegSchema,
  SuitabilityTierSchema,
  InstrumentSuggestionSchema,
  InstrumentGuidanceSchema,
  IncomeAdequacyReportSchema,
  TaxAwareRebalancingPlanSchema,
} from "@compass/shared";

// ---------------------------------------------------------------------------
// Parity helpers — compile-time bidirectional equality check.
// The _-prefix satisfies eslint's varsIgnorePattern: "^_".
// ---------------------------------------------------------------------------

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// 1. IncomeSurplusResult
type _IncomeSurplusResultParity = Assert<
  Equal<z.output<typeof IncomeSurplusResultSchema>, ServiceIncomeSurplusResult>
>;

// 2. DataCompletenessReport
type _DataCompletenessReportParity = Assert<
  Equal<z.output<typeof DataCompletenessReportSchema>, ServiceDataCompletenessReport>
>;

// 3. MultiGoalAllocationPlan
type _MultiGoalAllocationPlanParity = Assert<
  Equal<z.output<typeof MultiGoalAllocationPlanSchema>, ServiceMultiGoalAllocationPlan>
>;

// 4. GlidePathSchedule (array contract) — GlideStep[] from the service
type _GlidePathScheduleParity = Assert<
  Equal<z.output<typeof GlidePathScheduleSchema>, ServiceGlideStep[]>
>;

// 5. RebalancingPlan
type _RebalancingPlanParity = Assert<
  Equal<z.output<typeof RebalancingPlanSchema>, ServiceRebalancingPlan>
>;

// 6. InstrumentGuidance
type _InstrumentGuidanceParity = Assert<
  Equal<z.output<typeof InstrumentGuidanceSchema>, ServiceInstrumentGuidance>
>;

// 7. IncomeAdequacyReport
type _IncomeAdequacyReportParity = Assert<
  Equal<z.output<typeof IncomeAdequacyReportSchema>, ServiceIncomeAdequacyReport>
>;

// 8. TaxAwareRebalancingPlan
type _TaxAwareRebalancingPlanParity = Assert<
  Equal<z.output<typeof TaxAwareRebalancingPlanSchema>, ServiceTaxAwareRebalancingPlan>
>;

// ---------------------------------------------------------------------------
// Barrel smoke test — every required name from TASK.md must be importable
// ---------------------------------------------------------------------------

test("barrel smoke: all required planning schema names are importable from @compass/shared", () => {
  const names = [
    MonthlyIncomeSchema,
    CommittedOutflowSchema,
    IncomeSurplusResultSchema,
    AccountReadinessSchema,
    DataCompletenessReportSchema,
    GoalAllocationResultSchema,
    MultiGoalAllocationPlanSchema,
    GlideStepSchema,
    GlidePathScheduleSchema,
    DriftAnalysisSchema,
    ContributionRedirectionActionSchema,
    CorpusSwitchActionSchema,
    RebalancingActionSchema,
    DeRiskingEventSchema,
    RebalancingPlanSchema,
    InstrumentCategorySchema,
    AllocationLegSchema,
    SuitabilityTierSchema,
    InstrumentSuggestionSchema,
    InstrumentGuidanceSchema,
    IncomeAdequacyReportSchema,
    TaxAwareRebalancingPlanSchema,
  ];
  for (const schema of names) {
    assert.ok(schema !== undefined, "schema must be defined");
  }
});

// ---------------------------------------------------------------------------
// Tier A — parse actual service output
// ---------------------------------------------------------------------------

test("GlidePathScheduleSchema: parses ≥3-step schedule from buildGlidePathSchedule", () => {
  // 150-month goal produces 6 bands (75/25 → 70/30 → 60/40 → 40/60 → 20/80 → 0/100)
  const steps = buildGlidePathSchedule({
    goalType: "home",
    monthsToTarget: 150,
    targetPaise: 5_00_00_000_00,
    fundedPaise: 50_000_00,
    monthlyInflowPaise: 10_000_00,
    equityReturnBps: 1200,
    debtReturnBps: 700,
    today: new Date("2026-08-18"),
  });
  assert.ok(steps.length >= 3, `expected ≥3 steps, got ${steps.length}`);
  for (const step of steps) {
    assert.ok(Number.isInteger(step.projectedCorpusPaise), `projectedCorpusPaise must be integer, got ${step.projectedCorpusPaise}`);
  }
  const result = GlidePathScheduleSchema.safeParse(steps);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

test("RebalancingPlanSchema: redirect_contributions branch — parses actual service output", () => {
  // Equity overweight ₹2L; equity SIPs ₹20k/month → closure 10 months ≤ 18
  const plan = buildRebalancingPlan({
    fundedPaise: 10_00_000_00,
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 20_000_00,
    currentDebtSipPaise: 0,
    goalType: "home",
    glideSteps: [],
  });
  assert.equal(plan.actions[0]?.type, "redirect_contributions");
  const result = RebalancingPlanSchema.safeParse(plan);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

test("RebalancingPlanSchema: switch_corpus branch — parses actual service output", () => {
  // Equity overweight ₹2L; no SIPs → must switch corpus
  const plan = buildRebalancingPlan({
    fundedPaise: 10_00_000_00,
    currentEquityPct: 80,
    currentDebtPct: 20,
    targetEquityPct: 60,
    targetDebtPct: 40,
    currentEquitySipPaise: 0,
    currentDebtSipPaise: 0,
    goalType: "home",
    glideSteps: [],
  });
  assert.equal(plan.actions[0]?.type, "switch_corpus");
  const result = RebalancingPlanSchema.safeParse(plan);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

test("RebalancingPlanSchema: parses output with de-risking schedule (≥2 glide steps)", () => {
  const steps = buildGlidePathSchedule({
    goalType: "home",
    monthsToTarget: 24,
    targetPaise: null,
    fundedPaise: 5_00_000_00,
    monthlyInflowPaise: 0,
    equityReturnBps: 1200,
    debtReturnBps: 700,
    today: new Date("2026-08-18"),
  });
  const plan = buildRebalancingPlan({
    fundedPaise: 5_00_000_00,
    currentEquityPct: 20,
    currentDebtPct: 80,
    targetEquityPct: 20,
    targetDebtPct: 80,
    currentEquitySipPaise: 0,
    currentDebtSipPaise: 0,
    goalType: "home",
    glideSteps: steps,
  });
  assert.equal(plan.deRiskingSchedule.length, 1);
  const result = RebalancingPlanSchema.safeParse(plan);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

test("InstrumentGuidanceSchema: parses actual service output (equity leg, 72-month horizon)", () => {
  const guidance = buildInstrumentGuidance("equity", 72, [], new Date("2026-08-18"));
  const result = InstrumentGuidanceSchema.safeParse(guidance);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.leg, "equity");
  assert.ok(result.data!.suggestions.length > 0);
});

test("InstrumentGuidanceSchema: parses debt leg output", () => {
  const guidance = buildInstrumentGuidance("debt", 36, [], new Date("2026-08-18"));
  const result = InstrumentGuidanceSchema.safeParse(guidance);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.leg, "debt");
});

test("MultiGoalAllocationPlanSchema: parses actual service output", () => {
  const plan = allocateAcrossGoals(
    [
      {
        id: "g1",
        goalType: "home",
        monthsToTarget: 60,
        requiredMonthlyPaise: 20_000_00,
        fundedPaise: 5_00_000_00,
        targetPaise: 50_00_000_00,
        blendedReturnBps: 1000,
        sortOrder: 1,
      },
      {
        id: "g2",
        goalType: "retirement",
        monthsToTarget: 240,
        requiredMonthlyPaise: 15_000_00,
        fundedPaise: 10_00_000_00,
        targetPaise: 200_00_000_00,
        blendedReturnBps: 1200,
        sortOrder: 2,
      },
    ],
    30_000_00,
  );
  const result = MultiGoalAllocationPlanSchema.safeParse(plan);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
});

// ---------------------------------------------------------------------------
// Tier B — fixtures built from exported pure helpers, satisfies-annotated
// ---------------------------------------------------------------------------

test("IncomeSurplusResultSchema: parses satisfies-checked fixture built from computeIncomeSurplus", () => {
  const months: ServiceMonthlyIncome[] = [
    { month: "2026-01", incomePaise: 1_00_000_00, likelyBonus: false },
    { month: "2026-02", incomePaise: 1_05_000_00, likelyBonus: false },
    { month: "2026-03", incomePaise: 1_02_000_00, likelyBonus: false },
    { month: "2026-04", incomePaise: 3_00_000_00, likelyBonus: true },
    { month: "2026-05", incomePaise: 98_000_00, likelyBonus: false },
    { month: "2026-06", incomePaise: 1_01_000_00, likelyBonus: false },
    { month: "2026-07", incomePaise: 99_000_00, likelyBonus: false },
    { month: "2026-08", incomePaise: 1_03_000_00, likelyBonus: false },
  ];
  const committedOutflows: ServiceCommittedOutflow[] = [
    { monthlyPaise: 15_000_00, kind: "sip", label: "SIP (goal abc)" },
    { monthlyPaise: 5_000_00, kind: "recurring", label: "Netflix" },
  ];
  const computation: IncomeSurplusComputation = { months, committedOutflows };
  const fixture = { months, committedOutflows, ...computeIncomeSurplus(computation) } satisfies ServiceIncomeSurplusResult;

  const result = IncomeSurplusResultSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.ok(result.data!.conservativeSurplusPaise !== undefined);
  assert.ok(result.data!.optimisticSurplusPaise !== undefined);
});

test("IncomeSurplusResultSchema: parses fixture with null surplus (< 3 months)", () => {
  const months: ServiceMonthlyIncome[] = [
    { month: "2026-07", incomePaise: 1_00_000_00, likelyBonus: false },
    { month: "2026-08", incomePaise: 1_05_000_00, likelyBonus: false },
  ];
  const committedOutflows: ServiceCommittedOutflow[] = [];
  const computation: IncomeSurplusComputation = { months, committedOutflows };
  const fixture = { months, committedOutflows, ...computeIncomeSurplus(computation) } satisfies ServiceIncomeSurplusResult;

  assert.equal(fixture.conservativeSurplusPaise, null);
  assert.equal(fixture.optimisticSurplusPaise, null);
  const result = IncomeSurplusResultSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.conservativeSurplusPaise, null);
  assert.equal(result.data!.optimisticSurplusPaise, null);
});

test("DataCompletenessReportSchema: parses satisfies-checked fixture built from computeConfidence", () => {
  const accounts = [
    {
      accountName: "HDFC Savings",
      lastImportDaysAgo: 2,
      lastValuationDaysAgo: null,
      dataFreshness: "fresh" as const,
    },
    {
      accountName: "MF Portfolio",
      lastImportDaysAgo: null,
      lastValuationDaysAgo: 5,
      dataFreshness: "fresh" as const,
    },
  ];
  const { confidence, confidenceReasons } = computeConfidence({
    accounts,
    unresolvedDraftCount: 0,
    lastSnapshotDaysAgo: 3,
  });

  const fixture = {
    asOf: "2026-08-18",
    accounts: [
      {
        accountId: "acc-001",
        accountName: "HDFC Savings",
        accountType: "bank",
        lastImportedAt: "2026-08-16",
        lastImportDaysAgo: 2,
        unmatchedStatementLines: null,
        lastValuationAt: null,
        lastValuationDaysAgo: null,
        dataFreshness: "fresh" as const,
      },
      {
        accountId: "acc-002",
        accountName: "MF Portfolio",
        accountType: "investment",
        lastImportedAt: null,
        lastImportDaysAgo: null,
        unmatchedStatementLines: null,
        lastValuationAt: "2026-08-13",
        lastValuationDaysAgo: 5,
        dataFreshness: "fresh" as const,
      },
    ],
    unresolvedDraftCount: 0,
    lastSnapshotAt: "2026-08-15",
    lastSnapshotDaysAgo: 3,
    confidence,
    confidenceReasons,
  } satisfies ServiceDataCompletenessReport;

  const result = DataCompletenessReportSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.confidence, "high");
});

test("DataCompletenessReportSchema: parses fixture with null snapshot dates", () => {
  const { confidence, confidenceReasons } = computeConfidence({
    accounts: [],
    unresolvedDraftCount: 0,
    lastSnapshotDaysAgo: null,
  });
  const fixture = {
    asOf: "2026-08-18",
    accounts: [],
    unresolvedDraftCount: 0,
    lastSnapshotAt: null,
    lastSnapshotDaysAgo: null,
    confidence,
    confidenceReasons,
  } satisfies ServiceDataCompletenessReport;

  const result = DataCompletenessReportSchema.safeParse(fixture);
  assert.equal(result.success, true, `safeParse failed: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
  assert.equal(result.data!.lastSnapshotAt, null);
  assert.equal(result.data!.lastSnapshotDaysAgo, null);
});

// ---------------------------------------------------------------------------
// Negative tests — required-nullable fields must be present
// ---------------------------------------------------------------------------

test("negative: omitting conservativeSurplusPaise from IncomeSurplusResult fails", () => {
  const valid = {
    historyMonths: 3,
    months: [],
    committedOutflows: [],
    totalCommittedPaise: 0,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    confidence: "low" as const,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).conservativeSurplusPaise;
  const result = IncomeSurplusResultSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting conservativeSurplusPaise must fail");
});

test("negative: omitting optimisticSurplusPaise from IncomeSurplusResult fails", () => {
  const valid = {
    historyMonths: 3,
    months: [],
    committedOutflows: [],
    totalCommittedPaise: 0,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    confidence: "low" as const,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).optimisticSurplusPaise;
  const result = IncomeSurplusResultSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting optimisticSurplusPaise must fail");
});

test("negative: omitting lastSnapshotAt from DataCompletenessReport fails", () => {
  const valid = {
    asOf: "2026-08-18",
    accounts: [],
    unresolvedDraftCount: 0,
    lastSnapshotAt: null,
    lastSnapshotDaysAgo: null,
    confidence: "low" as const,
    confidenceReasons: [],
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).lastSnapshotAt;
  const result = DataCompletenessReportSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting lastSnapshotAt must fail");
});

test("negative: omitting lastSnapshotDaysAgo from DataCompletenessReport fails", () => {
  const valid = {
    asOf: "2026-08-18",
    accounts: [],
    unresolvedDraftCount: 0,
    lastSnapshotAt: null,
    lastSnapshotDaysAgo: null,
    confidence: "low" as const,
    confidenceReasons: [],
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).lastSnapshotDaysAgo;
  const result = DataCompletenessReportSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting lastSnapshotDaysAgo must fail");
});

test("negative: omitting lockInSummary (nullable) from InstrumentSuggestion fails", () => {
  // lockInSummary is required-but-nullable: must be present (null or string)
  const valid = {
    category: "equity_mf",
    label: "Equity mutual fund",
    tier: "suitable",
    rationale: "Some rationale",
    lockInConflict: false,
    lockInSummary: null,
    taxSummary: "LTCG 12.5%",
    liquiditySummary: "Redeemable anytime",
    alreadyHeld: false,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).lockInSummary;
  const result = InstrumentSuggestionSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting lockInSummary must fail");
});

test("negative: omitting slipMonths (nullable) from GoalAllocationResult fails", () => {
  const valid = {
    goalId: "g1",
    allocatedMonthlyPaise: 0,
    fullyCovered: true,
    slipMonths: null,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).slipMonths;
  const result = GoalAllocationResultSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting slipMonths must fail");
});

test("negative: omitting requiredMonthlyPaise (nullable) from GlideStep fails", () => {
  const valid = {
    fromDate: "2026-08-18",
    toDate: "2027-08-18",
    equityPct: 75,
    debtPct: 25,
    monthsRemaining: 150,
    requiredMonthlyPaise: null,
    projectedCorpusPaise: 50_000_00,
  };
  const withoutField = { ...valid };
  delete (withoutField as Partial<typeof withoutField>).requiredMonthlyPaise;
  const result = GlideStepSchema.safeParse(withoutField);
  assert.equal(result.success, false, "omitting requiredMonthlyPaise must fail");
});

// ---------------------------------------------------------------------------
// Enum rejection tests
// ---------------------------------------------------------------------------

test("negative: invalid confidence value in IncomeSurplusResult fails", () => {
  const result = IncomeSurplusResultSchema.safeParse({
    historyMonths: 3,
    months: [],
    committedOutflows: [],
    totalCommittedPaise: 0,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    confidence: "very_high",
  });
  assert.equal(result.success, false);
});

test("negative: invalid overweightLeg in DriftAnalysis fails", () => {
  const result = DriftAnalysisSchema.safeParse({
    equityCurrentPaise: 100,
    equityTargetPaise: 100,
    debtCurrentPaise: 100,
    debtTargetPaise: 100,
    overweightLeg: "gold",
    driftPaise: 0,
  });
  assert.equal(result.success, false);
});

test("negative: invalid type in RebalancingAction fails discriminated union", () => {
  const result = RebalancingActionSchema.safeParse({
    type: "do_nothing",
    fromLeg: "equity",
    toLeg: "debt",
  });
  assert.equal(result.success, false);
});

test("negative: invalid tier in InstrumentSuggestion fails", () => {
  const result = InstrumentSuggestionSchema.safeParse({
    category: "equity_mf",
    label: "Equity mutual fund",
    tier: "risky",
    rationale: "Some rationale",
    lockInConflict: false,
    lockInSummary: null,
    taxSummary: "LTCG",
    liquiditySummary: "Redeemable",
    alreadyHeld: false,
  });
  assert.equal(result.success, false);
});

test("negative: invalid InstrumentCategory in InstrumentSuggestion fails", () => {
  const result = InstrumentSuggestionSchema.safeParse({
    category: "crypto",
    label: "Bitcoin",
    tier: "caution",
    rationale: "Not real",
    lockInConflict: false,
    lockInSummary: null,
    taxSummary: "None",
    liquiditySummary: "Liquid",
    alreadyHeld: false,
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Table-driven fractional money rejection — proves .int() is enforced
// ---------------------------------------------------------------------------

test("fractional money: IncomeSurplusResult rejects 123.5 in every money field", () => {
  const baseMonthlyIncome = { month: "2026-08", incomePaise: 100_000, likelyBonus: false };
  const baseCommitted = { monthlyPaise: 10_000, kind: "recurring" as const, label: "Test" };
  const baseResult = {
    historyMonths: 6,
    months: [baseMonthlyIncome],
    committedOutflows: [baseCommitted],
    totalCommittedPaise: 10_000,
    conservativeSurplusPaise: 50_000,
    optimisticSurplusPaise: 60_000,
    confidence: "medium" as const,
  };

  const moneyFieldCases: Array<[string, unknown]> = [
    ["months[0].incomePaise", { ...baseResult, months: [{ ...baseMonthlyIncome, incomePaise: 123.5 }] }],
    ["committedOutflows[0].monthlyPaise", { ...baseResult, committedOutflows: [{ ...baseCommitted, monthlyPaise: 123.5 }] }],
    ["totalCommittedPaise", { ...baseResult, totalCommittedPaise: 123.5 }],
    ["conservativeSurplusPaise", { ...baseResult, conservativeSurplusPaise: 123.5 }],
    ["optimisticSurplusPaise", { ...baseResult, optimisticSurplusPaise: 123.5 }],
  ];

  for (const [field, input] of moneyFieldCases) {
    const result = IncomeSurplusResultSchema.safeParse(input);
    assert.equal(result.success, false, `IncomeSurplusResult.${field} must reject 123.5`);
  }
});

test("fractional money: MultiGoalAllocationPlan rejects 123.5 in every money field", () => {
  const baseGoal = {
    goalId: "g1",
    allocatedMonthlyPaise: 10_000,
    fullyCovered: true,
    slipMonths: 0,
  };
  const base = {
    perGoal: [baseGoal],
    totalAllocatedPaise: 10_000,
    freeCashPaise: 5_000,
  };

  const cases: Array<[string, unknown]> = [
    ["perGoal[0].allocatedMonthlyPaise", { ...base, perGoal: [{ ...baseGoal, allocatedMonthlyPaise: 123.5 }] }],
    ["totalAllocatedPaise", { ...base, totalAllocatedPaise: 123.5 }],
    ["freeCashPaise", { ...base, freeCashPaise: 123.5 }],
  ];

  for (const [field, input] of cases) {
    const result = MultiGoalAllocationPlanSchema.safeParse(input);
    assert.equal(result.success, false, `MultiGoalAllocationPlan.${field} must reject 123.5`);
  }
});

test("fractional money: GlidePathSchedule rejects 123.5 in every money field", () => {
  const baseStep = {
    fromDate: "2026-08-18",
    toDate: "2027-08-18",
    equityPct: 75,
    debtPct: 25,
    monthsRemaining: 150,
    requiredMonthlyPaise: 10_000,
    projectedCorpusPaise: 50_000,
  };

  const cases: Array<[string, unknown]> = [
    ["[0].requiredMonthlyPaise", [{ ...baseStep, requiredMonthlyPaise: 123.5 }]],
    ["[0].projectedCorpusPaise", [{ ...baseStep, projectedCorpusPaise: 123.5 }]],
  ];

  for (const [field, input] of cases) {
    const result = GlidePathScheduleSchema.safeParse(input);
    assert.equal(result.success, false, `GlidePathSchedule.${field} must reject 123.5`);
  }
});

test("fractional money: RebalancingPlan rejects 123.5 in every money field", () => {
  const baseDrift = {
    equityCurrentPaise: 6_000_000,
    equityTargetPaise: 6_000_000,
    debtCurrentPaise: 4_000_000,
    debtTargetPaise: 4_000_000,
    overweightLeg: "none" as const,
    driftPaise: 0,
  };
  const baseRedirect = {
    type: "redirect_contributions" as const,
    fromLeg: "equity" as const,
    toLeg: "debt" as const,
    monthlyAmountPaise: 20_000,
    estimatedClosureMonths: 10,
  };
  const baseSwitch = {
    type: "switch_corpus" as const,
    fromLeg: "equity" as const,
    toLeg: "debt" as const,
    amountPaise: 2_000_000,
  };
  const baseDeRisk = {
    fromDate: "2027-08-18",
    fromEquityPct: 20,
    fromDebtPct: 80,
    toEquityPct: 0,
    toDebtPct: 100,
    equityToSwitchPaise: 10_800_000,
  };
  const base = {
    drift: baseDrift,
    actions: [],
    deRiskingSchedule: [baseDeRisk],
  };

  const cases: Array<[string, unknown]> = [
    ["drift.equityCurrentPaise", { ...base, drift: { ...baseDrift, equityCurrentPaise: 123.5 } }],
    ["drift.equityTargetPaise",  { ...base, drift: { ...baseDrift, equityTargetPaise: 123.5 } }],
    ["drift.debtCurrentPaise",  { ...base, drift: { ...baseDrift, debtCurrentPaise: 123.5 } }],
    ["drift.debtTargetPaise",   { ...base, drift: { ...baseDrift, debtTargetPaise: 123.5 } }],
    ["drift.driftPaise",        { ...base, drift: { ...baseDrift, driftPaise: 123.5 } }],
    ["actions[0].monthlyAmountPaise (redirect)", { ...base, actions: [{ ...baseRedirect, monthlyAmountPaise: 123.5 }] }],
    ["actions[0].amountPaise (switch)",          { ...base, actions: [{ ...baseSwitch, amountPaise: 123.5 }] }],
    ["deRiskingSchedule[0].equityToSwitchPaise", { ...base, deRiskingSchedule: [{ ...baseDeRisk, equityToSwitchPaise: 123.5 }] }],
  ];

  for (const [field, input] of cases) {
    const result = RebalancingPlanSchema.safeParse(input);
    assert.equal(result.success, false, `RebalancingPlan.${field} must reject 123.5`);
  }
});

// ---------------------------------------------------------------------------
// Non-finite rejection tests (NaN, Infinity) for money fields
// ---------------------------------------------------------------------------

test("non-finite: totalCommittedPaise rejects NaN", () => {
  const result = IncomeSurplusResultSchema.safeParse({
    historyMonths: 3,
    months: [],
    committedOutflows: [],
    totalCommittedPaise: NaN,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    confidence: "low" as const,
  });
  assert.equal(result.success, false, "NaN must be rejected");
});

test("non-finite: totalCommittedPaise rejects Infinity", () => {
  const result = IncomeSurplusResultSchema.safeParse({
    historyMonths: 3,
    months: [],
    committedOutflows: [],
    totalCommittedPaise: Infinity,
    conservativeSurplusPaise: null,
    optimisticSurplusPaise: null,
    confidence: "low" as const,
  });
  assert.equal(result.success, false, "Infinity must be rejected");
});

test("non-finite: projectedCorpusPaise rejects NaN", () => {
  const result = GlideStepSchema.safeParse({
    fromDate: "2026-08-18",
    toDate: "2027-08-18",
    equityPct: 75,
    debtPct: 25,
    monthsRemaining: 150,
    requiredMonthlyPaise: null,
    projectedCorpusPaise: NaN,
  });
  assert.equal(result.success, false, "NaN must be rejected");
});

test("non-finite: projectedCorpusPaise rejects -Infinity", () => {
  const result = GlideStepSchema.safeParse({
    fromDate: "2026-08-18",
    toDate: "2027-08-18",
    equityPct: 75,
    debtPct: 25,
    monthsRemaining: 150,
    requiredMonthlyPaise: null,
    projectedCorpusPaise: -Infinity,
  });
  assert.equal(result.success, false, "-Infinity must be rejected");
});

test("non-finite: driftPaise rejects NaN and Infinity", () => {
  const base = {
    equityCurrentPaise: 100,
    equityTargetPaise: 100,
    debtCurrentPaise: 100,
    debtTargetPaise: 100,
    overweightLeg: "none" as const,
    driftPaise: 0,
  };
  assert.equal(DriftAnalysisSchema.safeParse({ ...base, driftPaise: NaN }).success, false, "NaN rejected");
  assert.equal(DriftAnalysisSchema.safeParse({ ...base, driftPaise: Infinity }).success, false, "Infinity rejected");
});

// ---------------------------------------------------------------------------
// Format validation tests
// ---------------------------------------------------------------------------

test("negative: invalid date format (not YYYY-MM-DD) in GlideStep.fromDate fails", () => {
  const result = GlideStepSchema.safeParse({
    fromDate: "18/08/2026",
    toDate: "2027-08-18",
    equityPct: 75,
    debtPct: 25,
    monthsRemaining: 150,
    requiredMonthlyPaise: null,
    projectedCorpusPaise: 50_000,
  });
  assert.equal(result.success, false, "DD/MM/YYYY must fail for z.iso.date()");
});

test("negative: invalid year-month format in MonthlyIncome.month fails", () => {
  const result = MonthlyIncomeSchema.safeParse({
    month: "2026-13",  // month 13 is invalid
    incomePaise: 100_000,
    likelyBonus: false,
  });
  assert.equal(result.success, false, "YYYY-13 must fail");
});

test("negative: YYYY-MM-DD not accepted for MonthlyIncome.month (must be YYYY-MM)", () => {
  const result = MonthlyIncomeSchema.safeParse({
    month: "2026-08-18",  // too long — must be YYYY-MM only
    incomePaise: 100_000,
    likelyBonus: false,
  });
  assert.equal(result.success, false, "YYYY-MM-DD must not match YYYY-MM format");
});
