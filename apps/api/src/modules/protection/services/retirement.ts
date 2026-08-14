import { and, eq } from "drizzle-orm";
import type { RetirementDetails, UpsertRetirementDetails } from "@compass/shared";
import { isRetirementAccount, UpsertRetirementDetailsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { retirementDetails } from "../schema.ts";
import { accounts } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";

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
  if (!isRetirementAccount(assertPublicAccountType(acc.type))) {
    throw new HttpError(400, "Not a PPF, EPF or SSY account");
  }
  return acc;
}

export async function getRetirementDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<RetirementDetails | null> {
  const acc = await ownedRetirementAccount(db, userId, accountId);
  const row = await db.query.retirementDetails.findFirst({
    where: and(
      eq(retirementDetails.accountId, accountId),
      eq(retirementDetails.userId, userId),
    ),
  });
  if (!row) return null;
  const details = toDetails(row);
  // Defense in depth: never surface a value the type can't hold, even if a row
  // went stale. EPS is EPF-only; EPF has no maturity date.
  if (acc.type !== "epf") details.epsBalancePaise = null;
  if (acc.type === "epf") details.maturityDate = null;
  return details;
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
  if (acc.type === "epf" && parsed.maturityDate !== null && parsed.maturityDate !== undefined) {
    throw new HttpError(400, "EPF accounts do not mature");
  }
  // Merge with existing DB row so omitted fields preserve their current values.
  const [existing] = await db.select().from(retirementDetails).where(eq(retirementDetails.accountId, accountId));
  const isEpf = acc.type === "epf";
  const merged = {
    annualRateBps: parsed.annualRateBps !== undefined ? parsed.annualRateBps : (existing?.annualRateBps ?? 0),
    maturityDate: parsed.maturityDate !== undefined ? parsed.maturityDate : (existing?.maturityDate ?? null),
    referenceNumber: parsed.referenceNumber !== undefined ? parsed.referenceNumber : (existing?.referenceNumber ?? ""),
    epsBalancePaise: isEpf
      ? (parsed.epsBalancePaise !== undefined ? parsed.epsBalancePaise : (existing?.epsBalancePaise ?? null))
      : null,
  };
  const rows = await db
    .insert(retirementDetails)
    .values({ ...merged, accountId, userId })
    .onConflictDoUpdate({
      target: retirementDetails.accountId,
      set: { ...merged, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}
