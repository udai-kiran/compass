import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import type { User } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { countUsers, findUserByEmail, findUserById, type UserRow } from "../repositories/users.ts";
import { seedDefaultCategories } from "./categories.ts";

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

/**
 * A fixed key for the transaction-scoped advisory lock that serializes owner
 * bootstrap. Any constant works; it only has to be the same across callers.
 */
const OWNER_BOOTSTRAP_LOCK = 0x50656e6e79; // "Penny"

/**
 * First-run bootstrap: registration is only open while no user exists.
 *
 * The count-then-insert is a check-then-act race — two concurrent first-run
 * requests could both see zero users and both create an owner. A transaction-
 * scoped advisory lock serializes them: the loser re-reads the count under the
 * lock, now sees the owner, and is rejected. The lock releases at commit. The
 * password hash is computed before the lock so argon2 (hundreds of ms) never
 * holds it; on the rare lost race that hash is simply discarded.
 */
export async function registerOwner(
  db: Db,
  input: { email: string; password: string; displayName: string },
): Promise<User> {
  if ((await countUsers(db)) > 0) {
    throw new HttpError(403, "An owner account already exists — log in instead");
  }
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  // The count + insert run on one connection under the advisory lock so the
  // check-then-act is atomic against a concurrent first-run request. Default
  // categories are seeded after commit (best-effort, as before) — the invariant
  // that must hold under contention is "exactly one owner row", nothing else.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${OWNER_BOOTSTRAP_LOCK})`);
    const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
    if ((existing?.count ?? 0) > 0) {
      throw new HttpError(403, "An owner account already exists — log in instead");
    }
    const inserted = await tx
      .insert(users)
      .values({ email: input.email.toLowerCase(), passwordHash, displayName: input.displayName })
      .returning();
    return inserted[0]!;
  });
  await seedDefaultCategories(db, row.id);
  return toUser(row);
}

export async function verifyLogin(db: Db, email: string, password: string): Promise<User | null> {
  const row = await findUserByEmail(db, email.toLowerCase());
  if (!row) return null;
  const valid = await argon2.verify(row.passwordHash, password);
  return valid ? toUser(row) : null;
}

export async function updateProfile(db: Db, userId: string, displayName: string): Promise<User> {
  const rows = await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "User not found");
  return toUser(rows[0]!);
}

export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await findUserById(db, userId);
  if (!row) throw new HttpError(404, "User not found");
  if (!(await argon2.verify(row.passwordHash, currentPassword))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}
