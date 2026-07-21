import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { users } from "../db/schema.ts";

export type UserRow = typeof users.$inferSelect;

/** Owner accounts only — the seeded demo user never counts toward bootstrap. */
export async function countUsers(db: Db): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.isDemo, false));
  return rows[0]?.count ?? 0;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  return user ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  return user ?? null;
}

export async function createUser(
  db: Db,
  data: { email: string; passwordHash: string; displayName: string },
): Promise<UserRow> {
  const rows = await db.insert(users).values(data).returning();
  return rows[0]!;
}
