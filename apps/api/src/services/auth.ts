import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { User } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { countUsers, createUser, findUserByEmail, findUserById, type UserRow } from "../repositories/users.ts";
import { seedDefaultCategories } from "./categories.ts";

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

/** First-run bootstrap: registration is only open while no user exists. */
export async function registerOwner(
  db: Db,
  input: { email: string; password: string; displayName: string },
): Promise<User> {
  if ((await countUsers(db)) > 0) {
    throw new HttpError(403, "An owner account already exists — log in instead");
  }
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const row = await createUser(db, {
    email: input.email.toLowerCase(),
    passwordHash,
    displayName: input.displayName,
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
