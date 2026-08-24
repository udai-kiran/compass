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
