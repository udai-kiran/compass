import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/index.ts";
import { accounts, categories, goals } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

/**
 * A foreign key proves a row exists, not that the caller owns it. Once more than
 * one user exists, an unchecked account/category/goal id on a write lets a caller
 * attach their data to — or leak a name out of — another user's row (balances and
 * rollups then aggregate across the ownership boundary). Every service that
 * accepts a client-supplied foreign key validates it through these guards.
 *
 * Each guard treats null/undefined as "no reference" / "leave as-is" and does
 * nothing, so callers can pass an optional field straight through.
 */

export async function assertOwnedAccount(
  db: DbOrTx,
  userId: string,
  accountId: string | null | undefined,
): Promise<void> {
  if (!accountId) return;
  const row = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Account not found");
}

export async function assertOwnedCategory(
  db: DbOrTx,
  userId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (!categoryId) return;
  const row = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Category not found");
}

export async function assertOwnedGoal(
  db: DbOrTx,
  userId: string,
  goalId: string | null | undefined,
): Promise<void> {
  if (!goalId) return;
  const row = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.userId, userId)),
    columns: { id: true },
  });
  if (!row) throw new HttpError(404, "Goal not found");
}
