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