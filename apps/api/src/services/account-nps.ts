import { and, eq } from "drizzle-orm";
import type { AccountNpsDetails, UpsertAccountNpsDetails } from "@compass/shared";
import { UpsertAccountNpsDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accountNpsDetails, accounts } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type DetailsRow = typeof accountNpsDetails.$inferSelect;

function toDetails(row: DetailsRow): AccountNpsDetails {
  return {
    accountId: row.accountId,
    pran: row.pran,
    tier: row.tier,
    equityPct: row.equityPct,
    corporatePct: row.corporatePct,
    govtPct: row.govtPct,
  };
}

async function assertOwnedNpsAccount(db: Db, userId: string, accountId: string): Promise<void> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!account) throw new HttpError(404, "Account not found");
  if (account.type !== "nps") throw new HttpError(400, "Not an NPS account");
}

export async function getAccountNpsDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<AccountNpsDetails | null> {
  await assertOwnedNpsAccount(db, userId, accountId);
  const row = await db.query.accountNpsDetails.findFirst({
    where: and(eq(accountNpsDetails.accountId, accountId), eq(accountNpsDetails.userId, userId)),
  });
  return row ? toDetails(row) : null;
}

export async function upsertAccountNpsDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertAccountNpsDetails,
): Promise<AccountNpsDetails> {
  await assertOwnedNpsAccount(db, userId, accountId);
  const parsed = UpsertAccountNpsDetailsSchema.parse(input);
  const rows = await db
    .insert(accountNpsDetails)
    .values({ ...parsed, accountId, userId })
    .onConflictDoUpdate({
      target: accountNpsDetails.accountId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}
