import { eq, or, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Central sharing guard. Returns a SQL condition: owned by me OR shared to me.
 *
 * Usage in a service:
 *   const rows = await db.select().from(accounts)
 *     .where(and(withSharing(userId, accounts.userId, accounts.id, "account"), ...));
 */
export function withSharing(
  userId: string,
  userIdCol: PgColumn,
  idCol: PgColumn,
  resourceType: string,
): SQL {
  return or(
    eq(userIdCol, userId),
    inArray(
      idCol,
      sql`(SELECT resource_id FROM sharing_grants WHERE resource_type = ${resourceType} AND granted_to_user_id = ${userId})`,
    ),
  )!;
}
