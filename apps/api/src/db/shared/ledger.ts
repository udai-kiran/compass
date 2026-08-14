import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";
import { categories, expenseNecessity, resources } from "./foundation.ts";
import { accounts } from "./hubs.ts";
import { recurringTemplates } from "./recurring.ts";
import { insurancePolicies, sips, statementReconciliations } from "./spines.ts";

export const transactionSource = pgEnum("transaction_source", ["manual", "import", "recurring"]);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date").notNull(),
    /**
     * Precise transaction instant when known (a card alert / statement line
     * prints a time); null for date-only sources (CSV, manual). `date` stays the
     * authoritative day for ordering/reports — this only sharpens statement↔ledger
     * matching, where amount + timestamp uniquely ties a line to its ledger row.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    merchant: text("merchant").notNull().default(""),
    notes: text("notes").notNull().default(""),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: transactionSource("source").notNull().default("manual"),
    /**
     * Insurance policy this expense pays a premium for — a link to an
     * insurance_policies row. Null for ordinary transactions. Lets a policy
     * show its premium history without being an account itself.
     * See services/insurance.ts.
     */
    policyId: uuid("policy_id").references((): AnyPgColumn => insurancePolicies.id, {
      onDelete: "set null",
    }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    /**
     * The SIP installment this transaction booked, when it was recorded from
     * a SIP rather than hand-entered or imported. `set null` on delete, not
     * cascade: deleting the SIP *plan* must not erase a real ledger
     * transaction.
     */
    sipId: uuid("sip_id").references((): AnyPgColumn => sips.id, { onDelete: "set null" }),
    recurringTemplateId: uuid("recurring_template_id").references(
      (): AnyPgColumn => recurringTemplates.id,
      { onDelete: "set null" },
    ),
    /**
     * The statement cycle that cleared this transaction — set when a statement
     * line matched it (see statement_reconciliations). A set-once-per-cycle stamp:
     * the reconciler clears and re-applies it on replay, so it always reflects the
     * latest processing of that cycle. Null for anything a statement hasn't cleared.
     */
    reconciledStatementId: uuid("reconciled_statement_id").references(
      (): AnyPgColumn => statementReconciliations.id,
      { onDelete: "set null" },
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_date_idx").on(
      t.userId,
      t.date.desc(),
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("transactions_policy_idx").on(t.policyId),
    index("transactions_resource_idx").on(t.resourceId),
    index("transactions_recurring_template_idx").on(t.recurringTemplateId),
    index("transactions_reconciled_idx").on(t.reconciledStatementId),
    // A soft-deleted installment must free its (sip, date) slot for a
    // re-linked transaction — `deleted_at is null` excludes it from the
    // uniqueness predicate. This deliberately differs from
    // `holding_events_sip_date_idx`, which has no such exclusion: holding_events
    // rows are hard-deleted (see services/holdings.ts), so there's no
    // soft-deleted row left to collide with in the first place.
    uniqueIndex("transactions_sip_date_idx")
      .on(t.sipId, t.date)
      .where(sql`sip_id is not null and deleted_at is null`),
  ],
);

/**
 * A zero-sum-per-transaction leg of the double-entry postings model, dual-written
 * alongside the legacy single-entry `transactions` row (see PLAN-dualwrite.md).
 * Not yet read by any aggregation/reader in PR-A — purely additive shadow data.
 */
export const postings = pgTable(
  "postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    necessity: expenseNecessity("necessity"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("postings_tx_idx").on(t.transactionId),
    index("postings_account_idx").on(t.accountId),
    index("postings_category_idx").on(t.categoryId),
  ],
);