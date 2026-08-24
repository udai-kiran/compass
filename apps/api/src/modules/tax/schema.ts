/**
 * tax module schema — resident tables + enums for the tax domain (tasks 13.1, 13.2, 13.4, 13.5).
 *
 * Resident tables:
 *   - tax_regime_preferences — per-user, per-FY income-tax regime preference (13.1)
 *   - payslips              — payslip headers: status, totals, document key (13.2)
 *   - payslip_components    — per-component line items (13.2)
 *   - income_events         — structured taxable-income ledger (13.4)
 *   - epf_contributions     — EPF passbook reconciliation (13.5)
 *
 * Cross-domain FK target: users (from db/core-schema.ts).
 * No imports from other module schema.ts files.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

/** Income-tax filing regime. */
export const taxRegimeEnum = pgEnum("tax_regime", ["old", "new"]);

/** Source that determined the effective regime. */
export const regimeSourceEnum = pgEnum("regime_source", ["chosen", "inferred", "default"]);

/**
 * Per-user, per-FY income-tax regime preference.
 *
 * - composite PK on (user_id, fy)
 * - chosen: explicit user selection (null = not yet chosen)
 * - inferred_regime: computed from payslip TDS by the payslip service
 * - effective: resolved value — chosen ?? inferred_regime ?? 'new'
 * - source: 'chosen' | 'inferred' | 'default'
 */
export const taxRegimePreferences = pgTable(
  "tax_regime_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Canonical FY label: "YYYY-YY" (e.g. "2025-26"). */
    fy: text("fy").notNull(),
    /** User's explicit regime choice. null = not yet explicitly chosen. */
    chosen: taxRegimeEnum("chosen"),
    /** Inferred regime from payslip TDS. null = not yet inferred. */
    inferredRegime: taxRegimeEnum("inferred_regime"),
    /** When the inferred regime was last set by the payslip service. */
    inferredAt: timestamp("inferred_at", { withTimezone: true }),
    /** Resolved effective regime: chosen ?? inferredRegime ?? 'new'. */
    effective: taxRegimeEnum("effective").notNull(),
    /** Source that determined effective: 'chosen' | 'inferred' | 'default'. */
    source: regimeSourceEnum("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fy] })],
);

// ─── Payslips (task 13.2) ─────────────────────────────────────────────────────

/**
 * Payslip header: one row per uploaded/entered payslip.
 *
 * State machine: pending → accepted | rejected (D3).
 * Only accepted rows feed downstream FY TDS computation (D4).
 *
 * tds_current_paise: TDS deducted this month — summed for FY TDS.
 * tds_ytd_paise: cumulative YTD printed on the payslip — never summed (D4).
 * document_key: opaque storage key for the uploaded document.
 */
export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Canonical FY label: "YYYY-YY" (e.g. "2025-26"). */
    fy: text("fy").notNull(),
    /** Pay month in "YYYY-MM" format (e.g. "2025-06"). */
    payMonth: text("pay_month").notNull(),
    /** Employer legal name as printed on the payslip. */
    employerName: text("employer_name"),
    /** Opaque storage key for the uploaded payslip document. */
    documentKey: text("document_key"),
    /**
     * Review status. Pending = awaiting user review; accepted = confirmed and
     * eligible for FY TDS aggregation; rejected = dismissed.
     */
    status: text("status").notNull().default("pending"),
    /** Gross salary (CTC monthly) in paise. */
    grossPaise: bigint("gross_paise", { mode: "number" }),
    /** Net take-home in paise. */
    netPaise: bigint("net_paise", { mode: "number" }),
    /** TDS deducted this month in paise (used for FY aggregate). */
    tdsCurrentPaise: bigint("tds_current_paise", { mode: "number" }),
    /** TDS year-to-date as printed — reconciliation only, never summed. */
    tdsYtdPaise: bigint("tds_ytd_paise", { mode: "number" }),
    /** When the reviewer accepted this payslip. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslips_user_fy_status_idx").on(t.userId, t.fy, t.status),
    uniqueIndex("payslips_user_month_employer_idx").on(t.userId, t.payMonth, t.employerName),
  ],
);

/**
 * Per-component rows for each payslip.
 *
 * No user_id — scoped via payslip_id → payslips.user_id.
 *
 * canonical_kind values: basic | hra | special_allowance | other_earning |
 *   employee_epf | employer_epf | eps | professional_tax | other_deduction |
 *   employer_contribution.
 * category values: earning | deduction | employer_contribution.
 */
export const payslipComponents = pgTable(
  "payslip_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    /** Label exactly as printed on the payslip. */
    rawLabel: text("raw_label").notNull(),
    /** Canonical classification: basic, hra, employee_epf, etc. */
    canonicalKind: text("canonical_kind").notNull(),
    /** Broad bucket: earning, deduction, or employer_contribution. */
    category: text("category").notNull(),
    /** Current-month amount in paise. */
    currentPaise: bigint("current_paise", { mode: "number" }).notNull(),
    /** Year-to-date amount in paise, if printed. */
    ytdPaise: bigint("ytd_paise", { mode: "number" }),
    /** Verbatim text from the document that justified this component. */
    sourceQuote: text("source_quote"),
    /** Model confidence score 0–1. */
    confidence: real("confidence"),
    /** Position in the payslip layout (for UI ordering). */
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payslip_components_payslip_idx").on(t.payslipId)],
);

// ─── Income Events (task 13.4) ────────────────────────────────────────────────

/**
 * Income event lifecycle state.
 * Transitions: pending → accepted | rejected only.
 */
export const incomeEventStatus = pgEnum("income_event_status", ["pending", "accepted", "rejected"]);

/**
 * Broad income classification.
 * salary: employment income (typically from payslips)
 * interest: FD/RD/NSC interest income (typically from deposit events)
 * dividend: MF/stock dividend (from holding events with type=dividend)
 * rent: rental income
 * other: any other taxable income
 */
export const incomeKind = pgEnum("income_kind", [
  "salary",
  "interest",
  "dividend",
  "rent",
  "other",
]);

/**
 * What sourced this income event.
 * payslip: auto-derived from an accepted payslip (13.2)
 * holding_event: auto-derived from a holding event (dividend, task 13.4)
 * manual: user-entered directly
 * ais: imported from the Annual Information Statement
 */
export const incomeSourceKind = pgEnum("income_source_kind", [
  "payslip",
  "holding_event",
  "manual",
  "ais",
]);

/**
 * Structured taxable-income ledger (task 13.4).
 *
 * One row per recognizable income occurrence. Status machine:
 *   pending → accepted | rejected (guarded atomic UPDATE WHERE status='pending').
 *
 * fy is always server-computed from accrualDate via fyOf(); clients never supply it.
 * source_id is null for manual/ais entries, non-null for auto-derived ones.
 * Partial unique index prevents duplicate derivations from the same source entity.
 *
 * gross_paise and tds_paise check constraints:
 *   - gross_paise >= 0 (non-negative income)
 *   - tds_paise >= 0 and tds_paise <= gross_paise
 *
 * original_values stores the pre-accept state for audit trail when corrections are applied.
 */
export const incomeEvents = pgTable(
  "income_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ISO date "YYYY-MM-DD" — the date the income accrued/was earned. */
    accrualDate: date("accrual_date").notNull(),
    /** Canonical FY label: "YYYY-YY" — always server-computed via fyOf(accrualDate). */
    fy: text("fy").notNull(),
    /** Broad income classification. */
    incomeKind: incomeKind("income_kind").notNull(),
    /**
     * Deduction/TDS section this income falls under: '192' (salary), '194A'
     * (interest), '194K' (MF income), '194-I' (rent). Null = unknown / not applicable.
     */
    section: text("section"),
    /** What sourced this event. */
    sourceKind: incomeSourceKind("source_kind").notNull(),
    /** ID of the source entity (payslip.id, holdingEvent.id, etc.). Null for manual/ais. */
    sourceId: uuid("source_id"),
    /**
     * Precedence when two sources describe the same underlying income
     * (higher wins). Reconciliation itself is out of scope for 13.4.
     */
    sourcePriority: integer("source_priority").notNull().default(0),
    /** Payer legal name (employer, bank, company, etc.). */
    payerName: text("payer_name"),
    /** Payer PAN — normalized to uppercase. */
    payerPan: text("payer_pan"),
    /** Payer TAN (for TDS deductions) — normalized to uppercase. */
    payerTan: text("payer_tan"),
    /** Gross income amount in paise. Must be >= 0. */
    grossPaise: bigint("gross_paise", { mode: "number" }).notNull(),
    /** TDS deducted in paise. Must be >= 0 and <= gross_paise. */
    tdsPaise: bigint("tds_paise", { mode: "number" }).notNull().default(0),
    /** User notes. */
    notes: text("notes"),
    /** Review status. Default pending until user accepts or rejects. */
    status: incomeEventStatus("status").notNull().default("pending"),
    /** When the user accepted this income event. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /**
     * Pre-accept state snapshot when corrections were applied at acceptance.
     * Null if accepted without corrections.
     */
    originalValues: jsonb("original_values"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("income_events_gross_paise_non_negative", sql`${t.grossPaise} >= 0`),
    check("income_events_tds_paise_non_negative", sql`${t.tdsPaise} >= 0`),
    check("income_events_tds_le_gross", sql`${t.tdsPaise} <= ${t.grossPaise}`),
    /** Partial unique index: prevent duplicate derivations from the same source entity. */
    uniqueIndex("income_events_source_unique_idx")
      .on(t.userId, t.sourceKind, t.sourceId)
      .where(sql`source_id is not null`),
    index("income_events_user_fy_idx").on(t.userId, t.fy),
  ],
);

// ─── EPF Contributions (task 13.5) ───────────────────────────────────────────

/**
 * EPF passbook reconciliation — dual expected/actual columns.
 * One row per (user_id, wage_month, epfo_member_id).
 *
 * expected_* columns: populated from payslip import or manual entry.
 * actual_* columns: populated when user confirms values from EPFO passbook.
 *
 * employer_epf_paise = credited to member's PF corpus (AFTER EPS diversion).
 * employer_epf + eps = gross employer share. Never double-count.
 * expected_vpf_paise defaults to 0 (NOT NULL).
 *
 * reconciliation_status is computed by computeStatus() and persisted after confirmActual.
 */
export const epfContributions = pgTable(
  "epf_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Pay month in "YYYY-MM" format (e.g. "2025-06"). */
    wageMonth: text("wage_month").notNull(),
    /** Employer display name (from payslip or manual entry). */
    employerName: text("employer_name"),
    /**
     * EPFO Member ID — establishment-specific identifier. REQUIRED.
     * Format varies: e.g. "MH/BAN/0012345/000/0001234".
     */
    epfoMemberId: text("epfo_member_id").notNull(),

    // Expected columns (from payslip import or manual entry)
    /** Employee EPF deduction in paise (→ 80C eligible). */
    expectedEmployeePaise: bigint("expected_employee_paise", { mode: "number" }),
    /**
     * Employer EPF credited to PF corpus in paise — AFTER EPS diversion.
     * This is what actually lands in the member's PF corpus.
     * employer_epf + eps = gross employer share (no fixed-rate check — the actual rate varies by employer/payslip; H2 removed the unconditional 12%-of-basic assumption).
     */
    expectedEmployerPaise: bigint("expected_employer_paise", { mode: "number" }),
    /** EPS amount diverted to pension fund in paise (NOT credited to PF corpus). */
    expectedEpsPaise: bigint("expected_eps_paise", { mode: "number" }),
    /** Voluntary Provident Fund contribution in paise (→ 80C eligible). */
    expectedVpfPaise: bigint("expected_vpf_paise", { mode: "number" }).notNull().default(0),
    /** Source payslip; null for manual entries. */
    payslipId: uuid("payslip_id").references(() => payslips.id),

    // Actual columns (from EPFO passbook confirmation)
    /** Actual employee EPF credited as per passbook in paise. */
    actualEmployeePaise: bigint("actual_employee_paise", { mode: "number" }),
    /** Actual employer EPF credited to PF corpus as per passbook in paise. */
    actualEmployerPaise: bigint("actual_employer_paise", { mode: "number" }),
    /** Actual EPS as per passbook in paise. */
    actualEpsPaise: bigint("actual_eps_paise", { mode: "number" }),
    /** Actual VPF as per passbook in paise. */
    actualVpfPaise: bigint("actual_vpf_paise", { mode: "number" }),

    /**
     * Reconciliation status — computed by computeStatus() and persisted after confirmActual.
     * Values: 'pending' | 'matched' | 'mismatch' | 'confirmed'.
     * gap status is NOT persisted — the gaps endpoint is read-only.
     */
    reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
    /** User-supplied reason for a gap or mismatch. */
    gapReason: text("gap_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("epf_contributions_user_month_member_idx").on(
      t.userId,
      t.wageMonth,
      t.epfoMemberId,
    ),
    /** Partial index for fast idempotent import lookup by payslip_id. */
    index("epf_contributions_payslip_idx")
      .on(t.payslipId)
      .where(sql`payslip_id IS NOT NULL`),
    index("epf_contributions_user_month_idx").on(t.userId, t.wageMonth),
  ],
);

// ─── Deduction Entries (task 13.7) ────────────────────────────────────────────

/**
 * Income-tax deduction section this entry applies to.
 * 80C / 80D are old-regime only; 80CCD2 applies both regimes.
 */
export const deductionSection = pgEnum("deduction_section", ["80C", "80D", "80CCD1B", "80CCD2"]);

/**
 * Fine-grained kind within a section — drives UI labels and eligibility logic.
 * Valid (section, kind) pairings are enforced by `deduction_entries_section_kind` check.
 */
export const deductionKind = pgEnum("deduction_kind", [
  "nsc_additional",
  "tuition_fees",
  "elss_manual",
  "nps_additional",
  "employer_nps_ccd2",
  "preventive_checkup",
  "other_80c",
  "other_80d",
]);

/** For 80D entries: which coverage group the premium belongs to. */
export const eightyDGroup = pgEnum("eighty_d_group", ["self_family", "parents"]);

/**
 * Manual deduction entries — user-recorded amounts that don't flow automatically
 * from other modules (NSC interest, tuition fees, manual ELSS records, employer
 * NPS contributions, preventive health check-ups, etc.).
 *
 * DB check constraints mirror the Zod superRefine validation in packages/shared.
 * No source_doc_key column (document attachment deferred — see TASK.md non-goals).
 */
export const deductionEntries = pgTable(
  "deduction_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Canonical FY label: "YYYY-YY" (e.g. "2025-26"). */
    fy: text("fy").notNull(),
    section: deductionSection("section").notNull(),
    deductionKind: deductionKind("deduction_kind").notNull(),
    /** Deductible amount in paise; must be > 0 (enforced by check constraint). */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    /** User-supplied description; empty string when not provided. */
    description: text("description").notNull().default(""),
    /** 'private' | 'government'; required when section = '80CCD2'. */
    employerType: text("employer_type"),
    /** Basic+DA in paise; required when section = '80CCD2'. */
    salaryBasePaise: bigint("salary_base_paise", { mode: "number" }),
    /** Required when section = '80D'. */
    eightyDGroup: eightyDGroup("eighty_d_group"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deduction_entries_user_fy_idx").on(t.userId, t.fy),
    check("deduction_entries_amount_positive", sql`${t.amountPaise} > 0`),
    check(
      "deduction_entries_ccd2_fields",
      sql`${t.section} <> '80CCD2' OR (${t.employerType} IN ('private','government') AND ${t.salaryBasePaise} > 0)`,
    ),
    check(
      "deduction_entries_80d_group",
      sql`${t.section} <> '80D' OR ${t.eightyDGroup} IS NOT NULL`,
    ),
    check(
      "deduction_entries_section_kind",
      sql`(${t.section} = '80C' AND ${t.deductionKind} IN ('nsc_additional','tuition_fees','elss_manual','other_80c')) OR (${t.section} = '80CCD1B' AND ${t.deductionKind} = 'nps_additional') OR (${t.section} = '80CCD2' AND ${t.deductionKind} = 'employer_nps_ccd2') OR (${t.section} = '80D' AND ${t.deductionKind} IN ('preventive_checkup','other_80d'))`,
    ),
  ],
);
