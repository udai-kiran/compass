import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  InsuranceDetails,
  LogPremium,
  PolicyPremiums,
  UpsertInsuranceDetails,
} from "@compass/shared";
import {
  isInsuranceAccount,
  LogPremiumSchema,
  UpsertInsuranceDetailsSchema,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, insuranceDetails, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createTransaction } from "./transactions.ts";

type DetailsRow = typeof insuranceDetails.$inferSelect;

function toDetails(d: DetailsRow): InsuranceDetails {
  return {
    accountId: d.accountId,
    kind: d.kind,
    vehicleType: d.vehicleType,
    policyNumber: d.policyNumber,
    coverPaise: d.coverPaise,
    premiumPaise: d.premiumPaise,
    premiumFrequency: d.premiumFrequency,
    startDate: d.startDate,
    renewalDate: d.renewalDate,
    maturityDate: d.maturityDate,
    nominee: d.nominee,
  };
}

async function ownedPolicyAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (!isInsuranceAccount(acc.type)) throw new HttpError(400, "Not an insurance account");
  return acc;
}

export async function getInsuranceDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<InsuranceDetails | null> {
  await ownedPolicyAccount(db, userId, accountId);
  const row = await db.query.insuranceDetails.findFirst({
    where: and(eq(insuranceDetails.accountId, accountId), eq(insuranceDetails.userId, userId)),
  });
  return row ? toDetails(row) : null;
}

export async function upsertInsuranceDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertInsuranceDetails,
): Promise<InsuranceDetails> {
  await ownedPolicyAccount(db, userId, accountId);
  const parsed = UpsertInsuranceDetailsSchema.parse(input);

  const rows = await db
    .insert(insuranceDetails)
    .values({ ...parsed, accountId, userId })
    .onConflictDoUpdate({
      target: insuranceDetails.accountId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}

/** Every premium logged against a policy, newest first, with the total paid. */
export async function listPolicyPremiums(
  db: Db,
  userId: string,
  accountId: string,
): Promise<PolicyPremiums> {
  await ownedPolicyAccount(db, userId, accountId);
  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.policyAccountId, accountId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
    orderBy: [desc(transactions.date), desc(transactions.id)],
  });
  const items = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountPaise: r.amountPaise,
    merchant: r.merchant,
    accountId: r.accountId,
    note: r.notes,
  }));
  const totalPaise = items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
  return { items, totalPaise, count: items.length };
}

/**
 * Log a premium payment: a real expense on the paying account, tagged to the
 * policy so it shows in the policy's premium history. The amount is a positive
 * magnitude on the wire; stored negative (an outflow) like any expense.
 */
export async function logPremium(
  db: Db,
  userId: string,
  accountId: string,
  input: LogPremium,
): Promise<PolicyPremiums> {
  const policy = await ownedPolicyAccount(db, userId, accountId);
  const parsed = LogPremiumSchema.parse(input);
  if (parsed.fromAccountId === accountId) {
    throw new HttpError(400, "A premium is paid from a bank/card account, not the policy itself");
  }
  await createTransaction(db, userId, {
    accountId: parsed.fromAccountId,
    date: parsed.date,
    amountPaise: -parsed.amountPaise,
    merchant: policy.name,
    categoryId: null,
    notes: parsed.note,
    tags: [],
    policyAccountId: accountId,
  });
  return listPolicyPremiums(db, userId, accountId);
}
