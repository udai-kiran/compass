/**
 * investments module — physically defines its 6 resident tables + 4 resident enums,
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
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { accounts } from "../../db/shared/hubs.ts";
import { holdings, sips } from "../../db/shared/spines.ts";

// Re-export shared symbols (including those imported above for FKs).
export { holdings, assetClass, gainsTaxClass } from "../../db/shared/spines.ts";
export { sips, sipTargetKind, sipStatus, sipFundingSource, sipFrequency } from "../../db/shared/spines.ts";

export const npsTier = pgEnum("nps_tier", ["tier_i", "tier_ii"]);

/** Scheme metadata for an NPS account; its corpus is the account balance. */
export const accountNpsDetails = pgTable("account_nps_details", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  pran: text("pran").notNull().default(""),
  tier: npsTier("tier").notNull().default("tier_i"),
  /** Current E/C/G scheme allocation; validated to total 100 by the service. */
  equityPct: integer("equity_pct").notNull().default(0),
  corporatePct: integer("corporate_pct").notNull().default(0),
  govtPct: integer("govt_pct").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Extra detail for legacy `nps` holdings. */
export const npsDetails = pgTable("nps_details", {
  holdingId: uuid("holding_id")
    .primaryKey()
    .references(() => holdings.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  pran: text("pran").notNull().default(""),
  tier: npsTier("tier").notNull().default("tier_i"),
  /** scheme allocation, percent; E + C + G must total 100 (enforced in the service) */
  equityPct: integer("equity_pct").notNull().default(0),
  corporatePct: integer("corporate_pct").notNull().default(0),
  govtPct: integer("govt_pct").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goldForm = pgEnum("gold_form", ["physical", "digital", "etf", "sgb"]);

/** Extra detail for `gold` holdings. */
export const goldDetails = pgTable("gold_details", {
  holdingId: uuid("holding_id")
    .primaryKey()
    .references(() => holdings.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  form: goldForm("form").notNull().default("physical"),
  /** karat, physical/digital only (22 or 24); null for etf/sgb */
  purityKarat: integer("purity_karat"),
  /** SGB matures 8 years from issue; null for every other form */
  maturityDate: date("maturity_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const holdingValuations = pgTable(
  "holding_valuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    valuePaise: bigint("value_paise", { mode: "number" }).notNull(),
    /**
     * NAV per unit on `date` (from the AMFI feed), when known. Lets the day's
     * change be the true market move — (navToday − navPrev) on the held units —
     * rather than a raw value delta that a same-day buy would distort. Null for
     * manual valuations that only recorded a total value.
     */
    nav: doublePrecision("nav"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("holding_valuations_unique_idx").on(t.holdingId, t.date)],
);

export const holdingEventType = pgEnum("holding_event_type", ["buy", "sell", "dividend"]);

/** Where an event came from: a statement import, or hand-entered. Drives per-date
 * FIFO-order reconciliation on re-import (imports may re-sequence imported events;
 * manual ones are only ever moved by the user). See services/mf-import.ts. */
export const holdingEventSource = pgEnum("holding_event_source", ["import", "manual"]);

export const holdingEvents = pgTable(
  "holding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    type: holdingEventType("type").notNull(),
    date: date("date").notNull(),
    /** always positive; the type carries direction */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    units: doublePrecision("units"),
    note: text("note").notNull().default(""),
    /**
     * Intra-day order key: the 0-based position of this event *within its
     * (holding, date)*. Both imported and manual events carry one, so a same-day
     * manual sale can sit before an imported buy. `date` is FIFO's primary key,
     * so seq only has to separate events sharing a day (see services/tax-lots.ts).
     * User-editable via the reorder endpoint.
     */
    seq: integer("seq"),
    /** import vs manual; default import (the dominant source). Manual adds set it. */
    source: holdingEventSource("source").notNull().default("import"),
    /**
     * The SIP installment this buy booked, when it was recorded from a SIP
     * rather than hand-entered or imported. `set null` on delete, not cascade:
     * deleting the SIP *plan* must not erase units the user really bought.
     */
    sipId: uuid("sip_id").references(() => sips.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("holding_events_holding_idx").on(t.holdingId, t.date),
    uniqueIndex("holding_events_sip_date_idx").on(t.sipId, t.date).where(sql`sip_id is not null`),
  ],
);

export const netWorthSnapshots = pgTable(
  "net_worth_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    assetsPaise: bigint("assets_paise", { mode: "number" }).notNull(),
    liabilitiesPaise: bigint("liabilities_paise", { mode: "number" }).notNull(),
    /** { cash, holdings, investmentAccounts, creditCards, loans } */
    breakdown: jsonb("breakdown"),
    /** true when estimated from ledger history rather than observed */
    estimated: boolean("estimated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("net_worth_snapshots_unique_idx").on(t.userId, t.date)],
);

// ---------- Deposit details (FD / RD / NSC / Tax-saver FD) ----------

/** Discriminates the deposit instrument. */
export const depositKind = pgEnum("deposit_kind", ["fd", "rd", "nsc", "tax_saver_fd"]);

/** How often interest is compounded. */
export const compoundingFrequency = pgEnum("compounding_frequency", [
  "monthly",
  "quarterly",
  "half_yearly",
  "annually",
]);

/** Whether earned interest is reinvested (compounds) or paid out each period. */
export const interestDisposition = pgEnum("interest_disposition", ["reinvest", "payout"]);

/**
 * Structured terms for fixed-income holdings (FD, RD, NSC, tax-saver FD).
 * One row per holding (holdingId PK → holdings.id). Asset class must be 'fd'
 * for the parent holding — enforced in the service layer, not the DB.
 *
 * Lump-sum instruments (FD/NSC/tax_saver_fd) supply `principalPaise`.
 * Recurring deposits (RD) supply `installmentPaise` + `totalInstallments`.
 */
export const depositDetails = pgTable(
  "deposit_details",
  {
    holdingId: uuid("holding_id")
      .primaryKey()
      .references(() => holdings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    depositKind: depositKind("deposit_kind").notNull(),
    /** FD/NSC: lump-sum invested amount. Null for RD. */
    principalPaise: bigint("principal_paise", { mode: "number" }),
    /** RD: monthly installment amount. Null for FD/NSC. */
    installmentPaise: bigint("installment_paise", { mode: "number" }),
    /** RD: number of monthly installments. Null for FD/NSC. */
    totalInstallments: integer("total_installments"),
    /** Annual interest rate in basis points: 7.10% = 710. */
    annualRateBps: integer("annual_rate_bps").notNull(),
    compoundingFrequency: compoundingFrequency("compounding_frequency").notNull(),
    interestDisposition: interestDisposition("interest_disposition").notNull().default("reinvest"),
    /** Non-null only when interestDisposition = 'payout'. */
    payoutFrequency: text("payout_frequency"),
    startDate: date("start_date").notNull(),
    maturityDate: date("maturity_date").notNull(),
    autoRenewal: boolean("auto_renewal").notNull().default(false),
    /** Rate reduction on premature closure, basis points; null = not applicable. */
    prematureClosurePenaltyBps: integer("premature_closure_penalty_bps"),
    /** Free-form joint holder name (not FK to family_members). */
    jointHolderName: text("joint_holder_name"),
    /** Advisory 194A flag — actual TDS recording deferred to task 13.4/13.10. */
    tdsSectionApplicable: boolean("tds_section_applicable").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deposit_details_maturity_after_start", sql`${t.maturityDate} > ${t.startDate}`),
    check(
      "deposit_details_principal_or_installment",
      sql`${t.principalPaise} > 0 OR ${t.installmentPaise} > 0`,
    ),
    check(
      "deposit_details_rd_needs_installment",
      sql`${t.depositKind} <> 'rd' OR ${t.installmentPaise} IS NOT NULL`,
    ),
    check(
      "deposit_details_rd_needs_total_installments",
      sql`${t.depositKind} <> 'rd' OR ${t.totalInstallments} IS NOT NULL`,
    ),
    check(
      "deposit_details_non_rd_needs_principal",
      sql`${t.depositKind} = 'rd' OR ${t.principalPaise} IS NOT NULL`,
    ),
  ],
);