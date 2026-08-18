/**
 * system module — physically defines its 5 resident tables + 2 resident enums,
 * re-exports the shared `users` table from `core-schema.ts` for module-internal
 * use, and imports the shared tables/enums its residents reference via FK.
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
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";
import { accounts } from "../../db/shared/hubs.ts";

export { users } from "../../db/core-schema.ts";
export { familyRelationship, educationStage, familyMembers } from "../../db/shared/persons.ts";

/** Per-user profile information. */
export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  dateOfBirth: date("date_of_birth"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    data: jsonb("data"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt.desc())],
);

export const alertLedger = pgTable(
  "alert_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    refKey: text("ref_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("alert_ledger_unique_idx").on(t.userId, t.kind, t.refKey)],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** budget | bill | goal | large_transaction | low_balance */
    type: text("type").notNull(),
    /** null = applies to all accounts */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    thresholdPaise: bigint("threshold_paise", { mode: "number" }),
    leadDays: integer("lead_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_prefs_user_idx").on(t.userId, t.type)],
);