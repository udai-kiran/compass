/**
 * planning module — physically defines its 5 resident tables + 1 resident enum,
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

import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { categories } from "../../db/shared/foundation.ts";

// Re-export shared symbols.
export { goals, goalType } from "../../db/shared/foundation.ts";

export const budgetPeriod = pgEnum("budget_period", ["monthly", "annual"]);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    period: budgetPeriod("period").notNull().default("monthly"),
    /** "2026-07" for monthly, "2026" for annual */
    periodKey: text("period_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budgets_user_period_idx").on(t.userId, t.period, t.periodKey)],
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    rollover: boolean("rollover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budget_lines_budget_category_idx").on(t.budgetId, t.categoryId)],
);

/** Dedup ledger: one alert per (period, category, threshold) — never re-fires. */
export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    periodKey: text("period_key").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    threshold: integer("threshold").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budget_alerts_unique_idx").on(t.userId, t.periodKey, t.categoryId, t.threshold),
  ],
);

export const subscriptionDismissals = pgTable(
  "subscription_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    merchant: text("merchant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subscription_dismissals_unique_idx").on(t.userId, t.merchant)],
);

/** Per-user assumptions used only for forward-looking goal projections. */
export const projectionSettings = pgTable("projection_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Broad-equity annual return assumption (1200 = 12%). */
  equityReturnBps: integer("equity_return_bps").notNull().default(1200),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});