import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { User } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { users } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { findUserByEmail, findUserById, type UserRow } from "./users.ts";
import { seedDefaultCategories } from "../../ledger/services/categories.ts";
import { seedSystemAccounts } from "../../ledger/services/post-entry.ts";

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.displayName, isDemo: row.isDemo };
}

/** True when an error is a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return pgError(err)?.code === "23505";
}

/**
 * Self-service registration: create a new user and seed their default categories.
 *
 * Open to anyone by default (gated by config.SIGNUP_ENABLED at the route). Email
 * uniqueness is enforced by the `users.email` UNIQUE constraint, which also makes
 * two concurrent registrations of the same address safe — one wins, the other
 * hits the unique violation and is rejected as a 409. Data isolation is by
 * user_id across every table, so a new account only ever sees its own rows.
 */
export async function registerUser(
  db: Db,
  input: { email: string; password: string; displayName: string },
): Promise<User> {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  // Insert and seeding share one transaction: if category seeding fails, the user
  // row is rolled back too, so registration never leaves a half-created account
  // (which would then 409 on retry and never get default categories).
  let row: UserRow;
  try {
    row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ email: input.email.toLowerCase(), passwordHash, displayName: input.displayName })
        .returning();
      const created = inserted[0]!;
      await seedDefaultCategories(tx, created.id);
      await seedSystemAccounts(tx, created.id);
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "An account with this email already exists — log in instead");
    }
    throw err;
  }
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
