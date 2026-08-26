import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";
import { goals, resources } from "./foundation.ts";
import { accounts, emailIngestions } from "./hubs.ts";
import { familyMembers } from "./persons.ts";

/**
 * No ppf/epf here — those are account types. Their balance is a credited fact,
 * not a valuation, so modelling them as holdings would dress a known number up
 * as an estimate (and give the user two places to record the same thing).
 */
export const assetClass = pgEnum("asset_class", [
  "stock",
  "mutual_fund",
  "etf",
  "gold",
  "silver",
  "fd",
  "nps",
  "real_estate",
  "other",
]);

/**
 * How a holding's capital gains are taxed. A per-holding fact that can't be
 * inferred from asset_class (a mutual_fund may be equity, debt, or a §50AA
 * specified fund), so it's stored and user-settable. See services/tax-lots.ts.
 */
export const gainsTaxClass = pgEnum("gains_tax_class", [
  "equity",
  "unlisted_shares",
  "other",
  "specified_fund",
  "market_linked_debenture",
  "unlisted_bond",
  "exempt",
]);

export const holdings = pgTable(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    assetClass: assetClass("asset_class").notNull(),
    notes: text("notes").notNull().default(""),
    /** optional allocation target, % of portfolio */
    targetPct: integer("target_pct"),
    /**
     * AMFI scheme code (6 digits, e.g. 122639). The key NAV refresh looks up.
     * Null = unmapped: a fund with no AMFI scheme (e.g. a platform product like
     * Kuvera SaveSmart), valued from imported data only and skipped by refresh.
     */
    amfiSchemeCode: integer("amfi_scheme_code"),
    /** MF folio number; free-form, may be non-numeric */
    folioNumber: text("folio_number"),
    /**
     * NAV per unit on 31-Jan-2018 in paise, for grandfathering equity units held
     * before 01-Feb-2018 in the capital-gains statement. Null = not set (no old
     * units, or the user hasn't supplied the FMV). See services/tax-lots.ts.
     */
    grandfatherNavPaise: bigint("grandfather_nav_paise", { mode: "number" }),
    /** Capital-gains tax treatment; guessed from asset class at create, user-editable. */
    gainsTaxClass: gainsTaxClass("gains_tax_class").notNull().default("equity"),
    /** Goal this holding (folio) is earmarked for; null = "Unassigned". See accounts.goalId. */
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    /** Whether this mutual-fund holding is an ELSS (Equity Linked Savings Scheme),
     *  qualifying for deduction under Section 80C. Only meaningful for mutual_fund
     *  asset class; enforced by a DB check constraint. */
    isElss: boolean("is_elss").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("holdings_user_idx").on(t.userId),
    check(
      "holdings_elss_requires_mf",
      sql`NOT ${t.isElss} OR ${t.assetClass} = 'mutual_fund'`,
    ),
  ],
);

export const insuranceKind = pgEnum("insurance_kind", ["life", "health", "vehicle"]);
export const vehicleKind = pgEnum("vehicle_kind", ["car", "bike", "other"]);
export const healthType = pgEnum("health_type", [
  "indemnity",
  "top_up",
  "critical_illness",
  "hospital_cash",
  "personal_accident",
  "disease_specific",
]);
export const premiumFrequency = pgEnum("premium_frequency", [
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "single",
]);
/** Employer cover ends with the job — the distinction adequacy (14.2) flags as a continuity risk. */
export const policyOwnership = pgEnum("policy_ownership", ["personal", "employer"]);

/**
 * An insurance policy — a standalone record, not an account. It carries its own
 * fields (insurer, policy number, sum assured, bonus, dates) rather than the
 * name/holder/UPI/balance an account has, because a policy isn't money you hold.
 * Premiums are tracked as ordinary expense transactions tagged with policy_id
 * (see transactions.policyId); the money flow lives there, only the standing
 * policy terms live here.
 */
export const insurancePolicies = pgTable(
  "insurance_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** short display label for lists, e.g. "LIC Jeevan Anand" */
    name: text("name").notNull(),
    kind: insuranceKind("kind").notNull().default("life"),
    /** car/bike/other for a vehicle policy; null for life/health */
    vehicleType: vehicleKind("vehicle_type"),
    /** vehicle registration number; "" for non-vehicle policies */
    vehicleRegNo: text("vehicle_reg_no").notNull().default(""),
    /** canonical vehicle record; legacy type/registration fields remain for compatibility */
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    /** indemnity/critical-illness/etc. for a health policy; null for life/vehicle */
    healthType: healthType("health_type"),
    /** insurance company, e.g. "LIC", "Star Health" */
    insurer: text("insurer").notNull().default(""),
    policyNumber: text("policy_number").notNull().default(""),
    /** URL to the policy wordings/terms doc; "" when unset. For agents to read later. */
    policyWordingUrl: text("policy_wording_url").notNull().default(""),
    /** sum assured (life) / sum insured (health) / IDV (vehicle), in paise */
    sumAssuredPaise: bigint("sum_assured_paise", { mode: "number" }).notNull().default(0),
    /** accrued bonus / loyalty additions (endowment life), in paise */
    bonusPaise: bigint("bonus_paise", { mode: "number" }).notNull().default(0),
    /** premium per payment, in paise */
    premiumPaise: bigint("premium_paise", { mode: "number" }).notNull().default(0),
    premiumFrequency: premiumFrequency("premium_frequency").notNull().default("yearly"),
    /** policy commencement ("started from") */
    startDate: date("start_date"),
    /** next renewal / premium due date */
    renewalDate: date("renewal_date"),
    /** endowment/money-back maturity; null for pure term, health, vehicle */
    maturityDate: date("maturity_date"),
    nominee: text("nominee").notNull().default(""),
    nomineePersonId: uuid("nominee_person_id").references(() => familyMembers.id, { onDelete: "set null" }),
    /** people covered by the policy — e.g. a family-floater's members. */
    coveredMembers: text("covered_members")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** employer-provided cover ends with the job — flagged as a continuity risk by 14.2. */
    ownership: policyOwnership("ownership").notNull().default("personal"),
    /** employer providing the cover; "" unless ownership = "employer" */
    employerName: text("employer_name").notNull().default(""),
    /** amount payable by the insured before the insurer pays, in paise. Health only; null for life/vehicle. */
    deductiblePaise: bigint("deductible_paise", { mode: "number" }),
    /** insured's share of every claim, in basis points (2000 = 20%). Health only; null for life/vehicle. */
    coPayBps: integer("co_pay_bps"),
    /** flat per-day room-rent cap, in paise. Mutually exclusive with roomRentLimitBps in practice — policies quote one or the other. Health only. */
    roomRentLimitPaise: bigint("room_rent_limit_paise", { mode: "number" }),
    /** room-rent cap as basis points of sum insured per day (e.g. 100 = 1%/day). Health only. */
    roomRentLimitBps: integer("room_rent_limit_bps"),
    /** flat per-day ICU cap, in paise. Health only. */
    icuLimitPaise: bigint("icu_limit_paise", { mode: "number" }),
    /** ICU cap as basis points of sum insured per day. Health only. */
    icuLimitBps: integer("icu_limit_bps"),
    /** disease/procedure sub-limits, e.g. cataract or maternity caps — [{label, capPaise}]. Health only; '[]' elsewhere. */
    subLimits: jsonb("sub_limits").notNull().default(sql`'[]'::jsonb`),
    /** days from startDate before any illness (non-accident) claim is admissible. Health only; null for life/vehicle. */
    initialWaitingDays: integer("initial_waiting_days"),
    /** months from startDate before a pre-existing-disease claim is admissible. Health only; null for life/vehicle. */
    preExistingWaitingMonths: integer("pre_existing_waiting_months"),
    /** months from startDate before a maternity claim is admissible. Health only; null for life/vehicle. */
    maternityWaitingMonths: integer("maternity_waiting_months"),
    /** sum insured is reinstated after an exhausting claim. Health only. */
    restorationBenefit: boolean("restoration_benefit").notNull().default(false),
    /** currently accrued no-claim-bonus loading on the sum insured, in basis points. Health only. */
    ncbBps: integer("ncb_bps").notNull().default(0),
    /** cap on ncbBps this policy allows. Health only. */
    ncbMaxBps: integer("ncb_max_bps").notNull().default(0),
    /** third-party administrator handling claims for this policy; "" if unset. Health only. */
    tpaName: text("tpa_name").notNull().default(""),
    tpaContactPhone: text("tpa_contact_phone").notNull().default(""),
    /** named exclusions, e.g. "cosmetic surgery", "pre-existing diabetes (2 yrs)" */
    exclusions: text("exclusions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** user attests all proposal-form disclosures (medical history, habits, etc.) were made truthfully and completely */
    disclosuresComplete: boolean("disclosures_complete").notNull().default(false),
    /** uploaded policy document (single file, stored like an attachment); null when none. */
    documentPath: text("document_path"),
    documentName: text("document_name"),
    documentMime: text("document_mime"),
    documentSizeBytes: integer("document_size_bytes"),
    notes: text("notes").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insurance_policies_user_idx").on(t.userId)],
);

export const policyCoveredPersons = pgTable(
  "policy_covered_persons",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.personId] })],
);

/**
 * One row per card per statement cycle — the reconciliation snapshot. Written by
 * the extractor when it processes a statement: it matches the statement's lines to
 * ledger transactions already recorded from real-time alerts, stamps those ledger
 * rows (`transactions.reconciled_statement_id`), and records the cycle's totals +
 * match stats here. Keyed on `(account_id, period)` — NOT the ingestion — so a
 * mailbox's duplicate statement emails collapse to one record and a replay updates
 * in place instead of piling up. `period` is the statement/received month "YYYY-MM".
 */
export const statementReconciliations = pgTable(
  "statement_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** the statement cycle, "YYYY-MM"; the idempotency key with account_id */
    period: text("period").notNull(),
    /** the statement's close date, when it stated one */
    statementDate: date("statement_date"),
    /** the last statement email that produced this row — informational, not the key */
    ingestionId: uuid("ingestion_id").references(() => emailIngestions.id, {
      onDelete: "set null",
    }),
    // Summary snapshot (from the statement's totals block; null when not stated).
    totalDuePaise: bigint("total_due_paise", { mode: "number" }),
    minDuePaise: bigint("min_due_paise", { mode: "number" }),
    rewardOpening: integer("reward_opening"),
    rewardEarned: integer("reward_earned"),
    rewardRedeemed: integer("reward_redeemed"),
    rewardClosing: integer("reward_closing"),
    // Match stats over the statement's own transaction lines.
    /** statement transaction lines extracted */
    lineCount: integer("line_count").notNull().default(0),
    /** sum of the debit (spend) lines' magnitudes, in paise */
    lineDebitPaise: bigint("line_debit_paise", { mode: "number" }).notNull().default(0),
    /** lines matched to a ledger transaction already recorded this cycle */
    matchedCount: integer("matched_count").notNull().default(0),
    /** sum of the matched lines' magnitudes, in paise */
    matchedPaise: bigint("matched_paise", { mode: "number" }).notNull().default(0),
    /** lines with no ledger match — new drafts / exceptions to review */
    unmatchedCount: integer("unmatched_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("statement_reconciliations_cycle_idx").on(t.accountId, t.period),
    index("statement_reconciliations_user_idx").on(t.userId, t.accountId),
  ],
);

export const sipTargetKind = pgEnum("sip_target_kind", ["mf_folio", "account"]);
export const sipStatus = pgEnum("sip_status", ["active", "paused"]);
export const sipFundingSource = pgEnum("sip_funding_source", ["bank_debit", "payroll"]);
/**
 * How often the SIP debits. Most MF SIPs are monthly, but PPF/SSY are often
 * funded with a single lump quarterly/annual deposit rather than a monthly
 * trickle — this lets those goals still be modelled as a SIP instead of being
 * left out of the commitment math entirely.
 */
export const sipFrequency = pgEnum("sip_frequency", ["monthly", "quarterly", "yearly"]);

/**
 * A goal-funding SIP: a recurring monthly transfer from a bank/savings account
 * into either an MF folio (a `holdings` row — that table is already keyed by
 * scheme+folio, so the target is a direct FK, not duplicated scheme columns) or
 * another account (PPF/SSY deposits — think a Sukanya Samriddhi girl-child
 * goal). A goal can have several SIPs. Exactly one of `targetHoldingId` /
 * `targetAccountId` is set, matching `targetKind`; enforced in the service/zod
 * layer, not the DB, the same way accounts.goal_id's "one goal" isn't a DB
 * constraint either. Cascades on both the goal and the target: a SIP has no
 * purpose once either disappears (contrast accounts.goal_id, which set-nulls,
 * because an *account* survives its goal being deleted).
 */
export const sips = pgTable(
  "sips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    sourceAccountId: uuid("source_account_id")
      .notNull()
      .references(() => accounts.id),
    targetKind: sipTargetKind("target_kind").notNull(),
    /** set when targetKind = 'mf_folio'; the holdings row IS the scheme+folio position */
    targetHoldingId: uuid("target_holding_id").references(() => holdings.id, {
      onDelete: "cascade",
    }),
    /** set when targetKind = 'account' (e.g. PPF/SSY) */
    targetAccountId: uuid("target_account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    /** debit day of month, 1–28 (validated at the zod layer, like card cycle/due day) */
    dayOfMonth: integer("day_of_month").notNull(),
    /**
     * Cadence of the debit. quarterly/yearly occurrences are anchored to the
     * month of `startDate` (see sipOccurrencesInWindow) — every 3rd/12th month
     * from there, on dayOfMonth.
     */
    frequency: sipFrequency("frequency").notNull().default("monthly"),
    status: sipStatus("status").notNull().default("active"),
    /**
     * `payroll` means the contribution is deducted from salary (EPF) and is
     * recorded directly to the retirement account from the payslip, with no
     * bank leg — so it counts toward a goal's committed funding but must
     * never be subtracted again by the cash forecast, and is never manually
     * recorded.
     */
    fundingSource: sipFundingSource("funding_source").notNull().default("bank_debit"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sips_user_idx").on(t.userId),
    index("sips_goal_idx").on(t.goalId),
    index("sips_source_account_idx").on(t.sourceAccountId),
    // Storage-level guarantee, not just a service-level one: the app-level
    // `sipFundingSourceIssue` check gives the friendly error, but two concurrent
    // partial updateSip calls can each validate the merged (targetKind,
    // fundingSource) pair against the same pre-transaction row and still combine
    // into an invalid payroll+mf_folio pair — this constraint is what actually
    // makes that state unreachable, regardless of code path or interleaving.
    check(
      "sips_payroll_requires_account_target",
      sql`${t.fundingSource} <> 'payroll' or ${t.targetKind} = 'account'`,
    ),
  ],
);