/**
 * tax module schema — resident tables + enums for the tax domain (task 13.1).
 *
 * Resident tables:
 *   - tax_regime_preferences — per-user, per-FY income-tax regime preference
 *
 * Cross-domain FK target: users (from db/core-schema.ts).
 * No imports from other module schema.ts files.
 */

import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
