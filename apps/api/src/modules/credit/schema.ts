/**
 * credit module — physically defines its 9 resident tables + 4 resident enums,
 * re-exports shared tables/enums from the shared layers that this module's
 * services rely on, and imports the shared tables/enums its residents reference
 * via FK.
 *
 * Resident tables/enums are defined here as real `pgTable()`/`pgEnum()` calls
 * (moved verbatim from `db/schema.ts`). Shared tables/enums from other domains
 * that this module's residents FK to are imported from the appropriate shared
 * layer files. `db/schema.ts` is the barrel entry point; this file never imports
 * from `../../db/schema.ts` or from another module's schema.ts.
 */

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
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { accounts, emailIngestions } from "../../db/shared/hubs.ts";
import { recurringTemplates } from "../../db/shared/recurring.ts";

// Re-export shared symbols.
export { statementReconciliations } from "../../db/shared/spines.ts";

export const cardNetwork = pgEnum("card_network", [
  "visa",
  "mastercard",
  "amex",
  "rupay",
  "diners",
]);

/**
 * Issuer and last-4 live on `accounts` (institution/accountLast4) — every
 * account has them. Card-specific fields belong here; the genuinely shared
 * fields (combined limit, mobile, utilization/reminder alerts) live on
 * `card_issuer_settings`, keyed by the account's institution. The statement-PDF
 * password stays per-card: issuers like HDFC embed the card's own last-4 in it,
 * so one bank's cards each need their own.
 */
export const cardDetails = pgTable("card_details", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  network: cardNetwork("network"),
  /** product name, e.g. "Regalia Gold" */
  productName: text("product_name").notNull().default(""),
  /** statement close day of month (1–28) */
  cycleDay: integer("cycle_day").notNull().default(1),
  /** payment due day of month (1–28); first occurrence after the close */
  dueDay: integer("due_day").notNull().default(15),
  /** reward points earned per ₹100 spent (0 = no program) */
  earnRatePer100: integer("earn_rate_per_100").notNull().default(0),
  /** Annual purchase APR in basis points; null when not set. 4200 = 42% p.a. */
  aprBps: integer("apr_bps"),
  /** APR for cash advances/withdrawals (usually higher); null when not set. */
  cashAprBps: integer("cash_apr_bps"),
  /** Flat late fee in paise; null when not set. */
  lateFeePaise: bigint("late_fee_paise", { mode: "number" }),
  /** Grace / interest-free period in days from statement close; null when not set. Typically 45–50. */
  interestFreeDays: integer("interest_free_days"),
  /**
   * Password to open this card's statement PDFs, encrypted at rest (secret-box).
   * "" when unset. Never returned to the client — the API exposes only whether
   * one is stored (see CardDetails.hasStatementPassword).
   */
  statementPasswordEnc: text("statement_password_enc").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Settings shared across every card of one bank/issuer. In India an issuer
 * typically gives a single combined credit limit spanning all your cards with
 * them, and the registered mobile is the same across those cards — so these
 * live at the issuer level, keyed by (user, institution), not per card. (The
 * statement password is NOT shared — it's per-card, on `card_details`.) The
 * `institution` matches `accounts.institution`; cards with no institution set
 * have no issuer settings (each is its own "unassigned" holder).
 */
export const cardIssuerSettings = pgTable(
  "card_issuer_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** the group key; matches accounts.institution exactly */
    institution: text("institution").notNull(),
    /** combined credit limit shared across all this bank's cards */
    creditLimitPaise: bigint("credit_limit_paise", { mode: "number" }).notNull().default(0),
    /** alert when combined utilization crosses this percentage; null disables */
    utilizationAlertPct: integer("utilization_alert_pct").default(30),
    /** days before a card's due date to send the payment reminder */
    remindDays: integer("remind_days").notNull().default(3),
    /**
     * Registered mobile (10 digits, no country code) for building the bill-payment
     * UPI VPA — e.g. Axis `CC.91<mobile><last4>@axisbank`. Empty when unknown or
     * the issuer has no VPA scheme.
     */
    billMobile: text("bill_mobile").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.institution] })],
);

/**
 * Statement PDFs (or images) a user uploads for a credit card, stored in object
 * storage (MinIO) with only the metadata row here. Kept per card — the file is
 * shown on that card's detail page. `period` tags the statement's close/month so
 * they sort meaningfully; null when the user didn't say. Mirrors the attachment /
 * health-card storage pattern (opaque storedPath key, cascade on account delete).
 */
export const cardStatements = pgTable(
  "card_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** the statement's close/period date; null when unspecified */
    period: date("period"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storedPath: text("stored_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("card_statements_account_idx").on(t.accountId, t.period)],
);

/**
 * Extra detail for `ppf`/`epf` accounts. Mirrors the card_details pattern: a
 * 1:1 optional extension keyed by account, so the core accounts table stays
 * free of type-specific columns.
 */
export const bankAccountSubtype = pgEnum("bank_account_subtype", [
  "savings",
  "current",
  "salary",
  "nre",
  "nro",
]);

/**
 * The details you'd read out to someone paying you. Holder name and UPI live on
 * `accounts` (every type has them); only bank-specific fields belong here.
 *
 * The account number is stored in the clear on purpose: it is a receiving
 * address, not a secret — it's printed on cheques and handed to employers, and
 * money cannot be pulled with it. Encrypting it would cost searchability and a
 * key to lose, while protecting a value that gets given out by design.
 */
export const bankDetails = pgTable("bank_details", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** full account number; digits only, length varies by bank (9–18) */
  accountNumber: text("account_number").notNull().default(""),
  /** IFSC, e.g. "HDFC0001234" — 4 letters, a literal 0, then 6 alphanumeric */
  ifsc: text("ifsc").notNull().default(""),
  branch: text("branch").notNull().default(""),
  subtype: bankAccountSubtype("subtype"),
  /** Required Average Monthly Balance for this account, in integer paise. 0 = no requirement set. */
  requiredAmbPaise: bigint("required_amb_paise", { mode: "number" }).notNull().default(0),
  /** last 4 of the debit card linked to this account; matches debit-card alert emails */
  debitCardLast4: text("debit_card_last4").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Extra detail for generic overdraft and `home_loan_od` accounts.
 *
 * Only the sanctioned limit is stored — the amount owed is the account balance
 * (already net of parked surplus, like the bank's own screen), and drawing
 * power derives as limit − owed. Storing surplus separately would let it drift
 * from the balance; deriving it keeps one source of truth.
 */
export const overdraftDetails = pgTable("overdraft_details", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** drawing-power ceiling, i.e. the bank's "Limit" figure */
  sanctionedLimitPaise: bigint("sanctioned_limit_paise", { mode: "number" }).notNull().default(0),
  /** annual interest rate in basis points (855 = 8.55%); drives the interest-saved estimate */
  annualRateBps: integer("annual_rate_bps").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardEntries = pgTable(
  "reward_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** positive = earned, negative = redeemed/expired */
    points: integer("points").notNull(),
    note: text("note").notNull().default(""),
    /**
     * The statement ingestion that produced this entry (null = hand-entered). Lets
     * a statement's reward rows be replaced wholesale on replay so re-processing
     * never double-counts the balance. Kept (unlinked) if the ingestion is deleted.
     */
    ingestionId: uuid("ingestion_id").references(() => emailIngestions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reward_entries_account_idx").on(t.accountId, t.date),
    index("reward_entries_ingestion_idx").on(t.ingestionId),
  ],
);

export const emiDetails = pgTable("emi_details", {
  templateId: uuid("template_id")
    .primaryKey()
    .references(() => recurringTemplates.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  principalPaise: bigint("principal_paise", { mode: "number" }).notNull(),
  /** annual interest rate in basis points (875 = 8.75%) */
  annualRateBps: integer("annual_rate_bps").notNull(),
  totalInstallments: integer("total_installments").notNull(),
  /** first installment date */
  startDate: date("start_date").notNull(),
  /**
   * The loan itself, modelled as an account (loan/home_loan_od/overdraft) —
   * see tasks/emi-loan-destination-account. Optional: an EMI with no
   * destination account materializes exactly as before this feature, one
   * source-account transaction per due date, nothing else.
   */
  loanAccountId: uuid("loan_account_id").references(() => accounts.id, { onDelete: "set null" }),
  /**
   * Running principal balance for the loan-account posting path only —
   * advanced by exactly one amortization step (see stepAmortization) each
   * time materializeDue posts a destination-account leg for this EMI. Null
   * means "not yet initialized", treated as principalPaise by every reader.
   * NOT the display/report value — listEmis's outstandingPaise stays the
   * pure amortize() schedule projection regardless of whether a destination
   * account is configured; this column is internal bookkeeping for
   * materializeDue's own write path, not exposed on the API.
   */
  outstandingPrincipalPaise: bigint("outstanding_principal_paise", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardOfferDiscountKind = pgEnum("card_offer_discount_kind", [
  "flat",
  "percentage",
  "cashback",
  "points",
]);

/**
 * Credit-card offers and deals captured from emails or entered manually.
 * `isReviewed` gates trust — only reviewed offers are returned by
 * `getActiveOffers()`. `sourceEmailId` FK to `email_ingestions` (SET NULL on
 * delete so the offer survives inbox cleanup). `discountRateBps` is in basis
 * points (100 bps = 1%). `maxCapPaise` / `minSpendPaise` are nullable bigints
 * so offers with no cap / no minimum spend threshold are represented cleanly.
 */
export const cardOffers = pgTable(
  "card_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    issuer: text("issuer").notNull(),
    cardProductName: text("card_product_name"),
    discountKind: cardOfferDiscountKind("discount_kind").notNull(),
    discountRateBps: integer("discount_rate_bps").notNull(),
    maxCapPaise: bigint("max_cap_paise", { mode: "number" }),
    minSpendPaise: bigint("min_spend_paise", { mode: "number" }),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    stackable: boolean("stackable").notNull().default(false),
    isReviewed: boolean("is_reviewed").notNull().default(false),
    sourceEmailId: uuid("source_email_id").references(() => emailIngestions.id, {
      onDelete: "set null",
    }),
    raw: text("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("card_offers_user_valid_idx").on(t.userId, t.validUntil),
    check("card_offers_rate_nonneg", sql`"discount_rate_bps" >= 0`),
    check("card_offers_cap_nonneg", sql`"max_cap_paise" IS NULL OR "max_cap_paise" >= 0`),
    check("card_offers_min_spend_nonneg", sql`"min_spend_paise" IS NULL OR "min_spend_paise" >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Reward rules & point lots (task 10.5)
// ---------------------------------------------------------------------------

/**
 * How reward points are redeemed. Determines the paise-per-point value for
 * comparison and valuation.
 */
export const rewardRedemptionRoute = pgEnum("reward_redemption_route", [
  "cashback",
  "air_miles",
  "catalogue",
  "statement_credit",
]);

/**
 * The window over which the accelerated-earn cap is cumulative.
 */
export const rewardCapPeriod = pgEnum("reward_cap_period", [
  "per_transaction",
  "monthly",
  "statement_cycle",
  "annual",
]);

/**
 * Product-level earn rules for a credit card. One row per (user, cardProductName).
 * `network` is nullable — null means "applies to any network" for that product name.
 * `redemptionValues` is a JSONB record of { route → paisePerPoint }; routes absent
 * from the map have no configured value (getPointValue returns null for them).
 * The three `accel*` fields are all-or-nothing: either all set or all null.
 * `mccExclusions` is an array of MCC codes for which earn is suppressed (returns 0).
 */
export const rewardRules = pgTable(
  "reward_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cardProductName: text("card_product_name").notNull(),
    /** null = applies to any network */
    network: cardNetwork("network"),
    /** base reward points earned per ₹100 (i.e. per 10000 paise) spent; 0 = no program */
    baseEarnPer100: integer("base_earn_per_100").notNull().default(0),
    /** MCC codes for which earn is suppressed (returns 0 points) */
    mccExclusions: text("mcc_exclusions").array().notNull().default(sql`'{}'::text[]`),
    /** multiplier applied to baseEarnPer100 for accelerated earn; all-or-nothing with cap fields */
    accelEarnMultiplier: integer("accel_earn_multiplier"),
    /** cumulative spend cap for the accelerated rate within the period, in paise */
    accelEarnCapPaise: bigint("accel_earn_cap_paise", { mode: "number" }),
    /** the period over which the accel cap is cumulative */
    accelEarnCapPeriod: rewardCapPeriod("accel_earn_cap_period"),
    /** Record<rewardRedemptionRoute, paisePerPoint> — absent key means no configured value */
    redemptionValues: jsonb("redemption_values").notNull().default(sql`'{}'::jsonb`),
    /** optional milestone spend threshold in paise for extra benefit */
    milestoneSpendPaise: bigint("milestone_spend_paise", { mode: "number" }),
    /** human-readable description of the milestone benefit */
    milestoneBenefitDesc: text("milestone_benefit_desc"),
    /** annual fee waiver threshold in paise; null = no waiver programme */
    annualFeeWaiverSpendPaise: bigint("annual_fee_waiver_spend_paise", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reward_rules_user_product_idx").on(t.userId, t.cardProductName),
    index("reward_rules_user_idx").on(t.userId),
    check("reward_rules_base_earn_nonneg", sql`"base_earn_per_100" >= 0`),
    // accel fields must all be set together or all null
    check(
      "reward_rules_accel_consistent",
      sql`(
        "accel_earn_multiplier" IS NULL AND "accel_earn_cap_paise" IS NULL AND "accel_earn_cap_period" IS NULL
      ) OR (
        "accel_earn_multiplier" IS NOT NULL AND "accel_earn_cap_paise" IS NOT NULL AND "accel_earn_cap_period" IS NOT NULL
      )`,
    ),
  ],
);

/**
 * Per-tranche expiry tracking for reward points. Additive metadata only — does
 * NOT replace or interact with `reward_entries` (the signed point ledger).
 * Each lot records points earned in one tranche (e.g. a signup bonus, a
 * statement reward credit) with an optional expiry date.
 */
export const rewardPointLots = pgTable(
  "reward_point_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cardDetailsAccountId: uuid("card_details_account_id")
      .notNull()
      .references(() => cardDetails.accountId, { onDelete: "cascade" }),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    /** non-negative integer point count for this tranche */
    points: integer("points").notNull(),
    /** null = no expiry for this lot */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isRedeemed: boolean("is_redeemed").notNull().default(false),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reward_point_lots_user_expires_idx").on(t.userId, t.expiresAt),
    index("reward_point_lots_user_idx").on(t.userId),
    check("reward_point_lots_points_nonneg", sql`"points" >= 0`),
  ],
);