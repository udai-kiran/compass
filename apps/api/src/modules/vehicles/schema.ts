/**
 * vehicles module — physically defines its 2 resident tables. Extends a
 * `resources` row of kind `"vehicle"` (defined in `db/shared/foundation.ts`,
 * resident to no module) with vehicle-specific service tracking and an
 * odometer-reading log, the same way `credit/schema.ts`'s `cardDetails`
 * extends `accounts`.
 *
 * Resident tables are defined here as real `pgTable()` calls. Shared tables
 * from other domains that these residents FK to are imported from the
 * appropriate shared layer file. `db/schema.ts` is the barrel entry point;
 * this file never imports from `../../db/schema.ts` or from another module's
 * schema.ts.
 */

import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { resources } from "../../db/shared/foundation.ts";
import { transactions } from "../../db/shared/ledger.ts";

/**
 * One row per vehicle resource, created lazily on first configuration (not
 * every `resources` row of kind "vehicle" has one). `resourceId` is both the
 * primary key and the FK — a strict 1:1 extension, `onDelete: "cascade"` so
 * deleting the vehicle resource cleans this up automatically.
 *
 * Both interval fields are independently optional: a vehicle can be tracked
 * by km only, by time only, by both ("whichever comes first" — see
 * services/service-due.ts), or configured with neither (service tracking
 * simply switched off).
 */
export const vehicleDetails = pgTable("vehicle_details", {
  resourceId: uuid("resource_id")
    .primaryKey()
    .references(() => resources.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  serviceIntervalKm: integer("service_interval_km"),
  serviceIntervalMonths: integer("service_interval_months"),
  lastServiceOdometerKm: integer("last_service_odometer_km"),
  lastServiceDate: date("last_service_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only odometer log for a vehicle resource. `transactionId` optionally
 * links the reading to the fuel/service spend it was taken alongside — the
 * source of the paise figure `services/mileage.ts` uses for the economy
 * calc (this app tracks money, never litres; see that file's doc comment).
 * A transaction can back at most one reading (partial unique index).
 */
export const vehicleOdometerReadings = pgTable(
  "vehicle_odometer_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    odometerKm: integer("odometer_km").notNull(),
    readingDate: date("reading_date").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vehicle_odometer_readings_resource_idx").on(t.resourceId, t.readingDate),
    uniqueIndex("vehicle_odometer_readings_txn_idx")
      .on(t.transactionId)
      .where(sql`${t.transactionId} is not null`),
    check("vehicle_odometer_readings_km_check", sql`${t.odometerKm} >= 0`),
  ],
);
