/**
 * Nominee & continuity dossier (task 14.4).
 * Consolidates every account, holding, and insurance policy with its nominee
 * status, and surfaces accounts with no nominee as the headline.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import type { ContinuityDossier, DossierEntry } from "@compass/shared";
import { accounts } from "../../../db/shared/hubs.ts";
import { insurancePolicies, holdings } from "../../../db/shared/spines.ts";
import { familyMembers } from "../../../db/shared/persons.ts";

const DISCLAIMER =
  "Nomination is not inheritance. A nominee is a custodian who receives the proceeds — succession law or a registered will determines legal entitlement. Please consult a legal professional for estate planning.";

export async function getContinuityDossier(db: Db, userId: string): Promise<ContinuityDossier> {
  // Fetch all 3 entity types and family members in parallel
  const [accts, holds, policies, members] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        institution: accounts.institution,
        accountLast4: accounts.accountLast4,
        nominee: accounts.nominee,
        nomineePersonId: accounts.nomineePersonId,
      })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt), isNull(accounts.systemKind))),

    db
      .select({
        id: holdings.id,
        name: holdings.name,
        assetClass: holdings.assetClass,
        folioNumber: holdings.folioNumber,
        nominee: holdings.nominee,
        nomineePersonId: holdings.nomineePersonId,
      })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), isNull(holdings.archivedAt))),

    db
      .select({
        id: insurancePolicies.id,
        name: insurancePolicies.name,
        kind: insurancePolicies.kind,
        insurer: insurancePolicies.insurer,
        policyNumber: insurancePolicies.policyNumber,
        nominee: insurancePolicies.nominee,
        nomineePersonId: insurancePolicies.nomineePersonId,
        sumAssuredPaise: insurancePolicies.sumAssuredPaise,
        documentPath: insurancePolicies.documentPath,
      })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), isNull(insurancePolicies.archivedAt))),

    db
      .select({ id: familyMembers.id, name: familyMembers.name })
      .from(familyMembers)
      .where(eq(familyMembers.userId, userId)),
  ]);

  // Build a person-name lookup
  const personNames = new Map(members.map((m) => [m.id, m.name]));

  const entries: DossierEntry[] = [];

  // Accounts
  for (const a of accts) {
    const hasNominee = a.nominee.trim() !== "" || a.nomineePersonId !== null;
    entries.push({
      key: `account:${a.id}`,
      entityType: "account",
      entityId: a.id,
      name: a.name,
      subtype: a.type,
      institution: a.institution,
      identifier: a.accountLast4 ? `••••${a.accountLast4}` : null,
      nominee: a.nominee,
      nomineePersonId: a.nomineePersonId ?? null,
      nomineePersonName: a.nomineePersonId ? (personNames.get(a.nomineePersonId) ?? null) : null,
      hasDocument: false,
      valuePaise: null,
      missingNominee: !hasNominee,
    });
  }

  // Holdings
  for (const h of holds) {
    const hasNominee = h.nominee.trim() !== "" || h.nomineePersonId !== null;
    entries.push({
      key: `holding:${h.id}`,
      entityType: "holding",
      entityId: h.id,
      name: h.name,
      subtype: h.assetClass,
      institution: null,
      identifier: h.folioNumber,
      nominee: h.nominee,
      nomineePersonId: h.nomineePersonId ?? null,
      nomineePersonName: h.nomineePersonId ? (personNames.get(h.nomineePersonId) ?? null) : null,
      hasDocument: false,
      valuePaise: null,
      missingNominee: !hasNominee,
    });
  }

  // Insurance policies
  for (const p of policies) {
    const hasNominee = p.nominee.trim() !== "" || p.nomineePersonId !== null;
    entries.push({
      key: `insurance_policy:${p.id}`,
      entityType: "insurance_policy",
      entityId: p.id,
      name: p.name,
      subtype: p.kind,
      institution: p.insurer || null,
      identifier: p.policyNumber || null,
      nominee: p.nominee,
      nomineePersonId: p.nomineePersonId ?? null,
      nomineePersonName: p.nomineePersonId ? (personNames.get(p.nomineePersonId) ?? null) : null,
      hasDocument: p.documentPath !== null,
      valuePaise: p.sumAssuredPaise,
      missingNominee: !hasNominee,
    });
  }

  // Sort: missing nominees first, then by entity type, then by name
  entries.sort((a, b) => {
    if (a.missingNominee !== b.missingNominee) return a.missingNominee ? -1 : 1;
    if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
    return a.name.localeCompare(b.name);
  });

  const missingNomineeCount = entries.filter((e) => e.missingNominee).length;

  return {
    entries,
    missingNomineeCount,
    totalEntries: entries.length,
    disclaimer: DISCLAIMER,
  };
}
