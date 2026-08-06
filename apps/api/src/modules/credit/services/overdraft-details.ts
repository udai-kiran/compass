import { and, eq } from "drizzle-orm";
import type { OverdraftDetails, UpsertOverdraftDetails } from "@compass/shared";
import { isOverdraftAccount, UpsertOverdraftDetailsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts } from "../../../db/schema.ts";
import { overdraftDetails } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";

type DetailsRow = typeof overdraftDetails.$inferSelect;

function toDetails(d: DetailsRow): OverdraftDetails {
  return {
    accountId: d.accountId,
    sanctionedLimitPaise: d.sanctionedLimitPaise,
    annualRateBps: d.annualRateBps,
  };
}

async function ownedOverdraftAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (!isOverdraftAccount(assertPublicAccountType(acc.type))) {
    throw new HttpError(400, "Not an overdraft loan account");
  }
  return acc;
}

export async function getOverdraftDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<OverdraftDetails | null> {
  await ownedOverdraftAccount(db, userId, accountId);
  const row = await db.query.overdraftDetails.findFirst({
    where: and(eq(overdraftDetails.accountId, accountId), eq(overdraftDetails.userId, userId)),
  });
  return row ? toDetails(row) : null;
}

export async function upsertOverdraftDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertOverdraftDetails,
): Promise<OverdraftDetails> {
  await ownedOverdraftAccount(db, userId, accountId);
  const parsed = UpsertOverdraftDetailsSchema.parse(input);

  const rows = await db
    .insert(overdraftDetails)
    .values({ ...parsed, accountId, userId })
    .onConflictDoUpdate({
      target: overdraftDetails.accountId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}
