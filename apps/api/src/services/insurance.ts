import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type {
  CreateInsurancePolicy,
  HealthCard,
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
import { insuranceHealthCards, insurancePolicies, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import type { Storage } from "../lib/storage.ts";
import { assertUploadable } from "./attachments.ts";
import { createTransaction } from "./transactions.ts";

type PolicyRow = typeof insurancePolicies.$inferSelect;
type HealthCardRow = typeof insuranceHealthCards.$inferSelect;

function toHealthCard(c: HealthCardRow): HealthCard {
  return { id: c.id, label: c.label, fileName: c.fileName, mimeType: c.mimeType, sizeBytes: c.sizeBytes };
}

function toPolicy(p: PolicyRow, cards: HealthCardRow[] = []): InsurancePolicy {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    vehicleType: p.vehicleType,
    vehicleRegNo: p.vehicleRegNo,
    healthType: p.healthType,
    insurer: p.insurer,
    policyNumber: p.policyNumber,
    policyWordingUrl: p.policyWordingUrl,
    sumAssuredPaise: p.sumAssuredPaise,
    bonusPaise: p.bonusPaise,
    premiumPaise: p.premiumPaise,
    premiumFrequency: p.premiumFrequency,
    startDate: p.startDate,
    renewalDate: p.renewalDate,
    maturityDate: p.maturityDate,
    nominee: p.nominee,
    coveredMembers: p.coveredMembers,
    documentName: p.documentName,
    documentMime: p.documentMime,
    documentSizeBytes: p.documentSizeBytes,
    healthCards: cards.map(toHealthCard),
    notes: p.notes,
    archived: p.archivedAt !== null,
  };
}

/** A single policy with its health cards, for endpoints that return one policy. */
async function getPolicyWithCards(db: Db, userId: string, id: string): Promise<InsurancePolicy> {
  const row = await ownedPolicy(db, userId, id);
  const cards = await db.query.insuranceHealthCards.findMany({
    where: eq(insuranceHealthCards.policyId, id),
    orderBy: (c, { asc }) => [asc(c.createdAt)],
  });
  return toPolicy(row, cards);
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
  const cards = rows.length
    ? await db.query.insuranceHealthCards.findMany({
        where: inArray(
          insuranceHealthCards.policyId,
          rows.map((r) => r.id),
        ),
        orderBy: (c, { asc }) => [asc(c.createdAt)],
      })
    : [];
  const byPolicy = new Map<string, HealthCardRow[]>();
  for (const c of cards) {
    const list = byPolicy.get(c.policyId) ?? [];
    list.push(c);
    byPolicy.set(c.policyId, list);
  }
  return rows.map((r) => toPolicy(r, byPolicy.get(r.id) ?? []));
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
  await db
    .update(insurancePolicies)
    .set({ ...fields, archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)));
  return getPolicyWithCards(db, userId, id);
}

export async function deletePolicy(
  db: Db,
  userId: string,
  id: string,
  storage: Storage,
): Promise<void> {
  // Grab the stored file keys before the row (and its cascaded cards) vanish.
  const cards = await db.query.insuranceHealthCards.findMany({
    where: and(eq(insuranceHealthCards.policyId, id), eq(insuranceHealthCards.userId, userId)),
    columns: { storedPath: true },
  });
  // Premium transactions FK policy_id with onDelete: set null, so deleting a
  // policy detaches its premiums (they stay in the ledger) rather than failing.
  const rows = await db
    .delete(insurancePolicies)
    .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)))
    .returning({ id: insurancePolicies.id, documentPath: insurancePolicies.documentPath });
  if (rows.length === 0) throw new HttpError(404, "Policy not found");
  // Best-effort cleanup of the uploaded files (document + health cards).
  const keys = [rows[0]!.documentPath, ...cards.map((c) => c.storedPath)].filter(
    (k): k is string => !!k,
  );
  await Promise.all(keys.map((k) => storage.delete(k).catch(() => {})));
}

// ---------- Policy document (single uploaded file per policy) ----------

/** Upload (or replace) the policy's document. */
export async function savePolicyDocument(
  db: Db,
  storage: Storage,
  userId: string,
  policyId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
): Promise<InsurancePolicy> {
  const policy = await ownedPolicy(db, userId, policyId);
  assertUploadable(file);
  const storedPath = await storage.put(file.data, file.mimeType);
  if (policy.documentPath) await storage.delete(policy.documentPath).catch(() => {}); // replace
  await db
    .update(insurancePolicies)
    .set({
      documentPath: storedPath,
      documentName: file.fileName,
      documentMime: file.mimeType,
      documentSizeBytes: file.data.byteLength,
      updatedAt: new Date(),
    })
    .where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)));
  return getPolicyWithCards(db, userId, policyId);
}

export async function readPolicyDocument(
  db: Db,
  storage: Storage,
  userId: string,
  policyId: string,
): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const policy = await ownedPolicy(db, userId, policyId);
  if (!policy.documentPath) throw new HttpError(404, "No document uploaded");
  const data = await storage.get(policy.documentPath);
  return {
    fileName: policy.documentName ?? "policy",
    mimeType: policy.documentMime ?? "application/octet-stream",
    data,
  };
}

export async function deletePolicyDocument(
  db: Db,
  storage: Storage,
  userId: string,
  policyId: string,
): Promise<InsurancePolicy> {
  const policy = await ownedPolicy(db, userId, policyId);
  if (policy.documentPath) await storage.delete(policy.documentPath).catch(() => {});
  await db
    .update(insurancePolicies)
    .set({
      documentPath: null,
      documentName: null,
      documentMime: null,
      documentSizeBytes: null,
      updatedAt: new Date(),
    })
    .where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.userId, userId)));
  return getPolicyWithCards(db, userId, policyId);
}

// ---------- Health cards (multiple uploaded files per policy) ----------

export async function addHealthCard(
  db: Db,
  storage: Storage,
  userId: string,
  policyId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
  label: string,
): Promise<InsurancePolicy> {
  await ownedPolicy(db, userId, policyId);
  assertUploadable(file);
  const storedPath = await storage.put(file.data, file.mimeType);
  await db.insert(insuranceHealthCards).values({
    policyId,
    userId,
    label: label.trim().slice(0, 120),
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.data.byteLength,
    storedPath,
  });
  return getPolicyWithCards(db, userId, policyId);
}

export async function readHealthCard(
  db: Db,
  storage: Storage,
  userId: string,
  cardId: string,
): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const card = await db.query.insuranceHealthCards.findFirst({
    where: and(eq(insuranceHealthCards.id, cardId), eq(insuranceHealthCards.userId, userId)),
  });
  if (!card) throw new HttpError(404, "Health card not found");
  const data = await storage.get(card.storedPath);
  return { fileName: card.fileName, mimeType: card.mimeType, data };
}

export async function deleteHealthCard(
  db: Db,
  storage: Storage,
  userId: string,
  policyId: string,
  cardId: string,
): Promise<InsurancePolicy> {
  await ownedPolicy(db, userId, policyId);
  const rows = await db
    .delete(insuranceHealthCards)
    .where(
      and(
        eq(insuranceHealthCards.id, cardId),
        eq(insuranceHealthCards.policyId, policyId),
        eq(insuranceHealthCards.userId, userId),
      ),
    )
    .returning({ storedPath: insuranceHealthCards.storedPath });
  if (rows.length === 0) throw new HttpError(404, "Health card not found");
  await storage.delete(rows[0]!.storedPath).catch(() => {});
  return getPolicyWithCards(db, userId, policyId);
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
