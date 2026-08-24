/**
 * scheme-compliance.ts — FY-aware contribution-limit checks for PPF, SSY, and
 * NPS Tier I (task 13.6).
 *
 * Two public entry points:
 *   - getAllSchemeCompliance(db, userId, fy)  — all eligible accounts
 *   - getAccountSchemeCompliance(db, userId, accountId, fy) — single account
 *
 * Contribution totals are summed from ledger postings. Opening-balance
 * transactions are excluded structurally via NOT EXISTS on a posting from the
 * same transaction to an account with systemKind = 'opening'. There is NO
 * `transactions.type` column — do not use one.
 *
 * All amounts are INTEGER PAISE throughout.
 */

import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { familyMembers } from "../../../db/shared/persons.ts";
import { accountNpsDetails } from "../../investments/schema.ts";
import {
  schemeRulesFor,
  ppfMaturityDate,
  ssyDepositWindowEnd,
  completedYearsBetween,
  SECTION_80C_CAP_PAISE,
  type SchemeKind,
} from "../../../lib/scheme-limits.ts";
import { fyRange, currentFy } from "../../../lib/financial-year.ts";
import type { AccountComplianceResult } from "@compass/shared";

// ─── Contribution query ───────────────────────────────────────────────────────

/**
 * Sum positive postings to `accountId` in [`fyStart`, `fyEnd`] that are NOT
 * part of an opening-balance transaction (i.e. no posting from the same
 * transaction lands on an account with systemKind = 'opening').
 *
 * Mandatory conditions:
 *   - transactions.user_id = userId  (user scoping)
 *   - transactions.deleted_at IS NULL (exclude soft-deleted)
 *   - NOT EXISTS (opening account posting in same tx)
 *   - postings.amount_paise > 0
 *   - transactions.date in [fyStart, fyEnd] inclusive
 *
 * Returns 0 when there are no qualifying postings.
 */
async function sumContributions(
  db: DbOrTx,
  accountId: string,
  userId: string,
  fyStart: string,
  fyEnd: string,
): Promise<number> {
  const result = await db.execute(sql`
    select coalesce(sum(p.amount_paise), 0) as total
    from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId}
      and t.user_id = ${userId}
      and t.deleted_at is null
      and p.amount_paise > 0
      and t.date >= ${fyStart}
      and t.date <= ${fyEnd}
      and not exists (
        select 1
        from postings p2
        join accounts a2 on a2.id = p2.account_id and a2.system_kind = 'opening'
        where p2.transaction_id = t.id
      )
  `);
  const row = result.rows[0] as { total: string } | undefined;
  return Number(row?.total ?? 0);
}

// ─── Compliance logic helpers ─────────────────────────────────────────────────

/**
 * Determine whether a FY has fully completed (its end date is in the past).
 * Uses today's date from the system clock — no injection needed for this pure
 * temporal guard.
 */
function isFyCompleted(fy: string): boolean {
  const [, fyEnd] = fyRange(fy);
  const today = new Date().toISOString().slice(0, 10);
  return fyEnd < today;
}

/** Build a compliance result for PPF or SSY. */
function buildResult(
  accountId: string,
  schemeKind: SchemeKind,
  fy: string,
  annualContributedPaise: number,
  statusCode: AccountComplianceResult["statusCode"],
  notes: string[],
  extraFields?: { eligible80CPaise?: number | null; npsEmployeeContributionPaise?: number | null },
): AccountComplianceResult {
  const rules = schemeRulesFor(schemeKind, fy);
  const deficitPaise = Math.max(0, rules.minAnnualPaise - annualContributedPaise);
  const headroomPaise =
    rules.maxAnnualPaise !== null
      ? Math.max(0, rules.maxAnnualPaise - annualContributedPaise)
      : null;

  const eligible80CPaise =
    extraFields?.eligible80CPaise !== undefined
      ? extraFields.eligible80CPaise
      : rules.deductionSection === "80C"
        ? Math.min(annualContributedPaise, SECTION_80C_CAP_PAISE)
        : null;

  const npsEmployeeContributionPaise =
    extraFields?.npsEmployeeContributionPaise !== undefined
      ? extraFields.npsEmployeeContributionPaise
      : null;

  return {
    accountId,
    schemeKind,
    fy,
    annualContributedPaise,
    minPaise: rules.minAnnualPaise,
    maxPaise: rules.maxAnnualPaise,
    statusCode,
    deficitPaise,
    headroomPaise,
    eligible80CPaise,
    npsEmployeeContributionPaise,
    isEstimate: true,
    notes,
  };
}

// ─── Per-scheme compliance computation ───────────────────────────────────────

/** Compute PPF compliance for a single account row. */
async function ppfCompliance(
  db: DbOrTx,
  account: typeof accounts.$inferSelect,
  userId: string,
  fy: string,
  fyStart: string,
  fyEnd: string,
): Promise<AccountComplianceResult> {
  // Sum contributions first — the result is carried into every buildResult path,
  // including data_missing. Previously, data_missing returned 0 by construction
  // (the call was below the guard); now all paths report the real contributed value.
  const contributed = await sumContributions(db, account.id, userId, fyStart, fyEnd);

  if (!account.schemeOpenedDate) {
    return buildResult(account.id, "ppf", fy, contributed, "data_missing", [
      "schemeOpenedDate is not set — cannot determine lifecycle status",
    ]);
  }

  const today = new Date().toISOString().slice(0, 10);
  const maturityDate = ppfMaturityDate(account.schemeOpenedDate);
  if (today > maturityDate) {
    // Past maturity with no extension-mode data → lifecycle_unknown.
    return buildResult(account.id, "ppf", fy, contributed, "lifecycle_unknown", [
      `PPF matured on ${maturityDate}. Extension mode is not modelled; lifecycle cannot be determined.`,
    ]);
  }

  const rules = schemeRulesFor("ppf", fy);
  const notes: string[] = [];
  let statusCode: AccountComplianceResult["statusCode"];

  if (rules.maxAnnualPaise !== null && contributed > rules.maxAnnualPaise) {
    statusCode = "above_max";
  } else if (contributed < rules.minAnnualPaise) {
    if (isFyCompleted(fy)) {
      statusCode = "discontinued";
      notes.push(
        `Contributed less than ₹500 (${rules.minAnnualPaise} paise) in a completed FY. ` +
          `Account may be discontinued. Revival costs ₹50 fee + ₹500 arrears per default year.`,
      );
    } else {
      statusCode = "discontinued_risk";
      notes.push(
        `Contribution is below ₹500 minimum for PPF in the current FY. ` +
          `Missing the minimum results in discontinuation.`,
      );
    }
  } else {
    statusCode = "ok";
  }

  return buildResult(account.id, "ppf", fy, contributed, statusCode, notes);
}

/** Compute SSY compliance for a single account + holder member row. */
async function ssyCompliance(
  db: DbOrTx,
  account: typeof accounts.$inferSelect,
  holder: typeof familyMembers.$inferSelect | null,
  userId: string,
  fy: string,
  fyStart: string,
  fyEnd: string,
): Promise<AccountComplianceResult> {
  // Sum contributions first — the result is carried into every buildResult path,
  // including data_missing/data_invalid/outside_deposit_window. Previously, those
  // early-return paths passed 0 by construction; now all paths report the real value.
  const contributed = await sumContributions(db, account.id, userId, fyStart, fyEnd);

  // Gender check is always skipped — no sex column in family_members.
  const notes: string[] = [
    "Gender check skipped — no sex/gender field in family_members.",
  ];

  if (!account.schemeOpenedDate) {
    return buildResult(account.id, "ssy", fy, contributed, "data_missing", [
      ...notes,
      "schemeOpenedDate is not set — cannot determine deposit window or holder age.",
    ]);
  }

  if (!holder) {
    return buildResult(account.id, "ssy", fy, contributed, "data_missing", [
      ...notes,
      "No family member linked as holder (holderId is null or member not found for this user).",
    ]);
  }

  if (!holder.dateOfBirth) {
    return buildResult(account.id, "ssy", fy, contributed, "data_missing", [
      ...notes,
      `Family member ${holder.id} has no date_of_birth recorded.`,
    ]);
  }

  // Age gate: holder must be ≤ 10 years old on the opening date.
  // completedYearsBetween returns the age (completed years) on the opening date.
  const ageAtOpening = completedYearsBetween(holder.dateOfBirth, account.schemeOpenedDate);
  if (ageAtOpening > 10) {
    return buildResult(account.id, "ssy", fy, contributed, "data_invalid", [
      ...notes,
      `Holder was ${ageAtOpening} completed years old on the opening date ${account.schemeOpenedDate}. SSY requires the girl child to be ≤ 10 years at opening.`,
    ]);
  }

  // Deposit window: 15 years from the opening date.
  const windowEnd = ssyDepositWindowEnd(account.schemeOpenedDate);
  // The FY's start date determines if deposits were/are accepted in this FY.
  if (fyStart > windowEnd) {
    return buildResult(account.id, "ssy", fy, contributed, "outside_deposit_window", [
      ...notes,
      `SSY deposit window closed on ${windowEnd} (15 years from opening date ${account.schemeOpenedDate}).`,
    ]);
  }

  const rules = schemeRulesFor("ssy", fy);
  let statusCode: AccountComplianceResult["statusCode"];

  if (rules.maxAnnualPaise !== null && contributed > rules.maxAnnualPaise) {
    statusCode = "above_max";
  } else if (contributed < rules.minAnnualPaise) {
    if (isFyCompleted(fy)) {
      statusCode = "discontinued";
      notes.push(
        `Contributed less than ₹250 (${rules.minAnnualPaise} paise) in a completed FY. ` +
          `Account may be discontinued. Revival costs ₹50 fee + ₹500 arrears per default year.`,
      );
    } else {
      statusCode = "discontinued_risk";
      notes.push(
        `Contribution is below ₹250 minimum for SSY in the current FY. ` +
          `Missing the minimum results in discontinuation.`,
      );
    }
  } else {
    statusCode = "ok";
  }

  return buildResult(account.id, "ssy", fy, contributed, statusCode, notes);
}

/** Compute NPS Tier I compliance for a single account + detail row. */
async function npsTier1Compliance(
  db: DbOrTx,
  account: typeof accounts.$inferSelect,
  detail: typeof accountNpsDetails.$inferSelect | null,
  userId: string,
  fy: string,
  fyStart: string,
  fyEnd: string,
): Promise<AccountComplianceResult | null> {
  // null detail → data_missing.
  if (!detail) {
    return buildResult(account.id, "nps_tier1", fy, 0, "data_missing", [
      "NPS account has no account_nps_details row for this user — tier cannot be determined.",
    ], { eligible80CPaise: null, npsEmployeeContributionPaise: 0 });
  }

  // tier_ii → exclude silently.
  if (detail.tier === "tier_ii") {
    return null;
  }

  // tier_i → include.
  const contributed = await sumContributions(db, account.id, userId, fyStart, fyEnd);
  const rules = schemeRulesFor("nps_tier1", fy);
  const notes: string[] = [
    "NPS 80CCD(1) salary-based cap deferred to task 13.8 (requires salary context).",
  ];
  let statusCode: AccountComplianceResult["statusCode"];

  if (contributed < rules.minAnnualPaise) {
    statusCode = "below_min";
  } else {
    statusCode = "ok";
  }

  return buildResult(account.id, "nps_tier1", fy, contributed, statusCode, notes, {
    eligible80CPaise: null,
    npsEmployeeContributionPaise: contributed,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute scheme compliance for ALL PPF, SSY, and NPS Tier I accounts owned by
 * the user. Tier II NPS accounts are silently excluded.
 */
export async function getAllSchemeCompliance(
  db: DbOrTx,
  userId: string,
  fy: string,
): Promise<AccountComplianceResult[]> {
  const [fyStart, fyEnd] = fyRange(fy);
  const results: AccountComplianceResult[] = [];

  // ── PPF ──────────────────────────────────────────────────────────────────
  const ppfRows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.type, "ppf")));

  for (const account of ppfRows) {
    results.push(await ppfCompliance(db, account, userId, fy, fyStart, fyEnd));
  }

  // ── SSY ──────────────────────────────────────────────────────────────────
  const ssyRows = await db
    .select({ account: accounts, member: familyMembers })
    .from(accounts)
    .leftJoin(
      familyMembers,
      and(
        eq(familyMembers.id, accounts.holderId),
        eq(familyMembers.userId, userId),
      ),
    )
    .where(and(eq(accounts.userId, userId), eq(accounts.type, "ssy")));

  for (const { account, member } of ssyRows) {
    results.push(
      await ssyCompliance(db, account, member, userId, fy, fyStart, fyEnd),
    );
  }

  // ── NPS ──────────────────────────────────────────────────────────────────
  // LEFT JOIN so that accounts without a detail row are included (→ data_missing).
  const npsRows = await db
    .select({ account: accounts, detail: accountNpsDetails })
    .from(accounts)
    .leftJoin(
      accountNpsDetails,
      and(
        eq(accountNpsDetails.accountId, accounts.id),
        eq(accountNpsDetails.userId, userId),
      ),
    )
    .where(and(eq(accounts.userId, userId), eq(accounts.type, "nps")));

  for (const { account, detail } of npsRows) {
    const result = await npsTier1Compliance(db, account, detail, userId, fy, fyStart, fyEnd);
    if (result !== null) results.push(result);
  }

  return results;
}

/**
 * Compute scheme compliance for a single account.
 *
 * Returns null when the account:
 *   - does not exist or does not belong to the user
 *   - is not a PPF, SSY, or NPS account
 *   - is NPS Tier II (silently excluded, same as the list endpoint)
 */
export async function getAccountSchemeCompliance(
  db: DbOrTx,
  userId: string,
  accountId: string,
  fy: string,
): Promise<AccountComplianceResult | null> {
  const [fyStart, fyEnd] = fyRange(fy);

  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

  const account = rows[0];
  if (!account) return null;

  if (account.type === "ppf") {
    return ppfCompliance(db, account, userId, fy, fyStart, fyEnd);
  }

  if (account.type === "ssy") {
    const memberRows = await db
      .select()
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.id, account.holderId!),
          eq(familyMembers.userId, userId),
        ),
      );
    // If holderId is null, leftJoin-style: pass null
    const member = account.holderId ? (memberRows[0] ?? null) : null;
    return ssyCompliance(db, account, member, userId, fy, fyStart, fyEnd);
  }

  if (account.type === "nps") {
    const detailRows = await db
      .select()
      .from(accountNpsDetails)
      .where(
        and(
          eq(accountNpsDetails.accountId, accountId),
          eq(accountNpsDetails.userId, userId),
        ),
      );
    const detail = detailRows[0] ?? null;
    return npsTier1Compliance(db, account, detail, userId, fy, fyStart, fyEnd);
  }

  return null;
}

/** Convenience: default the FY to the current FY when the caller does not supply one. */
export function resolveSchemeComplianceFy(fy: string | undefined): string {
  return fy ?? currentFy();
}
