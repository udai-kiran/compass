import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";

export const goalType = pgEnum("goal_type", [
  "savings",
  "emergency_fund",
  "vacation",
  "home",
  "vehicle",
  "education",
  "retirement",
  "custom",
]);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    type: goalType("type").notNull().default("savings"),
    targetPaise: bigint("target_paise", { mode: "number" }),
    /** emergency_fund preset: target = N months of trailing average expenses */
    targetMonths: integer("target_months"),
    targetDate: date("target_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goals_user_idx").on(t.userId)],
);

export const categoryKind = pgEnum("category_kind", ["income", "expense"]);

/** See ExpenseNecessitySchema in packages/shared — null = not yet decided. */
export const expenseNecessity = pgEnum("expense_necessity", ["essential", "non_essential"]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    /**
     * DEFAULT need-vs-want for transactions in this category. A transaction's own
     * `necessity` column overrides it — see `effectiveNecessity` in
     * packages/shared. Nullable on purpose: null is "undecided", a state reports
     * must show rather than guess.
     *
     * Always null for income categories: services/categories.ts enforces that on
     * both read and write, and the `categories_necessity_expense_only` check
     * constraint below makes a violating row unstorable even on the
     * backup-restore path, which bypasses those services entirely.
     */
    necessity: expenseNecessity("necessity"),
    parentId: uuid("parent_id"),
    icon: text("icon").notNull().default(""),
    color: text("color").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("categories_user_idx").on(t.userId),
    uniqueIndex("categories_user_name_parent_idx").on(t.userId, t.name, t.parentId),
    // Storage-level guarantee, not just a service-level one: backup restore
    // copies archive columns straight into this table (services/restore-user.ts,
    // db/restore.ts), bypassing the guards in services/categories.ts. Masking a
    // bad value on read is not the same as making it unstorable.
    check("categories_necessity_expense_only", sql`${t.necessity} is null or ${t.kind} = 'expense'`),
  ],
);

export const resourceKind = pgEnum("resource_kind", [
  "vehicle",
  "electricity",
  "mobile",
  "internet",
  "gas",
  "water",
  "other",
]);

/** A physical asset or service connection that expenses can be attributed to. */
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: resourceKind("kind").notNull(),
    name: text("name").notNull(),
    /** registration, consumer/account number, or mobile number */
    identifier: text("identifier").notNull().default(""),
    provider: text("provider").notNull().default(""),
    planName: text("plan_name").notNull().default(""),
    details: text("details").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resources_user_kind_idx").on(t.userId, t.kind, t.name)],
);

export const mailboxProvider = pgEnum("mailbox_provider", ["google", "microsoft"]);
export const mailboxStatus = pgEnum("mailbox_status", ["active", "disconnected", "error"]);

/**
 * A connected mailbox. Holds the OAuth2 refresh token (encrypted at rest — no
 * password is ever stored) and the IMAP resume watermark so restarts never
 * reprocess mail. One row per mailbox the ingestor polls.
 */
export const mailboxAccounts = pgTable(
  "mailbox_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: mailboxProvider("provider").notNull(),
    emailAddress: text("email_address").notNull(),
    /** OAuth2 refresh token, encrypted with the app secret; minted into access tokens for XOAUTH2 */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    folder: text("folder").notNull().default("INBOX"),
    status: mailboxStatus("status").notNull().default("active"),
    lastError: text("last_error"),
    /** IMAP resume watermark: reprocess nothing at or below lastUid for this uidValidity */
    uidValidity: bigint("uid_validity", { mode: "number" }),
    lastUid: bigint("last_uid", { mode: "number" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mailbox_accounts_addr_idx").on(t.userId, t.emailAddress)],
);