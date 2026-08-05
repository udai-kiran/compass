import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared identity leaf: tables that genuinely need a cycle-free home because the
 * schema-definition files that hold the real FK definitions — the `db/shared/*`
 * layers and each `modules/<domain>/schema.ts` — reference them via
 * `.references(() => users.id, ...)`. (`db/schema.ts` is now a pure re-export
 * barrel and holds no FK definitions itself.) Deliberately narrow — starts with
 * just `users` — and is NOT a general destination for every cross-module foreign
 * key; future cross-module FK targets get their own explicit ownership decision
 * in whichever Phase-1 task introduces them.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  /** the seeded, read-only demo account; excluded from the owner-bootstrap count */
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
