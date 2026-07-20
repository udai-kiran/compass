import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  CreateInsurancePolicy,
  InsurancePolicy,
  LogPremium,
  PolicyPremiums,
  UpdateInsurancePolicy,
} from "@compass/shared";
import {
  CreateInsurancePolicySchema,
  LogPremiumSchema,
  UpdateInsurancePolicySchema,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { insurancePolicies, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createTransaction } from "./transactions.ts";

type PolicyRow = typeof insurancePolicies.$inferSelect;

function toPolicy(p: PolicyRow): InsurancePolicy {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    vehicleType: p.vehicleType,
    insurer: p.insurer,
    policyNumber: p.policyNumber,
    sumAssuredPaise: p.sumAssuredPaise,
    bonusPaise: p.bonusPaise,
    premiumPaise: p.premiumPaise,
    premiumFrequency: p.premiumFrequency,
    startDate: p.startDate,
    renewalDate: p.renewalDate,
    maturityDate: p.maturityDate,
    nominee: p.nominee,
    notes: p.notes,
    archived: p.archivedAt !== null,
  };
}

async function ownedPolicy(db: Db, userId: string, id: string): Promise<PolicyRow> {
  const row = await db.query.insurancePolicies.findFirst({
    where: and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Policy not found");
  return row;
}

export async function listPolicies(db: Db, userId: string): Promise<InsurancePolicy[]> {
  const rows = await db.query.insurancePolicies.findMany({
    where: eq(insurancePolicies.userId, userId),
    orderBy: (p, { asc }) => [asc(p.archivedAt), asc(p.name)],
  });
  return rows.map(toPolicy);
}

export async function createPolicy(
  db: Db,
  userId: string,
  input: CreateInsurancePolicy,
): Promise<InsurancePolicy> {
  const parsed = CreateInsurancePolicySchema.parse(input);
  const rows = await db
    .insert(insurancePolicies)
    .values({ ...parsed, userId })
    .returning();
  return toPolicy(rows[0]!);
}

export async function updatePolicy(
  db: Db,
  userId: string,
  id: string,
  input: UpdateInsurancePolicy,
): Promise<InsurancePolicy> {
  await ownedPolicy(db, userId, id);
  const { archived, ...fields } = UpdateInsurancePolicySchema.parse(input);
  const rows = await db
    .update(insurancePolicies)
    .set({ ...fields, archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)))
    .returning();
  return toPolicy(rows[0]!);
}

export async function deletePolicy(db: Db, userId: string, id: string): Promise<void> {
  // Premium transactions FK policy_id with onDelete: set null, so deleting a
  // policy detaches its premiums (they stay in the ledger) rather than failing.
  const rows = await db
    .delete(insurancePolicies)
    .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)))
    .returning({ id: insurancePolicies.id });
  if (rows.length === 0) throw new HttpError(404, "Policy not found");
}

/** Every premium logged against a policy, newest first, with the total paid. */
export async function listPolicyPremiums(
  db: Db,
  userId: string,
  policyId: string,
): Promise<PolicyPremiums> {
  await ownedPolicy(db, userId, policyId);
  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.policyId, policyId),
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
  policyId: string,
  input: LogPremium,
): Promise<PolicyPremiums> {
  const policy = await ownedPolicy(db, userId, policyId);
  const parsed = LogPremiumSchema.parse(input);
  await createTransaction(db, userId, {
    accountId: parsed.fromAccountId,
    date: parsed.date,
    amountPaise: -parsed.amountPaise,
    merchant: policy.name,
    categoryId: null,
    notes: parsed.note,
    tags: [],
    policyId,
  });
  return listPolicyPremiums(db, userId, policyId);
}
