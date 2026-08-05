/**
 * ledger module — physically defines its 6 resident tables (no resident enums),
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

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

// Symbols imported for FK references in resident table definitions.
import { transactions } from "../../db/shared/ledger.ts";
import { categories } from "../../db/shared/foundation.ts";

// Re-export shared symbols (including those imported above for FKs).
export { accounts, accountType } from "../../db/shared/hubs.ts";
export { categories, categoryKind, expenseNecessity, resourceKind, resources } from "../../db/shared/foundation.ts";
export { recurringFrequency, recurringKind, recurringTemplates } from "../../db/shared/recurring.ts";
export { transactions, transactionSource } from "../../db/shared/ledger.ts";

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transaction_splits_tx_idx").on(t.transactionId)],
);

export const transferLinks = pgTable(
  "transfer_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    outTransactionId: uuid("out_transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "cascade" }),
    inTransactionId: uuid("in_transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "cascade" }),
    auto: boolean("auto").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transfer_links_user_idx").on(t.userId)],
);

export const transactionLinks = pgTable(
  "transaction_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("transaction_links_tx_idx").on(t.transactionId)],
);

export const merchantRules = pgTable(
  "merchant_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    match: text("match").notNull(),
    replacement: text("replacement").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_rules_user_match_idx").on(t.userId, t.match)],
);

export const userTasks = pgTable(
  "user_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    /**
     * Who/what created the row. `'user'` for ordinary user-authored tasks;
     * `'card-due'` for tasks materialised from a credit-card due date (see
     * services/card-due-tasks.ts). The check constraint is a storage-level
     * guarantee — a strict Zod enum on the response schema combined with
     * unconstrained DB text would otherwise turn one bad row into a 500 during
     * serialization, including via the backup-restore path, which bypasses
     * services entirely.
     */
    source: text("source").notNull().default("user"),
    /**
     * Opaque provenance key for a generated task (e.g. `<accountId>:<dueDate>`
     * for a card-due task), null for ordinary user tasks. The partial unique
     * index prevents a generator from double-inserting for the same key while
     * placing no constraint at all on ordinary tasks (many nulls allowed).
     */
    sourceKey: text("source_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_tasks_user_idx").on(t.userId),
    index("user_tasks_transaction_idx").on(t.transactionId),
    check("user_tasks_source_check", sql`${t.source} in ('user', 'card-due')`),
    uniqueIndex("user_tasks_source_key_idx")
      .on(t.userId, t.sourceKey)
      .where(sql`${t.sourceKey} is not null`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storedPath: text("stored_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_tx_idx").on(t.transactionId)],
);