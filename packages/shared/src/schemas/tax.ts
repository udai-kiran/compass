/**
 * tax.ts — shared Zod contracts for the tax module (task 13.1).
 *
 * Covers:
 *  - Regime preference GET/PUT API
 *
 * Persistence source of truth: apps/api/src/modules/tax/schema.ts.
 */

import { z } from "zod";

/** Canonical Indian FY label: "YYYY-YY" (e.g. "2025-26"). */
export const FySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'FY must be in "YYYY-YY" format (e.g. "2025-26")')
  .refine(
    (fy) => {
      const startYear = Number(fy.slice(0, 4));
      const expectedEndYY = (startYear + 1) % 100;
      const actualEndYY = Number(fy.slice(5, 7));
      return actualEndYY === expectedEndYY;
    },
    {
      message:
        'FY end-year suffix must be exactly (start year + 1) mod 100 (e.g. "2025-26", "1999-00")',
    },
  );

/** Income-tax regime. */
export const RegimeSchema = z.enum(["old", "new"]);
export type Regime = z.infer<typeof RegimeSchema>;

/** The source that determined the effective regime. */
export const RegimeSourceSchema = z.enum(["chosen", "inferred", "default"]);
export type RegimeSource = z.infer<typeof RegimeSourceSchema>;

// ─── Regime preference ───────────────────────────────────────────────────────

/** Response body for GET /api/tax/regime-preference and the PUT response. */
export const RegimePreferenceSchema = z.object({
  fy: FySchema,
  /** User's explicit choice. null = not yet explicitly chosen. */
  chosen: RegimeSchema.nullable(),
  /** Inferred from payslip TDS. null = not yet inferred. */
  inferredRegime: RegimeSchema.nullable(),
  /** ISO timestamp of when the inferred regime was last set. */
  inferredAt: z.string().nullable(),
  /** Resolved effective regime: chosen ?? inferredRegime ?? 'new'. */
  effective: RegimeSchema,
  /** What determined the effective value. */
  source: RegimeSourceSchema,
});
export type RegimePreference = z.infer<typeof RegimePreferenceSchema>;

/** Query parameters for GET /api/tax/regime-preference. */
export const GetRegimePreferenceQuerySchema = z.object({
  fy: FySchema,
});
export type GetRegimePreferenceQuery = z.infer<typeof GetRegimePreferenceQuerySchema>;

/** Request body for PUT /api/tax/regime-preference. */
export const UpsertRegimePreferenceBodySchema = z.object({
  fy: FySchema,
  /** The user's explicit regime choice. */
  chosen: RegimeSchema,
});
export type UpsertRegimePreferenceBody = z.infer<typeof UpsertRegimePreferenceBodySchema>;

// ─── Payslip (task 13.2) ──────────────────────────────────────────────────────

/**
 * Canonical component kinds for payslip line items.
 *
 * - employee_epf → 80C basket (recognized provident fund, ₹1.5L cap)
 * - employer_epf → recognized PF treatment (NOT 80C or 80CCD(2))
 * - eps           → pension diversion of employer contribution
 * - vpf           → Voluntary Provident Fund (→ 80C eligible, same basket as employee_epf)
 */
export const CanonicalComponentKindSchema = z.enum([
  "basic",
  "hra",
  "special_allowance",
  "other_earning",
  "employee_epf",
  "employer_epf",
  "eps",
  "vpf",
  "professional_tax",
  "other_deduction",
  "employer_contribution",
]);
export type CanonicalComponentKind = z.infer<typeof CanonicalComponentKindSchema>;

/** Broad category a payslip component belongs to. */
export const ComponentCategorySchema = z.enum(["earning", "deduction", "employer_contribution"]);
export type ComponentCategory = z.infer<typeof ComponentCategorySchema>;

/** Payslip lifecycle state. Transitions: pending → accepted | rejected only. */
export const PayslipStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type PayslipStatus = z.infer<typeof PayslipStatusSchema>;

/** Pay month in "YYYY-MM" format (e.g. "2025-06"). */
export const PayMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Pay month must be in "YYYY-MM" format (e.g. "2025-06")')
  .refine(
    (pm) => {
      const month = Number(pm.slice(5, 7));
      return month >= 1 && month <= 12;
    },
    { message: "Pay month must have a valid month (01–12)" },
  );

/** One payslip component (earning, deduction, or employer contribution). */
export const PayslipComponentSchema = z.object({
  id: z.uuid(),
  payslipId: z.uuid(),
  rawLabel: z.string(),
  canonicalKind: CanonicalComponentKindSchema,
  category: ComponentCategorySchema,
  currentPaise: z.number().int(),
  ytdPaise: z.number().int().nullable(),
  sourceQuote: z.string().nullable(),
  confidence: z.number().nullable(),
  displayOrder: z.number().int(),
  createdAt: z.string(),
});
export type PayslipComponent = z.infer<typeof PayslipComponentSchema>;

/**
 * Payslip header DTO — summary fields plus associated components.
 * Pending rows feed no downstream computation (D3).
 */
export const PayslipSchema = z.object({
  id: z.uuid(),
  fy: FySchema,
  payMonth: PayMonthSchema,
  employerName: z.string().nullable(),
  documentKey: z.string().nullable(),
  status: PayslipStatusSchema,
  grossPaise: z.number().int().nullable(),
  netPaise: z.number().int().nullable(),
  /** TDS deducted this month — used for FY aggregate (D4). */
  tdsCurrentPaise: z.number().int().nullable(),
  /** YTD as printed; for reconciliation only, never summed (D4). */
  tdsYtdPaise: z.number().int().nullable(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  components: z.array(PayslipComponentSchema),
});
export type Payslip = z.infer<typeof PayslipSchema>;

/**
 * List response with per-FY TDS aggregate (D4).
 * fyTdsPaise = SUM(tds_current_paise) over ACCEPTED payslips for the queried FY.
 */
export const PayslipListSchema = z.object({
  payslips: z.array(PayslipSchema),
  fyTdsPaise: z.number().int(),
});
export type PayslipList = z.infer<typeof PayslipListSchema>;

/** Query parameters for GET /api/tax/payslips?fy= */
export const GetPayslipsQuerySchema = z.object({
  fy: FySchema,
});
export type GetPayslipsQuery = z.infer<typeof GetPayslipsQuerySchema>;

/** Manual payslip entry body. Creates directly in accepted state. */
export const CreateManualPayslipBodySchema = z
  .object({
    fy: FySchema,
    payMonth: PayMonthSchema,
    employerName: z.string().min(1).optional(),
    grossPaise: z.number().int().min(0).optional(),
    netPaise: z.number().int().min(0).optional(),
    tdsCurrentPaise: z.number().int().min(0).optional(),
    tdsYtdPaise: z.number().int().min(0).optional(),
    components: z
      .array(
        z.object({
          rawLabel: z.string().min(1),
          canonicalKind: CanonicalComponentKindSchema,
          category: ComponentCategorySchema,
          currentPaise: z.number().int(),
          ytdPaise: z.number().int().optional(),
        }),
      )
      .default([]),
  })
  .refine(
    (data) => {
      // Indian FY "YYYY-YY" covers April(YYYY) through March(YYYY+1).
      const [year] = data.fy.split("-");
      const startYear = Number(year);
      const endYear = startYear + 1;
      const [payYearStr, payMonthStr] = data.payMonth.split("-");
      const payYear = Number(payYearStr);
      const payMonth = Number(payMonthStr);
      // Months 4–12 must be in startYear; months 1–3 must be in endYear.
      if (payMonth >= 4 && payMonth <= 12) return payYear === startYear;
      if (payMonth >= 1 && payMonth <= 3) return payYear === endYear;
      return false;
    },
    { message: "payMonth must fall within the specified financial year (Apr–Mar)" },
  );
export type CreateManualPayslipBody = z.infer<typeof CreateManualPayslipBodySchema>;

/**
 * Accept a pending payslip with optional reviewer corrections.
 * Corrections are applied atomically with the status transition (D3).
 */
export const AcceptPayslipBodySchema = z.object({
  /** Corrected header values — omitted means keep extracted value. */
  grossPaise: z.number().int().min(0).optional(),
  netPaise: z.number().int().min(0).optional(),
  tdsCurrentPaise: z.number().int().min(0).optional(),
  tdsYtdPaise: z.number().int().min(0).optional(),
  employerName: z.string().min(1).optional(),
  /** Per-component corrections keyed by component id. */
  componentCorrections: z
    .array(
      z.object({
        id: z.uuid(),
        currentPaise: z.number().int().optional(),
        ytdPaise: z.number().int().optional(),
      }),
    )
    .default([]),
});
export type AcceptPayslipBody = z.infer<typeof AcceptPayslipBodySchema>;

/** Response from POST /api/tax/payslips (upload + parse). */
export const ParsePayslipResponseSchema = z.object({
  available: z.boolean(),
  message: z.string().optional(),
  payslip: PayslipSchema.optional(),
});
export type ParsePayslipResponse = z.infer<typeof ParsePayslipResponseSchema>;

// ─── Income Events (task 13.4) ────────────────────────────────────────────────

/** Income event lifecycle state. Transitions: pending → accepted | rejected only. */
export const IncomeEventStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type IncomeEventStatus = z.infer<typeof IncomeEventStatusSchema>;

/**
 * Broad income classification.
 * salary: employment income (from payslips)
 * interest: FD/RD/NSC interest income
 * dividend: MF/stock dividend
 * rent: rental income
 * other: any other taxable income
 */
export const IncomeKindSchema = z.enum(["salary", "interest", "dividend", "rent", "other"]);
export type IncomeKind = z.infer<typeof IncomeKindSchema>;

/**
 * What sourced this income event.
 * payslip: auto-derived from an accepted payslip
 * holding_event: auto-derived from a holding event (dividend)
 * manual: user-entered directly
 * ais: imported from the Annual Information Statement
 */
export const IncomeSourceKindSchema = z.enum(["payslip", "holding_event", "manual", "ais"]);
export type IncomeSourceKind = z.infer<typeof IncomeSourceKindSchema>;

/**
 * Income event DTO (full object returned by get/list/accept/reject).
 * FY is always server-computed; clients never supply it.
 * PAN/TAN are returned as-is (already normalized to uppercase on write).
 */
export const IncomeEventSchema = z.object({
  id: z.uuid(),
  fy: FySchema,
  accrualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "accrualDate must be YYYY-MM-DD"),
  incomeKind: IncomeKindSchema,
  /**
   * Deduction/TDS section: '192' (salary), '194A' (interest), '194K' (MF income),
   * '194-I' (rent). Null = unknown / not applicable.
   */
  section: z.string().nullable(),
  sourceKind: IncomeSourceKindSchema,
  sourceId: z.uuid().nullable(),
  /**
   * Precedence when two sources describe the same underlying income (higher wins).
   * Defaults to 0 on every creation path; reconciliation is out of scope for 13.4.
   */
  sourcePriority: z.number().int(),
  payerName: z.string().nullable(),
  payerPan: z.string().nullable(),
  payerTan: z.string().nullable(),
  grossPaise: z.number().int().min(0),
  tdsPaise: z.number().int().min(0),
  /** Computed (never persisted): grossPaise - tdsPaise. */
  afterTdsPaise: z.number().int(),
  notes: z.string().nullable(),
  status: IncomeEventStatusSchema,
  acceptedAt: z.string().nullable(),
  originalValues: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IncomeEvent = z.infer<typeof IncomeEventSchema>;

/**
 * Request body for manually creating an income event.
 * FY is never accepted from the client — always computed server-side
 * via fyOf(accrualDate).
 * `sourceKind` is NOT part of this body: the manual-create path always persists
 * sourceKind='manual' / sourceId=NULL, so a client cannot claim payslip,
 * holding_event or ais provenance.
 * `accrualDate` uses z.iso.date(), which rejects impossible calendar dates
 * (e.g. 2025-02-30) with a typed 400 before fyOf() ever runs.
 * PAN/TAN are normalized: trimmed and uppercased before storage.
 */
export const CreateIncomeEventBodySchema = z
  .object({
    accrualDate: z.iso.date(),
    incomeKind: IncomeKindSchema,
    /**
     * Deduction/TDS section (e.g. '192', '194A', '194K', '194-I').
     * Null or omitted = unknown/not applicable. Never supply fy or sourcePriority
     * here — those are server-controlled.
     */
    section: z.string().min(1).nullable().optional(),
    payerName: z.string().min(1).nullable().optional(),
    payerPan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format")
      .nullable()
      .optional(),
    payerTan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "Invalid TAN format")
      .nullable()
      .optional(),
    grossPaise: z.number().int().min(0),
    tdsPaise: z.number().int().min(0).optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((data) => (data.tdsPaise ?? 0) <= data.grossPaise, {
    message: "tdsPaise cannot exceed grossPaise",
    path: ["tdsPaise"],
  });
export type CreateIncomeEventBody = z.infer<typeof CreateIncomeEventBodySchema>;

/**
 * Request body for accepting an income event.
 * Corrections to payer_name, payer_pan, payer_tan, notes are applied atomically
 * with the status transition. Pre-accept state is stored in original_values.
 * PAN/TAN are normalized: trimmed and uppercased before storage.
 */
export const AcceptIncomeEventBodySchema = z.object({
  payerName: z.string().min(1).optional(),
  payerPan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format")
    .nullable()
    .optional(),
  payerTan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "Invalid TAN format")
    .nullable()
    .optional(),
  notes: z.string().nullable().optional(),
});
export type AcceptIncomeEventBody = z.infer<typeof AcceptIncomeEventBodySchema>;

/** Per-income-kind breakdown in the summary. */
export const IncomeKindSummarySchema = z.object({
  grossPaise: z.number().int(),
  tdsPaise: z.number().int(),
  count: z.number().int(),
});
export type IncomeKindSummary = z.infer<typeof IncomeKindSummarySchema>;

/**
 * FY income summary — aggregates only accepted rows for monetary totals.
 * Pending rows contribute only to pendingCount.
 * Rejected rows are excluded entirely.
 * isEstimate: always true (pending rows may be confirmed later).
 */
export const IncomeEventSummarySchema = z.object({
  fy: FySchema,
  totalGrossPaise: z.number().int(),
  totalTdsPaise: z.number().int(),
  /** Always true: pending rows may still be accepted. */
  isEstimate: z.boolean(),
  /** Count of accepted rows — the only rows contributing to the monetary totals. */
  acceptedCount: z.number().int(),
  /** Count of rows currently in pending status. */
  pendingCount: z.number().int(),
  /**
   * Human-readable caveats. Always states that salary figures are GROSS, not
   * taxable salary (exemptions/deductions live in payslip components and are
   * applied downstream).
   */
  notes: z.array(z.string()),
  /** Breakdown by income kind — all 5 kinds always present (zero if none). */
  byKind: z.object({
    salary: IncomeKindSummarySchema,
    interest: IncomeKindSummarySchema,
    dividend: IncomeKindSummarySchema,
    rent: IncomeKindSummarySchema,
    other: IncomeKindSummarySchema,
  }),
});
export type IncomeEventSummary = z.infer<typeof IncomeEventSummarySchema>;

/** Query parameters for GET /api/tax/income-events. */
export const GetIncomeEventsQuerySchema = z.object({
  fy: FySchema.optional(),
  status: IncomeEventStatusSchema.optional(),
  incomeKind: IncomeKindSchema.optional(),
});
export type GetIncomeEventsQuery = z.infer<typeof GetIncomeEventsQuerySchema>;

/** Query parameters for GET /api/tax/income-events/summary. */
export const GetIncomeEventsSummaryQuerySchema = z.object({
  fy: FySchema,
});
export type GetIncomeEventsSummaryQuery = z.infer<typeof GetIncomeEventsSummaryQuerySchema>;

// ─── EPF Contributions (task 13.5) ───────────────────────────────────────────

/**
 * Reconciliation status for an EPF contribution row.
 * pending:   any component with a non-null expected value (including zero, except VPF's zero-skip exception) still has a null actual, OR all four actuals are null.
 * matched:   all relevant components (per the pending rule above) have actuals within 1% of expected.
 * mismatch:  all relevant components (per the pending rule above) have actuals; ≥1 differs by >1%.
 * confirmed: RESERVED — set only by a future explicit user-override action, never
 *            computed automatically by computeStatus(). Do not use as an output
 *            of the state machine; it will never be returned by computeStatus.
 */
export const ReconciliationStatusSchema = z.enum(["pending", "matched", "mismatch", "confirmed"]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

/**
 * EPF contribution row DTO.
 *
 * expectedVpfPaise defaults to 0 (NOT NULL in DB).
 * eligible80cPaise = (actual_employee ?? expected_employee ?? 0) + (actual_vpf ?? expected_vpf ?? 0).
 * employer_epf is NOT 80C eligible — carry it separately.
 */
export const EpfContributionSchema = z.object({
  id: z.uuid(),
  wageMonth: PayMonthSchema,
  employerName: z.string().nullable(),
  epfoMemberId: z.string(),
  // Expected (from payslip)
  expectedEmployeePaise: z.number().int().nullable(),
  expectedEmployerPaise: z.number().int().nullable(),
  expectedEpsPaise: z.number().int().nullable(),
  expectedVpfPaise: z.number().int(),
  payslipId: z.uuid().nullable(),
  // Actual (from passbook confirmation)
  actualEmployeePaise: z.number().int().nullable(),
  actualEmployerPaise: z.number().int().nullable(),
  actualEpsPaise: z.number().int().nullable(),
  actualVpfPaise: z.number().int().nullable(),
  // Status
  reconciliationStatus: ReconciliationStatusSchema,
  gapReason: z.string().nullable(),
  /** employee + vpf 80C eligible amount (uses actual if confirmed, expected otherwise). */
  eligible80cPaise: z.number().int(),
  /**
   * Employer EPF/EPS invariant: employer_epf (credited to PF corpus) + eps (diverted to
   * pension fund) = gross employer share (no fixed-rate check — the actual rate varies by employer/payslip).
   * Uses actual values if confirmed, expected values otherwise.
   * NOT 80C eligible — employer contributions are recognized PF (perquisite treatment).
   */
  grossEmployerContributionPaise: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EpfContribution = z.infer<typeof EpfContributionSchema>;

/** Request body for POST /api/tax/epf-contributions (manual entry). */
export const CreateEpfContributionBodySchema = z.object({
  wageMonth: PayMonthSchema,
  employerName: z.string().min(1).optional(),
  epfoMemberId: z.string().min(1),
  expectedEmployeePaise: z.number().int().min(0).optional(),
  expectedEmployerPaise: z.number().int().min(0).optional(),
  expectedEpsPaise: z.number().int().min(0).optional(),
  expectedVpfPaise: z.number().int().min(0).optional(),
});
export type CreateEpfContributionBody = z.infer<typeof CreateEpfContributionBodySchema>;

/**
 * Request body for POST /api/tax/epf-contributions/import-from-payslip/:payslipId.
 * epfoMemberId is REQUIRED — payslips do not embed the EPFO member ID.
 */
export const ImportFromPayslipBodySchema = z.object({
  epfoMemberId: z.string().min(1),
});
export type ImportFromPayslipBody = z.infer<typeof ImportFromPayslipBodySchema>;

/**
 * Request body for POST /api/tax/epf-contributions/:id/confirm-actual.
 * Confirms the actual values from the EPFO passbook.
 * Reconciliation status is computed and persisted atomically.
 */
export const ConfirmActualBodySchema = z.object({
  actualEmployeePaise: z.number().int().min(0),
  actualEmployerPaise: z.number().int().min(0).nullable().optional(),
  actualEpsPaise: z.number().int().min(0).nullable().optional(),
  actualVpfPaise: z.number().int().min(0).nullable().optional(),
});
export type ConfirmActualBody = z.infer<typeof ConfirmActualBodySchema>;

/** A gap row: expected set but actual not yet confirmed. */
export const EpfGapResultSchema = z.object({
  id: z.uuid(),
  wageMonth: PayMonthSchema,
  employerName: z.string().nullable(),
  epfoMemberId: z.string(),
  expectedEmployeePaise: z.number().int().nullable(),
  expectedEmployerPaise: z.number().int().nullable(),
  expectedEpsPaise: z.number().int().nullable(),
  expectedVpfPaise: z.number().int(),
});
export type EpfGapResult = z.infer<typeof EpfGapResultSchema>;

/**
 * EPF corpus projection response.
 * isEstimate is always true — projection assumes no future contributions.
 * rateSource is always 'last_known_official'.
 * assumedAnnualRateBps: 825 (8.25% p.a. — FY 2024-25 official rate).
 * monthsToRetirement: integer calendar months from now to retirement date.
 * rateApplicableFy: FY label for which the assumed rate was last officially declared.
 * disclaimer: human-readable caveat string.
 */
export const EpfCorpusProjectionSchema = z.object({
  currentCorpusPaise: z.number().int(),
  projectedCorpusPaise: z.number().int(),
  /** Integer calendar months from today to retirement date. */
  monthsToRetirement: z.number().int(),
  retirementDate: z.string(),
  /** Always true — no future contributions are assumed. */
  isEstimate: z.literal(true),
  /** Always 'last_known_official'. */
  rateSource: z.literal("last_known_official"),
  /** FY label for which the assumed rate was last officially declared (e.g. "2024-25"). */
  rateApplicableFy: z.string(),
  assumedAnnualRateBps: z.number().int(),
  /** Human-readable caveat about the estimate. */
  disclaimer: z.string(),
});
export type EpfCorpusProjection = z.infer<typeof EpfCorpusProjectionSchema>;

/** Query parameters for GET /api/tax/epf-contributions. */
export const GetEpfContributionsQuerySchema = z.object({
  fy: FySchema.optional(),
  wageMonth: PayMonthSchema.optional(),
});
export type GetEpfContributionsQuery = z.infer<typeof GetEpfContributionsQuerySchema>;

/** Query parameters for GET /api/tax/epf-contributions/gaps. */
export const GetEpfGapsQuerySchema = z.object({
  fy: FySchema,
});
export type GetEpfGapsQuery = z.infer<typeof GetEpfGapsQuerySchema>;

/** Query parameters for GET /api/tax/epf-contributions/projection. */
export const GetEpfProjectionQuerySchema = z.object({
  accountId: z.uuid(),
  retirementAge: z.coerce.number().int().min(50).max(70).optional(),
});
export type GetEpfProjectionQuery = z.infer<typeof GetEpfProjectionQuerySchema>;

// ─── Scheme-compliance (task 13.6) ───────────────────────────────────────────

/** The three scheme types this compliance check covers. */
export const SchemeKindSchema = z.enum(["ppf", "ssy", "nps_tier1"]);
export type SchemeKind = z.infer<typeof SchemeKindSchema>;

/**
 * Nine-state lifecycle/compliance status for a scheme account in a given FY.
 *
 *   ok                     — contributed within [min, max], no lifecycle issue
 *   below_min              — below the annual minimum (current FY, not yet discontinued)
 *   above_max              — above the statutory ceiling
 *   discontinued_risk      — on track to miss minimum in the current (open) FY
 *   discontinued           — missed minimum in a past (completed) FY → account discontinued
 *   data_missing           — required data absent (e.g. schemeOpenedDate, NPS detail row)
 *   data_invalid           — data present but fails a rule (e.g. SSY holder age > 10)
 *   outside_deposit_window — SSY: past the 15-year deposit window
 *   lifecycle_unknown      — PPF: past maturity date with no extension-mode data
 */
export const SchemeComplianceStatusSchema = z.enum([
  "ok",
  "below_min",
  "above_max",
  "discontinued_risk",
  "discontinued",
  "data_missing",
  "data_invalid",
  "outside_deposit_window",
  "lifecycle_unknown",
]);
export type SchemeComplianceStatus = z.infer<typeof SchemeComplianceStatusSchema>;

/**
 * Per-account scheme-compliance result for a given FY.
 *
 * All amount fields are INTEGER PAISE.
 *
 * Notes:
 *  - `eligible80CPaise` is present on every result but null for NPS (NPS uses CCD sections,
 *    not 80C; the salary-based cap is computed in task 13.8).
 *  - `npsEmployeeContributionPaise` is present on every result but null for PPF/SSY.
 *  - `isEstimate: true` always — contributions are counted from ledger postings
 *    which may be incomplete.
 *  - No CCD(1)/(1B)/(2) allocation fields — those are deferred to tasks 13.7/13.8.
 */
export const AccountComplianceResultSchema = z.object({
  accountId: z.uuid(),
  schemeKind: SchemeKindSchema,
  /** FY label, e.g. "2025-26". */
  fy: z.string(),
  /** Sum of positive non-opening-balance postings to this account in the FY, in paise. */
  annualContributedPaise: z.number().int(),
  /** Statutory annual minimum, in paise. */
  minPaise: z.number().int(),
  /** Statutory annual maximum, in paise; null for NPS Tier I (no statutory max). */
  maxPaise: z.number().int().nullable(),
  statusCode: SchemeComplianceStatusSchema,
  /** max(0, minPaise − annualContributedPaise), in paise. */
  deficitPaise: z.number().int(),
  /** max(0, maxPaise − annualContributedPaise), in paise; null when maxPaise is null. */
  headroomPaise: z.number().int().nullable(),
  /**
   * 80C eligible amount: min(annualContributedPaise, 15_000_000 paise).
   * Null for NPS (which uses CCD sections — allocation deferred to 13.7/13.8).
   */
  eligible80CPaise: z.number().int().nullable(),
  /**
   * Raw employee NPS contribution in paise (= annualContributedPaise for NPS Tier I).
   * Null for PPF/SSY. Salary cap deferred to 13.8.
   */
  npsEmployeeContributionPaise: z.number().int().nullable(),
  /** Always true — contributions are estimated from ledger postings. */
  isEstimate: z.literal(true),
  /** Data gaps, skipped checks, lifecycle notes. */
  notes: z.array(z.string()),
});
export type AccountComplianceResult = z.infer<typeof AccountComplianceResultSchema>;

/** Response envelope for GET /api/tax/scheme-compliance (list). */
export const SchemeComplianceListSchema = z.object({
  results: z.array(AccountComplianceResultSchema),
});
export type SchemeComplianceList = z.infer<typeof SchemeComplianceListSchema>;

/** Query parameters for both scheme-compliance endpoints. */
export const GetSchemeComplianceQuerySchema = z.object({
  /** FY label, e.g. "2025-26". Defaults to the current FY when omitted. */
  fy: z.string().optional(),
});
export type GetSchemeComplianceQuery = z.infer<typeof GetSchemeComplianceQuerySchema>;

// ─── Deduction Entries (task 13.7) ───────────────────────────────────────────

/** Income-tax deduction section for manual entries. */
export const DeductionSectionSchema = z.enum(["80C", "80D", "80CCD1B", "80CCD2"]);
export type DeductionSection = z.infer<typeof DeductionSectionSchema>;

/**
 * Fine-grained kind within a deduction section.
 * Valid (section, kind) pairings are enforced by both superRefine and the DB.
 */
export const DeductionKindSchema = z.enum([
  "nsc_additional",
  "tuition_fees",
  "elss_manual",
  "nps_additional",
  "employer_nps_ccd2",
  "preventive_checkup",
  "other_80c",
  "other_80d",
]);
export type DeductionKind = z.infer<typeof DeductionKindSchema>;

/** Which 80D coverage group a health-insurance deduction entry belongs to. */
export const EightyDGroupSchema = z.enum(["self_family", "parents"]);
export type EightyDGroup = z.infer<typeof EightyDGroupSchema>;

/** Full deduction entry DTO (returned by all CRUD operations). */
export const DeductionEntrySchema = z.object({
  id: z.uuid(),
  fy: FySchema,
  section: DeductionSectionSchema,
  deductionKind: DeductionKindSchema,
  /** Amount in paise; always > 0. */
  amountPaise: z.number().int().positive(),
  description: z.string(),
  /** 'private' | 'government'; non-null only for section='80CCD2'. */
  employerType: z.enum(["private", "government"]).nullable(),
  /** Basic+DA in paise; non-null only for section='80CCD2'. */
  salaryBasePaise: z.number().int().positive().nullable(),
  /** Required only for section='80D'. */
  eightyDGroup: EightyDGroupSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeductionEntry = z.infer<typeof DeductionEntrySchema>;

/**
 * Validates section/kind/group compatibility (mirrors DB check constraints).
 * Called via superRefine on Create — the DB check is the backstop on Update.
 */
function validateSectionKindCompatibility(
  data: {
    section: string;
    deductionKind: string;
    eightyDGroup?: string | null;
    employerType?: string | null;
    salaryBasePaise?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const validKinds: Record<string, string[]> = {
    "80C": ["nsc_additional", "tuition_fees", "elss_manual", "other_80c"],
    "80CCD1B": ["nps_additional"],
    "80CCD2": ["employer_nps_ccd2"],
    "80D": ["preventive_checkup", "other_80d"],
  };
  if (!(validKinds[data.section] ?? []).includes(data.deductionKind)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `deductionKind "${data.deductionKind}" is not valid for section "${data.section}"`,
      path: ["deductionKind"],
    });
  }
  if (data.section === "80D" && !data.eightyDGroup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `eightyDGroup is required for section "80D"`,
      path: ["eightyDGroup"],
    });
  }
  if (data.section === "80CCD2") {
    if (!data.employerType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `employerType is required for section "80CCD2"`,
        path: ["employerType"],
      });
    }
    if (!(data.salaryBasePaise && data.salaryBasePaise > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `salaryBasePaise (positive integer) is required for section "80CCD2"`,
        path: ["salaryBasePaise"],
      });
    }
  }
}

/** Request body for POST /api/tax/deductions/entries */
export const CreateDeductionEntrySchema = z
  .object({
    fy: FySchema,
    section: DeductionSectionSchema,
    deductionKind: DeductionKindSchema,
    amountPaise: z.number().int().positive(),
    description: z.string().default(""),
    employerType: z.enum(["private", "government"]).optional(),
    salaryBasePaise: z.number().int().positive().optional(),
    eightyDGroup: EightyDGroupSchema.optional(),
  })
  .superRefine(validateSectionKindCompatibility);
export type CreateDeductionEntry = z.infer<typeof CreateDeductionEntrySchema>;

/** Request body for PUT /api/tax/deductions/entries/:id */
export const UpdateDeductionEntrySchema = z.object({
  amountPaise: z.number().int().positive().optional(),
  description: z.string().optional(),
  employerType: z.enum(["private", "government"]).optional(),
  salaryBasePaise: z.number().int().positive().optional(),
  eightyDGroup: EightyDGroupSchema.optional(),
});
export type UpdateDeductionEntry = z.infer<typeof UpdateDeductionEntrySchema>;

// ─── Deduction Basket (task 13.7) ─────────────────────────────────────────────

/** A single contribution source within the 80C bucket. */
const DeductionSourceSchema = z.object({
  /**
   * Source kind. "manual" covers all explicit deduction_entries with section='80C'.
   * "epf" covers EPF + VPF combined (the eligible80cPaise DTO field already merges them).
   */
  kind: z.enum([
    "epf", "vpf", "ppf", "ssy", "elss",
    "life_insurance", "tax_saver_fd", "nsc", "manual",
  ]),
  /** Display name: account/policy/holding name or a category label. */
  label: z.string(),
  /** Contribution amount in paise for this FY. */
  contributedPaise: z.number().int(),
  /**
   * Data quality: actual = from real ledger; expected = from unconfirmed EPF rows;
   * estimated = computed from premium/frequency; manual = user entry; data_missing = source present but data absent.
   */
  provenance: z.enum(["actual", "expected", "estimated", "manual", "data_missing"]),
  /** Passthrough notes (compliance statusCode, estimation caveat, etc.). */
  note: z.string().nullable(),
});

/** A single 80CCD(2) entry (one per deduction_entries row with section='80CCD2'). */
const EightyCcd2EntrySchema = z.object({
  id: z.string(),
  employerType: z.enum(["private", "government"]),
  /** Basic+DA in paise supplied on the entry. */
  salaryBasePaise: z.number().int(),
  /** Amount actually contributed (from the entry). */
  contributedPaise: z.number().int(),
  /** Applicable rate in basis points of Basic+DA (from tax-rules.ts for fy+regime+employerType). */
  ratebps: z.number().int(),
  /** Statutory cap = floor(salaryBasePaise × ratebps / 10000). */
  capPaise: z.number().int(),
  /** min(contributedPaise, capPaise). */
  eligiblePaise: z.number().int(),
  /** True when contributedPaise > capPaise. */
  capExceeded: z.boolean(),
});

/**
 * Per-group (self+family or parents) 80D sub-result.
 * `headroomPaise` is null only when the overall basket regime is "new"
 * (80D is not available under the new regime; headroom is meaningless).
 */
const EightyDGroupResultSchema = z.object({
  /** Sum of premiums + other_80d entries + preventive_checkup entries for this group. */
  contributedPaise: z.number().int(),
  /** True when the taxpayer / spouse (selfFamily) or any covered parent (parents) is ≥60 on FY end. */
  seniorApplies: z.boolean(),
  /** Group cap from tax-rules.ts (25k non-senior / 50k senior). */
  capPaise: z.number().int(),
  /** min(contributedPaise, capPaise). */
  eligiblePaise: z.number().int(),
  /**
   * Sub-limit-capped preventive checkup amount (≤ ₹5,000).
   * INCLUDED within contributedPaise (not additive on top).
   */
  preventiveCheckupPaise: z.number().int(),
  headroomPaise: z.number().int().nullable(),
});

/** A health policy that could not be allocated to a bucket (no/mixed covered persons). */
const UnallocatedPolicySchema = z.object({
  policyId: z.string(),
  name: z.string(),
  reason: z.enum(["no_covered_persons", "mixed_coverage"]),
});

/**
 * Full deduction basket for a given user + FY.
 *
 * Money invariants (enforced by the service, verifiable by callers):
 *  - eligiblePaise <= capPaise for all buckets
 *  - headroomPaise >= 0 when non-null
 *  - eightyC.contributedPaise = sum(sources[*].contributedPaise) + npsRemainderPaise
 *  - eightyCcd1b.contributedPaise + eightyC.npsRemainderPaise = raw NPS employee contribution
 *  - emiInterestEstimatePaise is informational — NEVER included in any cap/eligible total
 *
 * headroomPaise is null for 80C/80CCD1B/80D buckets when regime === "new"
 * (the deductions don't apply; headroom would be misleading).
 * eightyCcd2 is never suppressed — it applies under both regimes.
 */
export const DeductionBasketSchema = z.object({
  fy: z.string(),
  /** Effective regime from getRegimePreference. */
  regime: RegimeSchema,
  eightyC: z.object({
    /** Ordered list of auto-detected contribution sources (zero-value sources omitted). */
    sources: z.array(DeductionSourceSchema),
    /**
     * NPS employee contribution above the 80CCD(1B) ₹50,000 cap, carried into 80C.
     * Included in contributedPaise but NOT salary-cap-validated (see task 13.8).
     */
    npsRemainderPaise: z.number().int(),
    /** sum(sources[*].contributedPaise) + npsRemainderPaise */
    contributedPaise: z.number().int(),
    /** Statutory 80C cap (₹1.5L = 15,000,000 paise) from tax-rules.ts. */
    capPaise: z.number().int(),
    /** min(contributedPaise, capPaise). */
    eligiblePaise: z.number().int(),
    /** null when regime === "new". */
    headroomPaise: z.number().int().nullable(),
    /** Caveats from the aggregation (e.g. NPS salary-cap deferral, missing EPF records). */
    assumptions: z.array(z.string()),
  }),
  eightyCcd1b: z.object({
    /** min(npsEmployeeContribution, 50,000 × 100 paise). */
    contributedPaise: z.number().int(),
    /** Statutory cap (₹50,000 = 5,000,000 paise). */
    capPaise: z.number().int(),
    /** min(contributedPaise, capPaise). Equal to contributedPaise (already capped). */
    eligiblePaise: z.number().int(),
    /** null when regime === "new". */
    headroomPaise: z.number().int().nullable(),
  }),
  eightyCcd2: z.object({
    entries: z.array(EightyCcd2EntrySchema),
    /** Sum of entries[*].contributedPaise. */
    contributedPaise: z.number().int(),
    /**
     * Sum of entries[*].eligiblePaise.
     * Available under BOTH regimes — never suppressed by headroomPaise logic.
     */
    eligiblePaise: z.number().int(),
  }),
  eightyD: z.object({
    selfFamily: EightyDGroupResultSchema,
    parents: EightyDGroupResultSchema,
    /**
     * Health policies that could not be assigned to either bucket because they have
     * no covered persons or mixed (parent + non-parent) coverage.
     * These are excluded from both buckets' totals — not silently lost.
     */
    unallocatedPolicies: z.array(UnallocatedPolicySchema),
  }),
  /**
   * Total EMI interest falling in the FY across all EMI templates.
   * INFORMATIONAL ONLY — not a deduction bucket, never added to any eligible total.
   */
  emiInterestEstimatePaise: z.number().int(),
  /** ISO timestamp when this basket was computed. */
  generatedAt: z.string(),
});
export type DeductionBasket = z.infer<typeof DeductionBasketSchema>;

/** Query parameters for GET /api/tax/deductions */
export const GetDeductionBasketQuerySchema = z.object({ fy: FySchema });
export type GetDeductionBasketQuery = z.infer<typeof GetDeductionBasketQuerySchema>;

/** Query parameters for GET /api/tax/deductions/entries */
export const GetDeductionEntriesQuerySchema = z.object({ fy: FySchema });
export type GetDeductionEntriesQuery = z.infer<typeof GetDeductionEntriesQuerySchema>;

// ─── Regime comparison (task 13.8) ───────────────────────────────────────────

/** Taxpayer classification for old-regime slab selection. */
export const TaxpayerTypeSchema = z.enum(["ordinary", "senior", "super_senior"]);
export type TaxpayerType = z.infer<typeof TaxpayerTypeSchema>;

/**
 * Tax-liability breakdown for one regime.
 * effectiveRateBps = totalLiabilityPaise * 10000 / grossIncomePaise (0 when gross = 0).
 */
export const RegimeLiabilitySchema = z.object({
  regime: RegimeSchema,
  deductions: z.object({
    standardDeductionPaise: z.number().int(),
    hraExemptionPaise: z.number().int(),
    eightyCEligiblePaise: z.number().int(),
    eightyCcd1bEligiblePaise: z.number().int(),
    eightyCcd2EligiblePaise: z.number().int(),
    eightyDEligiblePaise: z.number().int(),
    homeLoanInterest24bPaise: z.number().int(),
    /** §24(a): flat 30% standard deduction on gross rent income (both regimes). */
    section24aDeductionPaise: z.number().int(),
    totalDeductionsPaise: z.number().int(),
  }),
  taxableIncomePaise: z.number().int(),
  taxOnSlabsPaise: z.number().int(),
  rebate87APaise: z.number().int(),
  taxAfterRebatePaise: z.number().int(),
  surchargePaise: z.number().int(),
  marginalReliefPaise: z.number().int(),
  taxAfterSurchargePaise: z.number().int(),
  cessPaise: z.number().int(),
  totalLiabilityPaise: z.number().int(),
  effectiveRateBps: z.number().int(),
});
export type RegimeLiability = z.infer<typeof RegimeLiabilitySchema>;

/**
 * Full old-vs-new regime comparison result.
 *
 * crossoverDeductionPaise: the total old-regime deduction level (including standard
 * deduction) at which old-regime tax = new-regime tax. null if old regime never beats
 * new (even with maximum deductions) or grossIncomePaise = 0.
 */
export const RegimeComparisonSchema = z.object({
  fy: FySchema,
  taxpayerType: TaxpayerTypeSchema,
  grossIncomePaise: z.number().int(),
  old: RegimeLiabilitySchema,
  new: RegimeLiabilitySchema,
  crossoverDeductionPaise: z.number().int().nullable(),
  recommendation: z.enum(["old", "new", "indifferent"]),
  savingPaise: z.number().int(),
  savingRegime: RegimeSchema,
  assumptions: z.array(z.string()),
  isEstimate: z.literal(true),
  generatedAt: z.string(),
});
export type RegimeComparison = z.infer<typeof RegimeComparisonSchema>;

/** Query parameters for GET /api/tax/regime-comparison. */
export const GetRegimeComparisonQuerySchema = z.object({
  fy: FySchema,
  taxpayerType: TaxpayerTypeSchema.optional(),
  /** HRA exemption already computed by the user u/s 10(13A), in paise. Defaults to 0. */
  hraExemptionPaise: z.coerce.number().int().min(0).optional(),
  /** Home-loan interest u/s 24(b), in paise. Capped internally at ₹2L (20,000,000 paise). Defaults to 0. */
  homeLoanInterestPaise: z.coerce.number().int().min(0).optional(),
});
export type GetRegimeComparisonQuery = z.infer<typeof GetRegimeComparisonQuerySchema>;

// ── 13.11 Capital loss carry-forward ─────────────────────────────────────────

export const LossKindSchema = z.enum(["STCL", "LTCL"]);
export type LossKind = z.infer<typeof LossKindSchema>;

export const CapitalLossEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  originFy: FySchema,
  lossKind: LossKindSchema,
  originalPaise: z.number().int().positive(),
  remainingPaise: z.number().int().min(0),
  expiresFy: FySchema,
  returnFiled: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CapitalLossEntry = z.infer<typeof CapitalLossEntrySchema>;

export const CreateCapitalLossEntrySchema = z
  .object({
    originFy: FySchema,
    lossKind: LossKindSchema,
    originalPaise: z.number().int().positive(),
    remainingPaise: z.number().int().min(0),
    returnFiled: z.boolean().default(false),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => d.remainingPaise <= d.originalPaise, {
    message: "remainingPaise must not exceed originalPaise",
    path: ["remainingPaise"],
  });
export type CreateCapitalLossEntry = z.infer<typeof CreateCapitalLossEntrySchema>;

// Upper bound on remainingPaise (≤ originalPaise) is enforced by a DB CHECK constraint;
// the update schema cannot reference the row's original without a DB lookup.
export const UpdateCapitalLossEntrySchema = z.object({
  remainingPaise: z.number().int().min(0).optional(),
  returnFiled: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type UpdateCapitalLossEntry = z.infer<typeof UpdateCapitalLossEntrySchema>;

export const LossSetoffResultSchema = z.object({
  /** Net STCG after applying STCL set-off (≥ 0). */
  netStcgPaise: z.number().int().min(0),
  /** Net LTCG after applying all eligible set-off (≥ 0). */
  netLtcgPaise: z.number().int().min(0),
  /** Residual STCL not absorbed this FY (carries forward). */
  residualStclPaise: z.number().int().min(0),
  /** Residual LTCL not absorbed this FY (carries forward). */
  residualLtclPaise: z.number().int().min(0),
  /** STCL applied to STCG this FY. */
  stclAgainstStcgPaise: z.number().int().min(0),
  /** STCL applied to LTCG this FY. */
  stclAgainstLtcgPaise: z.number().int().min(0),
  /** LTCL applied to LTCG this FY. */
  ltclAgainstLtcgPaise: z.number().int().min(0),
});
export type LossSetoffResult = z.infer<typeof LossSetoffResultSchema>;

export const CapitalPositionSchema = z.object({
  fy: FySchema,
  /** Gross gains from capital_gains service (before set-off). */
  grossStcgPaise: z.number().int(),
  grossLtcgPaise: z.number().int(),
  /** Brought-forward losses applied this FY (from prior years). */
  broughtForwardLossesApplied: z.array(z.object({
    entryId: z.string().uuid(),
    originFy: FySchema,
    lossKind: LossKindSchema,
    absorbedPaise: z.number().int().min(0),
  })),
  setoff: LossSetoffResultSchema,
  /**
   * Current-year losses that could not be absorbed this FY (Sec 74 carry-forward).
   * Reported separately because they arise from this FY's realised trades, not from
   * the capital_loss_carryforward ledger — the user must create a carry-forward
   * entry to track them into next year.
   */
  currentYearResidualStclPaise: z.number().int().min(0),
  currentYearResidualLtclPaise: z.number().int().min(0),
  /** Losses expiring within 2 FYs from now — needs attention. */
  expiringLosses: z.array(z.object({
    originFy: FySchema,
    lossKind: LossKindSchema,
    remainingPaise: z.number().int().min(0),
    expiresFy: FySchema,
  })),
  /** Assumptions and caveats. */
  assumptions: z.array(z.string()),
  isEstimate: z.literal(true),
  generatedAt: z.string(),
});
export type CapitalPosition = z.infer<typeof CapitalPositionSchema>;

export const GetCapitalPositionQuerySchema = z.object({
  fy: FySchema.optional(),
});

// ── 13.10 Advance tax & Sec 234B/234C interest ───────────────────────────────

export const AdvanceTaxInstalmentStatusSchema = z.object({
  /** Statutory instalment due date (ISO). */
  dueDate: z.string(),
  /** Cumulative percentage of assessed tax due by this date (15/45/75/100). */
  cumulativePct: z.number().int().min(0).max(100),
  /** Cumulative TDS credited through this due date (accepted income events). */
  cumulativeTdsPaise: z.number().int().min(0),
  /**
   * Capital-gains tax attributable through this date — the Sec 234C timing
   * exception: gains arising after a due date do not burden earlier instalments.
   */
  cumulativeCgTaxPaise: z.number().int().min(0),
  /**
   * Cumulative advance tax required by this date:
   * floor(pct% × max(0, ordinaryLiability + CG-through-date − TDS-through-date)).
   */
  requiredCumulativePaise: z.number().int().min(0),
  /**
   * Shortfall vs the required cumulative amount. Advance-tax PAYMENTS are not
   * tracked in v1, so this equals requiredCumulativePaise (worst case).
   */
  shortfallPaise: z.number().int().min(0),
  /** Months of deferment for Sec 234C: 3 for Jun/Sep/Dec, 1 for Mar. */
  defermentMonths: z.number().int().min(0),
  /**
   * Sec 234C interest for this instalment = ceil(shortfall × 1%) × months.
   * Zero for instalments whose due date is still in the future.
   */
  interest234CPaise: z.number().int().min(0),
});
export type AdvanceTaxInstalmentStatus = z.infer<typeof AdvanceTaxInstalmentStatusSchema>;

export const AdvanceTaxPositionSchema = z.object({
  fy: FySchema,
  /** Senior citizens (≥60 on FY end, no business income) are exempt — Sec 207. */
  seniorCitizenExempt: z.boolean(),
  income: z.object({
    /** Accepted income-event gross by kind (all five kinds always present). */
    grossByKind: z.record(z.string(), z.number().int().min(0)),
    totalGrossPaise: z.number().int().min(0),
    totalTdsPaise: z.number().int().min(0),
  }),
  /** Net capital gains after brought-forward set-off (full-year view). */
  netStcgPaise: z.number().int().min(0),
  netLtcgPaise: z.number().int().min(0),
  /** Flat-rate tax on the net full-year gains. */
  cgTaxFullYearPaise: z.number().int().min(0),
  /** Tax on ordinary (non-CG) income via slabs/rebates/cess. */
  ordinaryLiabilityPaise: z.number().int().min(0),
  /** Total assessed tax = ordinary + CG. */
  assessedTaxPaise: z.number().int().min(0),
  instalments: z.array(AdvanceTaxInstalmentStatusSchema),
  interest234CTotalPaise: z.number().int().min(0),
  /**
   * Sec 234B: 1%/month from April when <90% of assessed tax is paid by year end.
   * Advance-tax payments are untracked, so TDS credits stand in for "paid".
   */
  interest234BPaise: z.number().int().min(0),
  interestTotalPaise: z.number().int().min(0),
  assumptions: z.array(z.string()),
  isEstimate: z.literal(true),
  generatedAt: z.string(),
});
export type AdvanceTaxPosition = z.infer<typeof AdvanceTaxPositionSchema>;

export const GetAdvanceTaxQuerySchema = z.object({
  fy: FySchema.optional(),
});

// ─── 13.13 — AIS / 26AS / Form-16 staged reconciliation ──────────────────────

/** Which tax document a staged import came from. */
export const TaxStatementKindSchema = z.enum(["ais", "26as", "form16"]);
export type TaxStatementKind = z.infer<typeof TaxStatementKindSchema>;

/** Review lifecycle, identical to payslips: pending → accepted | rejected. */
export const TaxStatementStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type TaxStatementStatus = z.infer<typeof TaxStatementStatusSchema>;

/** Per-line reconciliation verdict against the income-events ledger. */
export const TaxLineMatchStatusSchema = z.enum(["matched", "unmatched", "amount_mismatch"]);
export type TaxLineMatchStatus = z.infer<typeof TaxLineMatchStatusSchema>;

/**
 * One reported line of a staged statement. `category` reuses the income-event
 * enumeration so matching is a same-shape comparison.
 */
export const TaxStatementLineSchema = z.object({
  id: z.string().uuid(),
  statementId: z.string().uuid(),
  section: z.string().max(16).nullable(),
  category: IncomeKindSchema,
  payerName: z.string().nullable(),
  payerTan: z.string().max(16).nullable(),
  period: z.string().max(32).nullable(),
  accrualDate: z.string().nullable(),
  grossPaise: z.number().int().min(0),
  tdsPaise: z.number().int().min(0),
  matchStatus: TaxLineMatchStatusSchema,
  matchedIncomeEventId: z.string().uuid().nullable(),
});
export type TaxStatementLine = z.infer<typeof TaxStatementLineSchema>;

export const TaxStatementSummarySchema = z.object({
  id: z.string().uuid(),
  fy: FySchema,
  docKind: TaxStatementKindSchema,
  status: TaxStatementStatusSchema,
  /** Raw document present in object storage (never its contents). */
  hasDocument: z.boolean(),
  sourceLabel: z.string().nullable(),
  lineCount: z.number().int().min(0),
  grossTotalPaise: z.number().int().min(0),
  tdsTotalPaise: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  unmatchedCount: z.number().int().min(0),
  amountMismatchCount: z.number().int().min(0),
  /** Ledger events for this FY that no reported line accounted for. */
  unmatchedLedgerCount: z.number().int().min(0),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type TaxStatementSummary = z.infer<typeof TaxStatementSummarySchema>;

/**
 * Reviewable summary of a ledger income event this statement's lines never
 * accounted for — its id appears in no line's `matchedIncomeEventId`. This is
 * the line-item detail behind `unmatchedLedgerCount`; deriving it needs no
 * schema change since it's computed from data already persisted per line.
 */
export const UnmatchedLedgerEventSchema = z.object({
  id: z.string().uuid(),
  incomeKind: IncomeKindSchema,
  payerName: z.string().nullable(),
  grossPaise: z.number().int().min(0),
  tdsPaise: z.number().int().min(0),
  accrualDate: z.string(),
});
export type UnmatchedLedgerEvent = z.infer<typeof UnmatchedLedgerEventSchema>;

/**
 * Full statement with lines. The assessee's own PAN is only ever surfaced as
 * its last 4 characters — the API never echoes more.
 */
export const TaxStatementDetailSchema = TaxStatementSummarySchema.extend({
  /** Last 4 digits of the assessee PAN when stated at import; null otherwise. */
  panLast4: z.string().length(4).regex(/^\d{4}$/).nullable(),
  lines: z.array(TaxStatementLineSchema),
  /**
   * Ledger events for this FY that no reported line accounted for — the
   * reviewable list backing `unmatchedLedgerCount`. Detail-only: the list
   * endpoint (`TaxStatementSummary`) keeps just the count.
   */
  unmatchedLedgerEvents: z.array(UnmatchedLedgerEventSchema),
});
export type TaxStatementDetail = z.infer<typeof TaxStatementDetailSchema>;

export const TaxStatementListSchema = z.object({
  fy: FySchema,
  statements: z.array(TaxStatementSummarySchema),
});
export type TaxStatementList = z.infer<typeof TaxStatementListSchema>;

/** One typed-in/pasted row of a manual import. */
export const CreateTaxStatementLineSchema = z
  .object({
    section: z.string().max(16).nullish(),
    category: IncomeKindSchema,
    payerName: z.string().max(200).nullish(),
    payerTan: z
      .string()
      .max(16)
      .regex(/^[A-Za-z0-9]*$/, "alphanumeric only")
      .nullish(),
    period: z.string().max(32).nullish(),
    accrualDate: z.iso.date().nullish(),
    grossPaise: z.number().int().min(0),
    tdsPaise: z.number().int().min(0).default(0),
  })
  .refine((data) => (data.tdsPaise ?? 0) <= data.grossPaise, {
    message: "tdsPaise cannot exceed grossPaise",
    path: ["tdsPaise"],
  });
export type CreateTaxStatementLine = z.infer<typeof CreateTaxStatementLineSchema>;

/**
 * Manual/staged import body — the deterministic path (no AI). The raw PDF/JSON
 * from TRACES/AIS portal can be attached afterwards via POST /:id/document;
 * rows are entered by hand or pasted as JSON.
 */
export const CreateTaxStatementBodySchema = z.object({
  fy: FySchema,
  docKind: TaxStatementKindSchema,
  /** Last 4 digits of the assessee PAN as printed; full PAN is never accepted. */
  panLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  sourceLabel: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  lines: z.array(CreateTaxStatementLineSchema).max(1000).default([]),
});
export type CreateTaxStatementBody = z.infer<typeof CreateTaxStatementBodySchema>;

export const GetTaxStatementsQuerySchema = z.object({
  fy: FySchema,
});

// ── Capital-loss set-off application (Part 2 fix) ─────────────────────────────

/**
 * Request body for POST /api/tax/capital-losses/apply-setoff.
 * The FY for which to apply brought-forward loss set-off.
 */
export const ApplySetoffRequestSchema = z.object({
  fy: FySchema,
});
export type ApplySetoffRequest = z.infer<typeof ApplySetoffRequestSchema>;

/**
 * Per-entry detail in the apply-setoff response — one entry per carry-forward
 * row that had paise absorbed in this application.
 */
export const SetoffAppliedEntrySchema = z.object({
  entryId: z.string().uuid(),
  originFy: FySchema,
  lossKind: LossKindSchema,
  /** Paise absorbed from this entry's remaining balance. */
  absorbedPaise: z.number().int().min(0),
  /** remainingPaise on the carry-forward entry after absorption. */
  remainingPaiseAfter: z.number().int().min(0),
});
export type SetoffAppliedEntry = z.infer<typeof SetoffAppliedEntrySchema>;

/**
 * Response from POST /api/tax/capital-losses/apply-setoff.
 * Summarises what was drawn from carry-forward entries for the FY.
 */
export const ApplySetoffResultSchema = z.object({
  fy: FySchema,
  /** Sum of all entries' absorbedPaise (0 if no brought-forward entries were eligible). */
  totalAbsorbedPaise: z.number().int().min(0),
  /** Per carry-forward entry breakdown. Empty when nothing was absorbed. */
  entries: z.array(SetoffAppliedEntrySchema),
});
export type ApplySetoffResult = z.infer<typeof ApplySetoffResultSchema>;

