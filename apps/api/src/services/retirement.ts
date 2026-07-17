import { and, eq } from "drizzle-orm";
import type { RetirementDetails, UpsertRetirementDetails } from "@compass/shared";
import { isRetirementAccount, UpsertRetirementDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, retirementDetails } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type DetailsRow = typeof retirementDetails.$inferSelect;

function toDetails(d: DetailsRow): RetirementDetails {
  return {
    accountId: d.accountId,
    annualRateBps: d.annualRateBps,
    maturityDate: d.maturityDate,
    referenceNumber: d.referenceNumber,
    epsBalancePaise: d.epsBalancePaise,
  };
}

async function ownedRetirementAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (!isRetirementAccount(acc.type)) throw new HttpError(400, "Not a PPF, EPF or SSY account");
  return acc;
}

export async function getRetirementDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<RetirementDetails | null> {
  await ownedRetirementAccount(db, userId, accountId);
  const row = await db.query.retirementDetails.findFirst({
    where: and(
      eq(retirementDetails.accountId, accountId),
      eq(retirementDetails.userId, userId),
    ),
  });
  return row ? toDetails(row) : null;
}

export async function upsertRetirementDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertRetirementDetails,
): Promise<RetirementDetails> {
  const acc = await ownedRetirementAccount(db, userId, accountId);
  const parsed = UpsertRetirementDetailsSchema.parse(input);
  // EPF has no maturity — accepting one would render a date the scheme doesn't have.
  if (acc.type === "epf" && parsed.maturityDate !== null) {
    throw new HttpError(400, "EPF accounts do not mature");
  }
  // EPS is an EPF-only figure; never store one against PPF/SSY.
  const values = { ...parsed, epsBalancePaise: acc.type === "epf" ? parsed.epsBalancePaise : null };
  const rows = await db
    .insert(retirementDetails)
    .values({ ...values, accountId, userId })
    .onConflictDoUpdate({
      target: retirementDetails.accountId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}
