/**
 * deductions.ts — Deduction basket service (task 13.7).
 *
 * Two responsibilities:
 *  (i)  CRUD for `deduction_entries` — manual overrides for 80C / 80D / 80CCD1B / 80CCD2.
 *  (ii) `getDeductionBasket` — aggregate deduction eligibility from all sources for a given FY.
 *
 * All amounts are INTEGER PAISE throughout (1 INR = 100 paise).
 *
 * 80CCD(1) salary-based cap is NOT applied here — deferred to task 13.8 (see `assumptions`).
 * Document attachment for manual entries is a documented non-goal (no source_doc_key column).
 */

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { deductionEntries } from "../schema.ts";
import { holdings, insurancePolicies, policyCoveredPersons } from "../../../db/shared/spines.ts";
import { holdingEvents, depositDetails } from "../../investments/schema.ts";
import { familyMembers } from "../../../db/shared/persons.ts";
import { userProfiles } from "../../system/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import {
  getDeductionCap,
  PREVENTIVE_CHECKUP_SUBLIMIT_PAISE,
  resolveEmployerNpsRateBps,
} from "../../../lib/tax-rules.ts";
import { fyRange } from "../../../lib/financial-year.ts";
import { completedYearsBetween } from "../../../lib/scheme-limits.ts";
import { getRegimePreference } from "./regime-preference.ts";
import { getAllSchemeCompliance } from "./scheme-compliance.ts";
import { listContributions } from "./epf-contributions.ts";
import { sumPolicyPremiumsInRange } from "../../protection/services/insurance.ts";
import { getEmiInterestEstimateForFy } from "../../credit/services/emis.ts";
import type {
  DeductionEntry,
  CreateDeductionEntry,
  UpdateDeductionEntry,
  DeductionBasket,
} from "@compass/shared";

// ─── Pure helper functions (exported for unit testing) ────────────────────────

/**
 * Compute the NPS 80CCD(1B) / 80C-remainder split.
 * Pure — no I/O.
 *
 * The first ₹50,000 (5,000,000 paise) goes to 80CCD(1B).
 * The remainder flows into 80C.  Neither is salary-cap-validated here
 * (that is task 13.8 / AC4).
 */
export function computeNpsSplit(npsEmployeeContributed: number): {
  ccd1bContributed: number;
  npsRemainderPaise: number;
} {
  const NPS_CCD1B_CAP_PAISE = 5_000_000; // ₹50,000
  const ccd1bContributed = Math.min(npsEmployeeContributed, NPS_CCD1B_CAP_PAISE);
  return {
    ccd1bContributed,
    npsRemainderPaise: npsEmployeeContributed - ccd1bContributed,
  };
}

/**
 * Compute 80CCD(2) cap / eligible / capExceeded for one entry.
 * Pure — no I/O.
 *
 * cap = floor(salaryBasePaise × ratebps / 10000)
 */
export function computeCcd2Cap(
  amountPaise: number,
  salaryBasePaise: number,
  ratebps: number,
): { capPaise: number; eligiblePaise: number; capExceeded: boolean } {
  const capPaise = Math.floor((salaryBasePaise * ratebps) / 10000);
  const eligiblePaise = Math.min(amountPaise, capPaise);
  return { capPaise, eligiblePaise, capExceeded: amountPaise > capPaise };
}

/**
 * Cap the preventive health check-up amount at the statutory sub-limit (₹5,000).
 * Pure — no I/O.
 */
export function computePreventiveCheckupCap(amountPaise: number): number {
  return Math.min(amountPaise, PREVENTIVE_CHECKUP_SUBLIMIT_PAISE);
}

/**
 * Returns whether a person is a senior citizen (completed years ≥ 60) on a
 * given reference date.
 * Pure — no I/O. Missing DOB → false (conservative default).
 */
export function isSeniorCitizenOnDate(
  dateOfBirth: string | null | undefined,
  onDate: string,
): boolean {
  if (!dateOfBirth) return false;
  return completedYearsBetween(dateOfBirth, onDate) >= 60;
}

/**
 * Compute headroom (how much more can be contributed before hitting the cap).
 * Returns null when regime is "new" (the section is not available; headroom
 * would be misleading).
 * Pure — no I/O.
 */
export function computeHeadroom(
  regime: "old" | "new",
  capPaise: number,
  eligiblePaise: number,
): number | null {
  if (regime === "new") return null;
  return Math.max(0, capPaise - eligiblePaise);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Number of premium payments per year for a given frequency. */
function paymentsPerYear(premiumFrequency: string): number {
  switch (premiumFrequency) {
    case "monthly": return 12;
    case "quarterly": return 4;
    case "half_yearly": return 2;
    case "yearly": return 1;
    default: return 0; // "single" or unknown → skip estimation
  }
}

// ─── Row mapper ──────────────────────────────────────────────────────────────

function toDeductionEntry(row: typeof deductionEntries.$inferSelect): DeductionEntry {
  return {
    id: row.id,
    fy: row.fy,
    section: row.section as DeductionEntry["section"],
    deductionKind: row.deductionKind as DeductionEntry["deductionKind"],
    amountPaise: row.amountPaise,
    description: row.description,
    employerType: (row.employerType as "private" | "government" | null) ?? null,
    salaryBasePaise: row.salaryBasePaise ?? null,
    eightyDGroup: (row.eightyDGroup as "self_family" | "parents" | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** List all deduction entries for a user in a given FY, ordered by created_at. */
export async function listDeductionEntries(
  db: DbOrTx,
  userId: string,
  fy: string,
): Promise<DeductionEntry[]> {
  const rows = await db
    .select()
    .from(deductionEntries)
    .where(and(eq(deductionEntries.userId, userId), eq(deductionEntries.fy, fy)))
    .orderBy(deductionEntries.createdAt);
  return rows.map(toDeductionEntry);
}

/**
 * Create a deduction entry.
 * The Zod schema (superRefine) + DB check constraints enforce section/kind/group
 * compatibility — this function trusts the input has already passed Zod validation.
 */
export async function createDeductionEntry(
  db: DbOrTx,
  userId: string,
  input: CreateDeductionEntry,
): Promise<DeductionEntry> {
  const [row] = await db
    .insert(deductionEntries)
    .values({
      userId,
      fy: input.fy,
      section: input.section,
      deductionKind: input.deductionKind,
      amountPaise: input.amountPaise,
      description: input.description ?? "",
      employerType: input.employerType ?? null,
      salaryBasePaise: input.salaryBasePaise ?? null,
      eightyDGroup: input.eightyDGroup ?? null,
    })
    .returning();
  if (!row) throw new HttpError(500, "Failed to create deduction entry");
  return toDeductionEntry(row);
}

/**
 * Update a deduction entry (amountPaise, description, employerType, salaryBasePaise, eightyDGroup).
 * section, deductionKind, and fy are immutable after creation.
 * DB check constraints act as the backstop for cross-field validity.
 */
export async function updateDeductionEntry(
  db: DbOrTx,
  userId: string,
  id: string,
  input: UpdateDeductionEntry,
): Promise<DeductionEntry> {
  const set: Partial<{
    amountPaise: number;
    description: string;
    employerType: "private" | "government" | null;
    salaryBasePaise: number | null;
    eightyDGroup: "self_family" | "parents" | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (input.amountPaise !== undefined) set.amountPaise = input.amountPaise;
  if (input.description !== undefined) set.description = input.description;
  if (input.employerType !== undefined) set.employerType = input.employerType ?? null;
  if (input.salaryBasePaise !== undefined) set.salaryBasePaise = input.salaryBasePaise ?? null;
  if (input.eightyDGroup !== undefined) set.eightyDGroup = input.eightyDGroup ?? null;

  const [updated] = await db
    .update(deductionEntries)
    .set(set)
    .where(and(eq(deductionEntries.id, id), eq(deductionEntries.userId, userId)))
    .returning();
  if (!updated) throw new HttpError(404, "Deduction entry not found");
  return toDeductionEntry(updated);
}

/** Delete a deduction entry by id. Throws 404 if not owned by the user. */
export async function deleteDeductionEntry(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(deductionEntries)
    .where(and(eq(deductionEntries.id, id), eq(deductionEntries.userId, userId)))
    .returning({ id: deductionEntries.id });
  if (rows.length === 0) throw new HttpError(404, "Deduction entry not found");
}

// ─── getDeductionBasket ───────────────────────────────────────────────────────

/**
 * Compute the full deduction basket for a user in a given FY.
 *
 * Sources:
 *  - 80C: EPF+VPF (via epf_contributions), PPF/SSY (via scheme-compliance),
 *         ELSS buy events, life-insurance premiums, tax-saver FD / NSC deposits,
 *         NPS 80CCD(1) remainder, manual deduction_entries with section='80C'.
 *  - 80CCD(1B): NPS employee contribution up to ₹50,000.
 *  - 80CCD(2): manual deduction_entries with section='80CCD2'.
 *  - 80D: health-insurance premiums classified by covered family members,
 *         plus preventive-checkup and other_80d manual entries.
 *  - emiInterestEstimatePaise: informational only — NOT a deduction bucket.
 *
 * @throws {Error} For unknown / uncovered FY labels.
 */
export async function getDeductionBasket(
  db: Db,
  userId: string,
  fy: string,
): Promise<DeductionBasket> {
  // Validate FY coverage early — getDeductionCap throws for unknown/unsupported FYs.
  try {
    getDeductionCap("80C", fy);
  } catch {
    throw new HttpError(400, `Deduction basket is not available for FY "${fy}" — unsupported financial year`);
  }

  const [fyStart, fyEnd] = fyRange(fy);

  // ── Regime ───────────────────────────────────────────────────────────────────
  const regimePref = await getRegimePreference(db, userId, fy);
  const regime = regimePref.effective;

  // ── Scheme compliance (PPF / SSY / NPS Tier I) ───────────────────────────────
  const compliance = await getAllSchemeCompliance(db, userId, fy);

  // ── 80C sources accumulator ───────────────────────────────────────────────────
  const sources: DeductionBasket["eightyC"]["sources"] = [];
  const assumptions: string[] = [];

  // — EPF + VPF ————————————————————————————————————————————————————————————————
  const epfRows = await listContributions(db, userId, { fy });
  if (epfRows.length > 0) {
    const totalEpfEligible = epfRows.reduce((s, r) => s + r.eligible80cPaise, 0);
    if (totalEpfEligible > 0) {
      sources.push({
        kind: "epf",
        label: "EPF & VPF",
        contributedPaise: totalEpfEligible,
        provenance: "actual",
        note: null,
      });
    }
  }

  // — PPF ———————————————————————————————————————————————————————————————————————
  const ppfResults = compliance.filter((r) => r.schemeKind === "ppf");
  for (const result of ppfResults) {
    if (result.annualContributedPaise > 0 || result.statusCode !== "ok") {
      sources.push({
        kind: "ppf",
        label: `PPF account`,
        contributedPaise: result.annualContributedPaise,
        provenance: result.statusCode === "ok" ? "actual" : "data_missing",
        note: result.notes.length > 0 ? result.notes.join("; ") : null,
      });
    }
  }

  // — SSY ———————————————————————————————————————————————————————————————————————
  const ssyResults = compliance.filter((r) => r.schemeKind === "ssy");
  for (const result of ssyResults) {
    if (result.annualContributedPaise > 0 || result.statusCode !== "ok") {
      sources.push({
        kind: "ssy",
        label: `SSY account`,
        contributedPaise: result.annualContributedPaise,
        provenance: result.statusCode === "ok" ? "actual" : "data_missing",
        note: result.notes.length > 0 ? result.notes.join("; ") : null,
      });
    }
  }

  // — NPS 80CCD(1B) / 80C remainder split ————————————————————————————————————
  const npsResult = compliance.find((r) => r.schemeKind === "nps_tier1");
  const npsEmployeeContributed = npsResult?.npsEmployeeContributionPaise ?? 0;
  const { ccd1bContributed: npsCcd1bContributed, npsRemainderPaise } = computeNpsSplit(npsEmployeeContributed);
  if (npsRemainderPaise > 0) {
    assumptions.push(
      `80CCD(1) remainder (₹${(npsRemainderPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}) included in 80C total without salary-cap validation — see task 13.8`,
    );
  }

  // Manual 80CCD(1B) entries (nps_additional) — supplement the scheme-derived contribution
  const manual80Ccd1bRows = await db
    .select({ amountPaise: deductionEntries.amountPaise })
    .from(deductionEntries)
    .where(
      and(
        eq(deductionEntries.userId, userId),
        eq(deductionEntries.fy, fy),
        eq(deductionEntries.section, "80CCD1B"),
      ),
    );
  const manual80Ccd1bTotal = manual80Ccd1bRows.reduce((s, r) => s + r.amountPaise, 0);
  const ccd1bContributed = npsCcd1bContributed + manual80Ccd1bTotal;

  // — ELSS holdings (buy events in FY) ————————————————————————————————————————
  const elssHoldings = await db
    .select({ id: holdings.id, name: holdings.name })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.isElss, true)));

  for (const h of elssHoldings) {
    const evts = await db
      .select({ amountPaise: holdingEvents.amountPaise })
      .from(holdingEvents)
      .where(
        and(
          eq(holdingEvents.holdingId, h.id),
          eq(holdingEvents.type, "buy"),
          gte(holdingEvents.date, fyStart),
          lte(holdingEvents.date, fyEnd),
        ),
      );
    const total = evts.reduce((s, e) => s + e.amountPaise, 0);
    if (total > 0) {
      sources.push({
        kind: "elss",
        label: h.name,
        contributedPaise: total,
        provenance: "actual",
        note: null,
      });
    }
  }

  // — Life insurance premiums ——————————————————————————————————————————————————
  const lifePolicies = await db
    .select({
      id: insurancePolicies.id,
      name: insurancePolicies.name,
      premiumPaise: insurancePolicies.premiumPaise,
      premiumFrequency: insurancePolicies.premiumFrequency,
    })
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.kind, "life")));

  for (const policy of lifePolicies) {
    const { totalPaise } = await sumPolicyPremiumsInRange(db, userId, policy.id, fyStart, fyEnd);
    if (totalPaise > 0) {
      sources.push({
        kind: "life_insurance",
        label: policy.name,
        contributedPaise: totalPaise,
        provenance: "actual",
        note: null,
      });
    } else {
      const ppy = paymentsPerYear(policy.premiumFrequency ?? "yearly");
      if (ppy > 0 && policy.premiumPaise > 0) {
        sources.push({
          kind: "life_insurance",
          label: policy.name,
          contributedPaise: policy.premiumPaise * ppy,
          provenance: "estimated",
          note: `Estimated: ${ppy} × ₹${Math.round(policy.premiumPaise / 100).toLocaleString("en-IN")} (no actual premiums recorded for this FY)`,
        });
      }
    }
  }

  // — Tax-saver FD / NSC (startDate within FY) ————————————————————————————————
  const deposits = await db
    .select({
      depositKind: depositDetails.depositKind,
      principalPaise: depositDetails.principalPaise,
      holdingName: holdings.name,
    })
    .from(depositDetails)
    .innerJoin(holdings, eq(holdings.id, depositDetails.holdingId))
    .where(
      and(
        eq(depositDetails.userId, userId),
        sql`${depositDetails.depositKind} IN ('tax_saver_fd', 'nsc')`,
        gte(depositDetails.startDate, fyStart),
        lte(depositDetails.startDate, fyEnd),
      ),
    );

  for (const dep of deposits) {
    if (dep.principalPaise && dep.principalPaise > 0) {
      sources.push({
        kind: dep.depositKind as "tax_saver_fd" | "nsc",
        label: dep.holdingName,
        contributedPaise: dep.principalPaise,
        provenance: "actual",
        note: null,
      });
    }
  }

  // — Manual 80C entries (summed into one item) ————————————————————————————————
  const manual80cRows = await db
    .select({ amountPaise: deductionEntries.amountPaise })
    .from(deductionEntries)
    .where(
      and(
        eq(deductionEntries.userId, userId),
        eq(deductionEntries.fy, fy),
        eq(deductionEntries.section, "80C"),
      ),
    );
  const manual80cTotal = manual80cRows.reduce((s, r) => s + r.amountPaise, 0);
  if (manual80cTotal > 0) {
    sources.push({
      kind: "manual",
      label: "Manual 80C entries",
      contributedPaise: manual80cTotal,
      provenance: "manual",
      note: null,
    });
  }

  // ── 80C aggregate ─────────────────────────────────────────────────────────────
  const sourcesTotal = sources.reduce((s, src) => s + src.contributedPaise, 0);
  const eightyCContributed = sourcesTotal + npsRemainderPaise;
  const eightyCCapEntry = getDeductionCap("80C", fy).find((c) => c.regime === "old");
  const eightyCCap = eightyCCapEntry?.capPaise ?? 15_000_000;
  const eightyCEligible = Math.min(eightyCContributed, eightyCCap);
  const eightyCHeadroom = computeHeadroom(regime, eightyCCap, eightyCEligible);

  // ── 80CCD(1B) ─────────────────────────────────────────────────────────────────
  const ccd1bCapEntry = getDeductionCap("80CCD(1B)", fy).find((c) => c.regime === "old");
  const ccd1bCap = ccd1bCapEntry?.capPaise ?? 5_000_000;
  const ccd1bEligible = Math.min(ccd1bContributed, ccd1bCap);
  const ccd1bHeadroom = computeHeadroom(regime, ccd1bCap, ccd1bEligible);

  // ── 80CCD(2) ──────────────────────────────────────────────────────────────────
  const ccd2Rows = await db
    .select()
    .from(deductionEntries)
    .where(
      and(
        eq(deductionEntries.userId, userId),
        eq(deductionEntries.fy, fy),
        eq(deductionEntries.section, "80CCD2"),
      ),
    );

  const ccd2Entries: DeductionBasket["eightyCcd2"]["entries"] = ccd2Rows.map((e) => {
    const empType = e.employerType as "private" | "government";
    const salBase = e.salaryBasePaise!;
    const ratebps = resolveEmployerNpsRateBps(fy, regime, empType);
    const { capPaise, eligiblePaise, capExceeded } = computeCcd2Cap(e.amountPaise, salBase, ratebps);
    return {
      id: e.id,
      employerType: empType,
      salaryBasePaise: salBase,
      contributedPaise: e.amountPaise,
      ratebps,
      capPaise,
      eligiblePaise,
      capExceeded,
    };
  });
  const ccd2Contributed = ccd2Entries.reduce((s, e) => s + e.contributedPaise, 0);
  const ccd2Eligible = ccd2Entries.reduce((s, e) => s + e.eligiblePaise, 0);

  // ── 80D ───────────────────────────────────────────────────────────────────────

  // Load health insurance policies
  const healthPolicies = await db
    .select({
      id: insurancePolicies.id,
      name: insurancePolicies.name,
      premiumPaise: insurancePolicies.premiumPaise,
      premiumFrequency: insurancePolicies.premiumFrequency,
    })
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.kind, "health")));

  // Batch-load covered person IDs for all health policies
  const healthPolicyIds = healthPolicies.map((p) => p.id);
  const coveredPersonsRows =
    healthPolicyIds.length > 0
      ? await db
          .select({
            policyId: policyCoveredPersons.policyId,
            personId: policyCoveredPersons.personId,
          })
          .from(policyCoveredPersons)
          .where(inArray(policyCoveredPersons.policyId, healthPolicyIds))
      : [];

  const coveredByPolicy = new Map<string, string[]>();
  for (const cp of coveredPersonsRows) {
    const list = coveredByPolicy.get(cp.policyId) ?? [];
    list.push(cp.personId);
    coveredByPolicy.set(cp.policyId, list);
  }

  // Batch-load family member relationships and DOBs for all covered persons
  const allPersonIds = [...new Set(coveredPersonsRows.map((r) => r.personId))];
  const personRows =
    allPersonIds.length > 0
      ? await db
          .select({
            id: familyMembers.id,
            relationship: familyMembers.relationship,
            dateOfBirth: familyMembers.dateOfBirth,
          })
          .from(familyMembers)
          .where(and(eq(familyMembers.userId, userId), inArray(familyMembers.id, allPersonIds)))
      : [];
  const personMap = new Map(personRows.map((p) => [p.id, p]));

  let selfFamilyContributed = 0;
  let parentsContributed = 0;
  const unallocatedPolicies: DeductionBasket["eightyD"]["unallocatedPolicies"] = [];
  const parentsBucketPersonIds = new Set<string>(); // for parents senior check

  for (const policy of healthPolicies) {
    const pIds = coveredByPolicy.get(policy.id) ?? [];
    if (pIds.length === 0) {
      unallocatedPolicies.push({
        policyId: policy.id,
        name: policy.name,
        reason: "no_covered_persons",
      });
      continue;
    }

    const members = pIds
      .map((id) => personMap.get(id))
      .filter((m): m is (typeof personRows)[number] => m !== undefined);
    const hasParent = members.some((m) => m.relationship === "parent");
    const hasNonParent = members.some((m) => m.relationship !== "parent");

    if (hasParent && hasNonParent) {
      unallocatedPolicies.push({
        policyId: policy.id,
        name: policy.name,
        reason: "mixed_coverage",
      });
      continue;
    }

    // Determine premium for this policy in the FY (actual preferred; fall back to estimate)
    const { totalPaise } = await sumPolicyPremiumsInRange(db, userId, policy.id, fyStart, fyEnd);
    let premiumForFy: number;
    if (totalPaise > 0) {
      premiumForFy = totalPaise;
    } else {
      const ppy = paymentsPerYear(policy.premiumFrequency ?? "yearly");
      premiumForFy = ppy > 0 ? policy.premiumPaise * ppy : 0;
    }

    if (hasParent) {
      parentsContributed += premiumForFy;
      for (const id of pIds) parentsBucketPersonIds.add(id);
    } else {
      selfFamilyContributed += premiumForFy;
    }
  }

  // Senior citizen checks ─────────────────────────────────────────────────────

  // selfFamily: taxpayer DOB or any spouse DOB, age ≥ 60 on FY end
  const [profileRow] = await db
    .select({ dateOfBirth: userProfiles.dateOfBirth })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));

  let selfFamilySenior = isSeniorCitizenOnDate(profileRow?.dateOfBirth, fyEnd);
  if (!selfFamilySenior) {
    const spouseRows = await db
      .select({ dateOfBirth: familyMembers.dateOfBirth })
      .from(familyMembers)
      .where(
        and(eq(familyMembers.userId, userId), eq(familyMembers.relationship, "spouse")),
      );
    for (const spouse of spouseRows) {
      if (isSeniorCitizenOnDate(spouse.dateOfBirth, fyEnd)) {
        selfFamilySenior = true;
        break;
      }
    }
  }

  // parents: any covered parent family member across parents-bucket policies, age ≥ 60 on FY end
  let parentsSenior = false;
  for (const pid of parentsBucketPersonIds) {
    const p = personMap.get(pid);
    if (p?.relationship === "parent" && isSeniorCitizenOnDate(p.dateOfBirth, fyEnd)) {
      parentsSenior = true;
      break;
    }
  }

  // Preventive checkup entries (capped at sub-limit, included INSIDE group contributed) ────────
  const prevRows = await db
    .select({
      amountPaise: deductionEntries.amountPaise,
      eightyDGroup: deductionEntries.eightyDGroup,
    })
    .from(deductionEntries)
    .where(
      and(
        eq(deductionEntries.userId, userId),
        eq(deductionEntries.fy, fy),
        eq(deductionEntries.section, "80D"),
        eq(deductionEntries.deductionKind, "preventive_checkup"),
      ),
    );
  let selfFamilyPreventive = 0;
  let parentsPreventive = 0;
  for (const r of prevRows) {
    if (r.eightyDGroup === "self_family") selfFamilyPreventive += r.amountPaise;
    else if (r.eightyDGroup === "parents") parentsPreventive += r.amountPaise;
  }
  selfFamilyPreventive = computePreventiveCheckupCap(selfFamilyPreventive);
  parentsPreventive = computePreventiveCheckupCap(parentsPreventive);

  // other_80d manual entries — add directly to the matching group's contributed ───
  const other80dRows = await db
    .select({
      amountPaise: deductionEntries.amountPaise,
      eightyDGroup: deductionEntries.eightyDGroup,
    })
    .from(deductionEntries)
    .where(
      and(
        eq(deductionEntries.userId, userId),
        eq(deductionEntries.fy, fy),
        eq(deductionEntries.section, "80D"),
        eq(deductionEntries.deductionKind, "other_80d"),
      ),
    );
  for (const r of other80dRows) {
    if (r.eightyDGroup === "self_family") selfFamilyContributed += r.amountPaise;
    else if (r.eightyDGroup === "parents") parentsContributed += r.amountPaise;
  }

  // Add preventive checkup (INSIDE the group cap, not additive on top) ───────────
  selfFamilyContributed += selfFamilyPreventive;
  parentsContributed += parentsPreventive;

  // 80D caps and eligible ────────────────────────────────────────────────────────
  const selfSectionKey = selfFamilySenior ? "80D_self_senior" : "80D_self";
  const parentsSectionKey = parentsSenior ? "80D_parents_senior" : "80D_parents";
  const selfFamilyCap =
    getDeductionCap(selfSectionKey, fy).find((c) => c.regime === "old")?.capPaise ?? 2_500_000;
  const parentsCap =
    getDeductionCap(parentsSectionKey, fy).find((c) => c.regime === "old")?.capPaise ?? 2_500_000;

  const selfFamilyEligible = Math.min(selfFamilyContributed, selfFamilyCap);
  const parentsEligible = Math.min(parentsContributed, parentsCap);

  // ── EMI interest estimate (informational, NOT a deduction bucket) ─────────────
  const { estimatePaise: emiInterestEstimatePaise } = await getEmiInterestEstimateForFy(
    db,
    userId,
    fy,
  );

  // ── Assemble basket ───────────────────────────────────────────────────────────
  return {
    fy,
    regime,
    eightyC: {
      sources,
      npsRemainderPaise,
      contributedPaise: eightyCContributed,
      capPaise: eightyCCap,
      eligiblePaise: eightyCEligible,
      headroomPaise: eightyCHeadroom,
      assumptions,
    },
    eightyCcd1b: {
      contributedPaise: ccd1bContributed,
      capPaise: ccd1bCap,
      eligiblePaise: ccd1bEligible,
      headroomPaise: ccd1bHeadroom,
    },
    eightyCcd2: {
      entries: ccd2Entries,
      contributedPaise: ccd2Contributed,
      eligiblePaise: ccd2Eligible,
    },
    eightyD: {
      selfFamily: {
        contributedPaise: selfFamilyContributed,
        seniorApplies: selfFamilySenior,
        capPaise: selfFamilyCap,
        eligiblePaise: selfFamilyEligible,
        preventiveCheckupPaise: selfFamilyPreventive,
        headroomPaise: computeHeadroom(regime, selfFamilyCap, selfFamilyEligible),
      },
      parents: {
        contributedPaise: parentsContributed,
        seniorApplies: parentsSenior,
        capPaise: parentsCap,
        eligiblePaise: parentsEligible,
        preventiveCheckupPaise: parentsPreventive,
        headroomPaise: computeHeadroom(regime, parentsCap, parentsEligible),
      },
      unallocatedPolicies,
    },
    emiInterestEstimatePaise,
    generatedAt: new Date().toISOString(),
  };
}
