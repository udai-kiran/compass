import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";
import { goals, mailboxAccounts } from "./foundation.ts";

/**
 * Long-lived financial containers are accounts. Their current value is the
 * account balance; scheme-specific metadata lives in a one-to-one detail table.
 */
export const accountType = pgEnum("account_type", [
  "bank",
  "cash",
  "credit_card",
  "investment",
  "loan",
  // Generic overdraft/line-of-credit account. It shares drawing-power details
  // with an overdraft home loan but is kept distinct for reporting and labels.
  "overdraft",
  "ppf",
  "epf",
  // Sukanya Samriddhi: a PPF twin (fixed govt rate, credited annually, matures
  // ~21 years out, has an account number). Reuses the scheme-details structure.
  "ssy",
  "nps",
  // Overdraft home loan (SBI Maxgain and its equivalents). A distinct type, not
  // just a loan: you park surplus into it to cut interest and can withdraw it
  // back, so it carries a sanctioned limit and a drawing power a term loan has
  // no notion of. The balance is still what you owe (net of parked surplus), so
  // it lands in the loans bucket like any liability.
  "home_loan_od",
  // DEPRECATED: insurance is now a standalone entity (see insurance_policies),
  // not an account. This enum value is retained only because Postgres cannot drop
  // an enum value; no account uses it and the UI no longer offers it.
  "insurance",
]);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** human-facing label, e.g. "HDFC Joint" — never parsed; display comes from this alone */
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    /** issuing bank/institution; a lookup key for import matching, not a display badge */
    institution: text("institution"),
    /**
     * Last 4 digits, shown in lists so two HDFC accounts are tellable apart.
     * Derived from bank_details.account_number whenever one exists — see
     * syncAccountLast4 — so the two can never disagree. Set by hand only when
     * the full number isn't recorded.
     */
    accountLast4: text("account_last4"),
    /**
     * Whose account this is. Universal, not bank-only: a card has a name on it
     * and a PPF has a holder. Without this the holder gets packed into `name`
     * ("HDFC Ammu PPF"), which is the same trap the last-4 used to be in.
     */
    holderName: text("holder_name"),
    /**
     * UPI handles that resolve to this account, primary first. Not bank-only —
     * RuPay credit cards link to UPI too, so this can't live on bank_details.
     */
    upiIds: text("upi_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    currency: text("currency").notNull().default("INR"),
    openingBalancePaise: bigint("opening_balance_paise", { mode: "number" })
      .notNull()
      .default(0),
    /**
     * Goal this account is earmarked for; net worth and goal funding group by
     * it. Null = the "Unassigned" bucket. Set-null on goal delete so the account
     * survives. A goal's funded value is the sum of the assets that point here.
     */
    // AnyPgColumn keeps inference stable across the accounts → goals reference
    // (goals is declared after accounts in this file).
    goalId: uuid("goal_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const emailClass = pgEnum("email_class", [
  "transaction_alert",
  "card_statement",
  "bill",
  "otp",
  "promo",
  "other",
]);

export const emailIngestStatus = pgEnum("email_ingest_status", [
  "pending",
  "processing",
  "extracted",
  "deferred",
  "ignored",
  "failed",
]);

/**
 * One ingested email. The raw RFC822 message is retained (`raw`) so extraction
 * is replayable after a parser/prompt fix. `messageId` dedupes re-fetches.
 */
export const emailIngestions = pgTable(
  "email_ingestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    mailboxId: uuid("mailbox_id").references(() => mailboxAccounts.id, { onDelete: "set null" }),
    /** RFC822 Message-ID header; the dedupe key for re-fetched mail */
    messageId: text("message_id").notNull(),
    fromAddr: text("from_addr").notNull().default(""),
    subject: text("subject").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    /** full RFC822 message (MIME is ascii-safe), retained for replay */
    raw: text("raw").notNull(),
    classification: emailClass("classification"),
    status: emailIngestStatus("status").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_ingestions_msgid_idx").on(t.userId, t.messageId),
    index("email_ingestions_status_idx").on(t.userId, t.status),
  ],
);