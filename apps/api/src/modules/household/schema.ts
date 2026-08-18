/**
 * household module — defines 3 resident tables + 1 resident enum for
 * multi-user household/family sharing. Imports `users` from core-schema.ts
 * as the FK target. No cross-module schema imports.
 */

import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";
import { familyMembers } from "../../db/shared/persons.ts";
import { transactions } from "../../db/shared/ledger.ts";

export const householdRole = pgEnum("household_role", ["owner", "member"]);

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: householdRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("household_members_unique_idx").on(t.householdId, t.userId),
    index("household_members_user_idx").on(t.userId),
  ],
);

export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_invites_token_idx").on(t.token)],
);

export const sharingResourceType = pgEnum("sharing_resource_type", [
  "account",
  "goal",
  "holding",
  "insurance_policy",
  "budget",
]);

export const sharingGrants = pgTable(
  "sharing_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceType: sharingResourceType("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    grantedToUserId: uuid("granted_to_user_id")
      .notNull()
      .references(() => users.id),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sharing_grants_resource_grantee_idx").on(t.resourceType, t.resourceId, t.grantedToUserId),
    index("sharing_grants_grantee_idx").on(t.grantedToUserId),
    index("sharing_grants_owner_idx").on(t.ownerUserId),
  ],
);

export const splitRule = pgEnum("split_rule", ["equal", "shares", "exact"]);

export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .unique()
    .references(() => transactions.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  rule: splitRule("rule").notNull(),
  payerPersonId: uuid("payer_person_id")
    .notNull()
    .references(() => familyMembers.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const splitShares = pgTable(
  "split_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    splitId: uuid("split_id")
      .notNull()
      .references(() => splits.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    sharePaise: bigint("share_paise", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("split_shares_split_idx").on(t.splitId)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    transferTransactionId: uuid("transfer_transaction_id")
      .references(() => transactions.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settlements_household_idx").on(t.householdId)],
);
