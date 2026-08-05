import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../core-schema.ts";
import { categories, resources } from "./foundation.ts";
import { accounts } from "./hubs.ts";

export const recurringFrequency = pgEnum("recurring_frequency", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const recurringKind = pgEnum("recurring_kind", [
  "none",
  "bill",
  "subscription",
  "insurance",
  "emi",
]);

export const recurringTemplates = pgTable(
  "recurring_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    merchant: text("merchant").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    notes: text("notes").notNull().default(""),
    frequency: recurringFrequency("frequency").notNull(),
    interval: integer("interval").notNull().default(1),
    nextDueDate: date("next_due_date").notNull(),
    endDate: date("end_date"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** bill/subscription/insurance/EMI typing for the Bills view; none = plain recurring */
    kind: recurringKind("kind").notNull().default("none"),
    /** reminder lead days; null = per-kind default (3, annual 14) */
    remindDays: integer("remind_days"),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recurring_templates_user_idx").on(t.userId, t.nextDueDate)],
);