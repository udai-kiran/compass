import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type {
  CreateInsurancePolicy,
  HealthCard,
  InsuranceAdequacyReport,
  InsurancePolicy,
  LogPremium,
  PolicyPremiums,
  SubLimit,
  UpdateInsurancePolicy,
} from "@compass/shared";
import {
  CreateInsurancePolicySchema,
  LogPremiumSchema,
  todayInIST,
  UpdateInsurancePolicySchema,
} from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { insuranceHealthCards, insurancePolicies, policyCoveredPersons } from "../schema.ts";
import { accounts, postings, transactions } from "../../../db/schema.ts";
import { familyMembers } from "../../../db/shared/persons.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { Storage } from "../../../lib/storage.ts";
import { assertUploadable } from "../../ledger/services/attachments.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { assertOwnedResource } from "../../ledger/services/resources.ts";
import { computeClaimReadiness, computeWaitingPeriodEndDates } from "./claim-readiness.ts";
import { getIncomeSurplus } from "../../planning/services/income-surplus.ts";
import { computeInsuranceAdequacy } from "./insurance-adequacy.ts";

type PolicyRow = typeof insurancePolicies.$inferSelect;
type HealthCardRow = typeof insuranceHealthCards.$inferSelect;

function toHealthCard(c: HealthCardRow): HealthCard {
  return { id: c.id, label: c.label, fileName: c.fileName, mimeType: c.mimeType, sizeBytes: c.sizeBytes };
}

function toPolicy(
  p: PolicyRow,
  cards: HealthCardRow[] = [],
  coveredPersonIds: string[] = [],
  today: string = todayInIST(),
): InsurancePolicy {
  const waitingEndDates = computeWaitingPeriodEndDates({
    startDate: p.startDate,
    initialWaitingDays: p.initialWaitingDays,
    preExistingWaitingMonths: p.preExistingWaitingMonths,
    maternityWaitingMonths: p.maternityWaitingMonths,
  });
  const claimReadiness = computeClaimReadiness({
    kind: p.kind,
    today,
    hasDocument: p.documentPath !== null,
    healthCardCount: cards.length,
    tpaName: p.tpaName,
    tpaContactPhone: p.tpaContactPhone,
    renewalDate: p.renewalDate,
    premiumFrequency: p.premiumFrequency,
    disclosuresComplete: p.disclosuresComplete,
    nominee: p.nominee,
    nomineePersonId: p.nomineePersonId ?? null,
    initialWaitingDays: p.initialWaitingDays,
    preExistingWaitingMonths: p.preExistingWaitingMonths,
    maternityWaitingMonths: p.maternityWaitingMonths,
    waitingEndDates,
  });
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    vehicleType: p.vehicleType,
    vehicleRegNo: p.vehicleRegNo,
    resourceId: p.resourceId,
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
    nomineePersonId: p.nomineePersonId ?? null,
    coveredMembers: p.coveredMembers,
    coveredPersonIds,
    ownership: p.ownership,
    employerName: p.employerName,
    deductiblePaise: p.deductiblePaise,
    coPayBps: p.coPayBps,
    roomRentLimitPaise: p.roomRentLimitPaise,
    roomRentLimitBps: p.roomRentLimitBps,
    icuLimitPaise: p.icuLimitPaise,
    icuLimitBps: p.icuLimitBps,
    subLimits: p.subLimits as SubLimit[],
    initialWaitingDays: p.initialWaitingDays,
    preExistingWaitingMonths: p.preExistingWaitingMonths,
    maternityWaitingMonths: p.maternityWaitingMonths,
    initialWaitingEndDate: waitingEndDates.initialWaitingEndDate,
    preExistingWaitingEndDate: waitingEndDates.preExistingWaitingEndDate,
    maternityWaitingEndDate: waitingEndDates.maternityWaitingEndDate,
    restorationBenefit: p.restorationBenefit,
    ncbBps: p.ncbBps,
    ncbMaxBps: p.ncbMaxBps,
    tpaName: p.tpaName,
    tpaContactPhone: p.tpaContactPhone,
    exclusions: p.exclusions,
    disclosuresComplete: p.disclosuresComplete,
    claimReadiness,
    documentName: p.documentName,
    documentMime: p.documentMime,
    documentSizeBytes: p.documentSizeBytes,
    healthCards: cards.map(toHealthCard),
    notes: p.notes,
    archived: p.archivedAt !== null,
  };
}

/**
 * Validate that all personIds belong to the user's family_members, then
 * atomically replace the policy's covered-person links (delete old, insert new).
 * Must be called inside an existing transaction.
 */
async function replaceCoveredPersons(
  db: DbOrTx,
  userId: string,
  policyId: string,
  personIds: string[],
): Promise<void> {
  if (personIds.length > 0) {
    // Batch-validate all IDs in one query — never loop queries.
    const found = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.userId, userId),
          inArray(familyMembers.id, personIds),
        ),
      );
    const foundIds = new Set(found.map((r) => r.id));
    for (const id of personIds) {
      if (!foundIds.has(id)) {
        throw new HttpError(400, `Unknown family member: ${id}`);
      }
    }
  }
  // Delete existing covered persons, then bulk-insert new ones.
  await db.delete(policyCoveredPersons).where(eq(policyCoveredPersons.policyId, policyId));
  if (personIds.length > 0) {
    await db
      .insert(policyCoveredPersons)
      .values(personIds.map((personId) => ({ policyId, personId })));
  }
}

/** A single policy with its health cards and covered-person IDs, for single-policy endpoints. */
async function getPolicyWithCards(db: Db, userId: string, id: string): Promise<InsurancePolicy> {
  const row = await ownedPolicy(db, userId, id);
  const cards = await db.query.insuranceHealthCards.findMany({
    where: eq(insuranceHealthCards.policyId, id),
    orderBy: (c, { asc }) => [asc(c.createdAt)],
  });
  const coveredPersonRows = await db
    .select({ personId: policyCoveredPersons.personId })
    .from(policyCoveredPersons)
    .where(eq(policyCoveredPersons.policyId, id));
  const coveredPersonIds = coveredPersonRows.map((r) => r.personId);
  return toPolicy(row, cards, coveredPersonIds);
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
  if (rows.length === 0) return [];
  const policyIds = rows.map((r) => r.id);
  const [cards, coveredPersonsRows] = await Promise.all([
    db.query.insuranceHealthCards.findMany({
      where: inArray(insuranceHealthCards.policyId, policyIds),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    }),
    db
      .select({ policyId: policyCoveredPersons.policyId, personId: policyCoveredPersons.personId })
      .from(policyCoveredPersons)
      .where(inArray(policyCoveredPersons.policyId, policyIds)),
  ]);
  const byPolicy = new Map<string, HealthCardRow[]>();
  for (const c of cards) {
    const list = byPolicy.get(c.policyId) ?? [];
    list.push(c);
    byPolicy.set(c.policyId, list);
  }
  const byCoveredPolicy = new Map<string, string[]>();
  for (const cp of coveredPersonsRows) {
    const list = byCoveredPolicy.get(cp.policyId) ?? [];
    list.push(cp.personId);
    byCoveredPolicy.set(cp.policyId, list);
  }
  const today = todayInIST();
  return rows.map((r) =>
    toPolicy(r, byPolicy.get(r.id) ?? [], byCoveredPolicy.get(r.id) ?? [], today),
  );
}

export async function createPolicy(
  db: Db,
  userId: string,
  input: CreateInsurancePolicy,
): Promise<InsurancePolicy> {
  const parsed = CreateInsurancePolicySchema.parse(input);
  await assertOwnedResource(db, userId, parsed.resourceId);
  const { coveredPersonIds, ...policyFields } = parsed;
  const policyId = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(insurancePolicies)
      .values({ ...policyFields, userId })
      .returning({ id: insurancePolicies.id });
    const id = rows[0]!.id;
    await replaceCoveredPersons(tx, userId, id, coveredPersonIds ?? []);
    return id;
  });
  return getPolicyWithCards(db, userId, policyId);
}

/**
 * Health-only fields, reset to their empty value. Applied whenever the
 * policy's *effective* kind (this request's, or the existing row's if this
 * request doesn't touch `kind`) isn't "health" — so a value set while the
 * policy was health-kind can never linger as a stale leftover after it's
 * edited to life/vehicle, even if that same request doesn't mention these
 * fields at all (the Zod schema alone can't catch that case — see
 * checkPolicyConsistency's comment in packages/shared).
 */
const HEALTH_ONLY_RESET: Record<string, unknown> = {
  deductiblePaise: null,
  coPayBps: null,
  roomRentLimitPaise: null,
  roomRentLimitBps: null,
  icuLimitPaise: null,
  icuLimitBps: null,
  subLimits: [] as SubLimit[],
  initialWaitingDays: null,
  preExistingWaitingMonths: null,
  maternityWaitingMonths: null,
  restorationBenefit: false,
  ncbBps: 0,
  ncbMaxBps: 0,
  tpaName: "",
  tpaContactPhone: "",
};

export async function updatePolicy(
  db: Db,
  userId: string,
  id: string,
  input: UpdateInsurancePolicy,
): Promise<InsurancePolicy> {
  const existing = await ownedPolicy(db, userId, id);
  const { archived, coveredPersonIds, ...parsedFields } = UpdateInsurancePolicySchema.parse(input);
  await assertOwnedResource(db, userId, parsedFields.resourceId);

  // Omitted structured-term fields mean "leave unchanged" (see the schema's
  // doc comment) — drop the `undefined` entries so they never reach the SQL
  // SET clause, rather than relying on driver-specific undefined handling.
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsedFields)) {
    if (v !== undefined) fields[k] = v;
  }

  // Force-clear health-only fields / employerName once the *effective*
  // kind/ownership (this request's, else the existing row's) rules them out
  // — closes the gap a same-request kind/ownership change would otherwise
  // leave: a caller resending old health terms while switching to "life",
  // or omitting them entirely and having them silently persist.
  const effectiveKind = fields.kind ?? existing.kind;
  if (effectiveKind !== "health") {
    Object.assign(fields, HEALTH_ONLY_RESET);
  }
  const effectiveOwnership = fields.ownership ?? existing.ownership;
  if (effectiveOwnership !== "employer") {
    fields.employerName = "";
  }

  await db.transaction(async (tx) => {
    await tx
      .update(insurancePolicies)
      .set({ ...fields, archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)));
    if (coveredPersonIds !== undefined) {
      await replaceCoveredPersons(tx, userId, id, coveredPersonIds);
    }
  });
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
  // policyCoveredPersons FKs policy_id with onDelete: cascade, so covered
  // persons are removed automatically.
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
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountPaise: postings.amountPaise,
      merchant: transactions.merchant,
      accountId: postings.accountId,
      note: transactions.notes,
    })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), isNull(accounts.systemKind)))
    .where(
      and(
        eq(transactions.policyId, policyId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.id));
  const items = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountPaise: r.amountPaise,
    merchant: r.merchant,
    accountId: r.accountId,
    note: r.note,
  }));
  const totalPaise = items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
  return { items, totalPaise, count: items.length };
}

/**
 * Sum of premiums paid for a policy within a date range (inclusive). Excludes
 * soft-deleted transactions and system accounts (opening balance legs). Used by
 * the deduction basket to compute actual premiums paid in a financial year.
 */
export async function sumPolicyPremiumsInRange(
  db: DbOrTx,
  userId: string,
  policyId: string,
  fyStart: string,
  fyEnd: string,
): Promise<{ totalPaise: number; count: number }> {
  const rows = await db
    .select({
      totalPaise: sql<number>`coalesce(sum(abs(${postings.amountPaise})), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .innerJoin(accounts, and(eq(accounts.id, postings.accountId), isNull(accounts.systemKind)))
    .where(
      and(
        eq(transactions.policyId, policyId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.date, fyStart),
        lte(transactions.date, fyEnd),
      ),
    );
  const row = rows[0];
  return {
    totalPaise: row?.totalPaise ?? 0,
    count: row?.count ?? 0,
  };
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
    resourceId: policy.resourceId,
  });
  return listPolicyPremiums(db, userId, policyId);
}

/**
 * Compute the insurance adequacy report for a user.
 * Gathers income, family members, account balances, and policies from the DB,
 * then delegates to the pure computeInsuranceAdequacy function.
 */
export async function getAdequacyReport(
  db: Db,
  userId: string,
  assumptions: {
    incomeReplacementYears: number;
    medicalInflationBps: number;
    healthProjectionYears: number;
  },
): Promise<InsuranceAdequacyReport> {
  const today = todayInIST();

  // Fetch income data from the last 12 months of ledger history
  const incomeSurplus = await getIncomeSurplus(db, userId, 12);

  // Compute annual income: median of non-bonus months × 12
  let annualIncomePaise: number | null = null;
  if (incomeSurplus.historyMonths >= 3) {
    const nonBonusMonths = incomeSurplus.months.filter((m) => !m.likelyBonus);
    if (nonBonusMonths.length > 0) {
      // Use the total surplus + committed outflows to recover median income
      // Simpler: sum all non-bonus income, divide by count, multiply by 12
      const totalNonBonus = nonBonusMonths.reduce((s, m) => s + m.incomePaise, 0);
      const meanMonthlyIncome = totalNonBonus / nonBonusMonths.length;
      annualIncomePaise = Math.round(meanMonthlyIncome * 12);
    }
  }

  // Fetch family members
  const members = await db
    .select({
      id: familyMembers.id,
      name: familyMembers.name,
      relationship: familyMembers.relationship,
      dateOfBirth: familyMembers.dateOfBirth,
      educationStage: familyMembers.educationStage,
    })
    .from(familyMembers)
    .where(eq(familyMembers.userId, userId));

  // Fetch account balances for liquid assets and liabilities
  const accountBalanceRows = await db.execute(sql`
    select a.type,
           coalesce(p.total, 0)::bigint as posting_total
    from accounts a
    left join (
      select po.account_id, sum(po.amount_paise) as total
      from postings po
      join transactions t on t.id = po.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${today}
      group by po.account_id
    ) p on p.account_id = a.id
    where a.user_id = ${userId}
      and a.archived_at is null
      and a.system_kind is null
      and a.type in ('bank', 'cash', 'investment', 'loan', 'home_loan_od', 'overdraft', 'credit_card')
  `);

  let liquidAssetsPaise = 0;
  let outstandingLiabilitiesPaise = 0;
  const LIABILITY_TYPES = new Set(["loan", "home_loan_od", "overdraft", "credit_card"]);

  for (const row of accountBalanceRows.rows as Array<{ type: string; posting_total: string }>) {
    const balance = Number(row.posting_total);
    if (LIABILITY_TYPES.has(row.type)) {
      // Liabilities have negative balances in the ledger; take absolute value
      outstandingLiabilitiesPaise += Math.abs(balance);
    } else {
      // Liquid assets: bank, cash, investment — positive balances only
      if (balance > 0) liquidAssetsPaise += balance;
    }
  }

  // Fetch insurance policies (all kinds, for the user)
  const policyRows = await db
    .select({
      kind: insurancePolicies.kind,
      sumAssuredPaise: insurancePolicies.sumAssuredPaise,
      ownership: insurancePolicies.ownership,
      healthType: insurancePolicies.healthType,
      deductiblePaise: insurancePolicies.deductiblePaise,
      coPayBps: insurancePolicies.coPayBps,
      roomRentLimitPaise: insurancePolicies.roomRentLimitPaise,
      roomRentLimitBps: insurancePolicies.roomRentLimitBps,
      archivedAt: insurancePolicies.archivedAt,
    })
    .from(insurancePolicies)
    .where(eq(insurancePolicies.userId, userId));

  const lifePolicies = policyRows
    .filter((p) => p.kind === "life")
    .map((p) => ({
      sumAssuredPaise: p.sumAssuredPaise,
      ownership: p.ownership as "personal" | "employer",
      archived: p.archivedAt !== null,
    }));

  const healthPolicies = policyRows
    .filter((p) => p.kind === "health")
    .map((p) => ({
      sumAssuredPaise: p.sumAssuredPaise,
      ownership: p.ownership as "personal" | "employer",
      healthType: p.healthType,
      deductiblePaise: p.deductiblePaise,
      coPayBps: p.coPayBps,
      roomRentLimitPaise: p.roomRentLimitPaise,
      roomRentLimitBps: p.roomRentLimitBps,
      archived: p.archivedAt !== null,
    }));

  return computeInsuranceAdequacy({
    annualIncomePaise,
    dependents: members.map((m) => ({
      id: m.id,
      name: m.name,
      relationship: m.relationship,
      dateOfBirth: m.dateOfBirth ?? null,
      educationStage: m.educationStage ?? null,
    })),
    outstandingLiabilitiesPaise,
    liquidAssetsPaise,
    lifePolicies,
    healthPolicies,
    today,
    assumptions,
  });
}
