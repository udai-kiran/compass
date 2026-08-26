/**
 * protection module — physically defines its 2 resident tables (no resident enums),
 * re-exports shared tables/enums from the shared layers that this module's
 * services rely on, and imports the shared tables/enums its residents reference
 * via FK.
 *
 * Resident tables are defined here as real `pgTable()` calls (moved verbatim
 * from `db/schema.ts`). Shared tables/enums from other domains that this module's
 * residents FK to are imported from the appropriate shared layer files.
 * `db/schema.ts` is the barrel entry point; this file never imports from
 * `../../db/schema.ts` or from another module's schema.ts.
 */

import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { accounts } from "../../db/shared/hubs.ts";
import { insurancePolicies } from "../../db/shared/spines.ts";

// Re-export shared symbols (including those imported above for FKs).
export { insurancePolicies, insuranceKind, vehicleKind, healthType, premiumFrequency, policyOwnership, policyCoveredPersons } from "../../db/shared/spines.ts";

export const retirementDetails = pgTable("retirement_details", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** annual interest rate in basis points (710 = 7.10%) */
  annualRateBps: integer("annual_rate_bps").notNull().default(0),
  /** PPF matures 15 years from opening; EPF has no maturity, so null */
  maturityDate: date("maturity_date"),
  /** UAN for EPF, account number for PPF — free-form, may be non-numeric */
  referenceNumber: text("reference_number").notNull().default(""),
  /**
   * EPF only: the accumulated Employee Pension Scheme (EPS) balance. EPFO tracks
   * it separately from the provident-fund corpus, so it's a distinct figure the
   * account balance doesn't include. Null for PPF/SSY (and for EPF until entered).
   */
  epsBalancePaise: bigint("eps_balance_paise", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Health cards for a policy — a family-floater has one per covered member, so a
 * policy can have several. Files go through the storage layer like attachments;
 * each card optionally names the member it belongs to.
 */
export const insuranceHealthCards = pgTable(
  "insurance_health_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** which member this card is for, e.g. "Spouse"; "" when unlabeled */
    label: text("label").notNull().default(""),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storedPath: text("stored_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insurance_health_cards_policy_idx").on(t.policyId)],
);