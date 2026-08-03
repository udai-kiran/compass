import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";

/** Per-user assumptions used only for forward-looking goal projections. */
export const projectionSettings = pgTable("projection_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Broad-equity annual return assumption (1200 = 12%). */
  equityReturnBps: integer("equity_return_bps").notNull().default(1200),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
