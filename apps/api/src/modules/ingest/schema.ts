/**
 * ingest module — physically defines its 5 resident tables + 4 resident enums,
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
import { accounts, emailIngestions } from "../../db/shared/hubs.ts";
import { categories, mailboxProvider } from "../../db/shared/foundation.ts";
import { transactions } from "../../db/shared/ledger.ts";

// Re-export shared symbols.
export { mailboxAccounts, mailboxProvider, mailboxStatus } from "../../db/shared/foundation.ts";
export { emailIngestions, emailClass, emailIngestStatus } from "../../db/shared/hubs.ts";

export const importStatus = pgEnum("import_status", ["staged", "committed", "rolled_back"]);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    fileName: text("file_name").notNull(),
    status: importStatus("status").notNull().default("staged"),
    mapping: jsonb("mapping"),
    headers: text("headers").array().notNull().default(sql`'{}'::text[]`),
    rowCount: integer("row_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("imports_user_idx").on(t.userId)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    raw: jsonb("raw").notNull(),
    date: date("date"),
    amountPaise: bigint("amount_paise", { mode: "number" }),
    merchant: text("merchant").notNull().default(""),
    rawMerchant: text("raw_merchant").notNull().default(""),
    notes: text("notes").notNull().default(""),
    categoryId: uuid("category_id"),
    dedupeHash: text("dedupe_hash"),
    duplicate: boolean("duplicate").notNull().default(false),
    include: boolean("include").notNull().default(true),
    error: text("error"),
    transactionId: uuid("transaction_id"),
    /**
     * When this row reconciled by *correcting* an existing imported transaction,
     * the pre-update snapshot of that transaction ({ transactionId, date,
     * amountPaise, merchant, notes, source }) — so rollback can restore it.
     */
    reconciledFrom: jsonb("reconciled_from"),
  },
  (t) => [
    index("import_rows_import_idx").on(t.importId),
    index("import_rows_hash_idx").on(t.dedupeHash),
  ],
);

export const importPresets = pgTable(
  "import_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    mapping: jsonb("mapping").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_presets_account_idx").on(t.userId, t.accountId)],
);

export const mailboxCredentials = pgTable(
  "mailbox_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: mailboxProvider("provider").notNull(),
    clientId: text("client_id").notNull(),
    /** OAuth client secret, encrypted with the app secret (same envelope as the refresh token) */
    clientSecretEnc: text("client_secret_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mailbox_credentials_user_provider_idx").on(t.userId, t.provider)],
);

export const extractedTxnStatus = pgEnum("extracted_txn_status", [
  "pending",
  "accepted",
  "rejected",
  // A statement line the matcher tied to a transaction already in the ledger —
  // hidden from the pending queue, kept (linked, reversible) so nothing is lost.
  "duplicate",
]);
export const txnDirection = pgEnum("txn_direction", ["debit", "credit"]);
/**
 * The model's classification of a credit draft's purpose — repayment to a card,
 * genuine refund, or cashback. Null = ordinary or unknown; this only captures
 * the signal, it does not change any suggestion/history behaviour (see misc-01).
 */
export const extractedTxnIntent = pgEnum("extracted_txn_intent", ["repayment", "refund", "cashback"]);

/**
 * A transaction the model pulled out of an email — a draft in the review inbox.
 * `amountPaise` is a positive magnitude; `direction` gives the sign applied when
 * the reviewer accepts it into the ledger. Category is never set here (accept is
 * a manual step). `dedupeHash` collapses the alert and the later statement line.
 */
export const extractedTransactions = pgTable(
  "extracted_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    ingestionId: uuid("ingestion_id")
      .notNull()
      .references(() => emailIngestions.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    direction: txnDirection("direction").notNull(),
    occurredAt: date("occurred_at"),
    /**
     * Precise instant the line/alert prints (`occurredAt` keeps the date). Carried
     * to `transactions.occurred_at` on accept and used as the primary statement↔
     * ledger match key; null when the source shows only a date.
     */
    occurredAtTs: timestamp("occurred_at_ts", { withTimezone: true }),
    counterparty: text("counterparty").notNull().default(""),
    suggestedAccountId: uuid("suggested_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** AI's category guess from the merchant; the reviewer confirms/overrides on accept */
    suggestedCategoryId: uuid("suggested_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    /**
     * The model's classification of a credit's purpose (repayment/refund/cashback),
     * or null for an ordinary/unclassified draft. Captured for the reviewer to see;
     * does not suppress or alter `suggestedCategoryId` (see misc-01).
     */
    intent: extractedTxnIntent("intent"),
    bankRef: text("bank_ref"),
    sourceQuote: text("source_quote").notNull().default(""),
    confidence: doublePrecision("confidence"),
    /** bank_ref, or a hash of amount+date+counterparty; unique to collapse duplicates */
    dedupeHash: text("dedupe_hash"),
    status: extractedTxnStatus("status").notNull().default("pending"),
    /** set once accepted into the ledger */
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    /**
     * The ledger transaction this draft was matched to (status `duplicate`): the
     * statement re-listed a spend already recorded from a real-time alert. Set by
     * the statement matcher; cleared if the reviewer says it isn't a duplicate.
     */
    matchedTransactionId: uuid("matched_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("extracted_transactions_status_idx").on(t.userId, t.status),
    index("extracted_transactions_ingestion_idx").on(t.ingestionId),
    uniqueIndex("extracted_transactions_dedupe_idx").on(t.userId, t.dedupeHash),
  ],
);