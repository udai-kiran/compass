/**
 * data-completeness.ts — assembles a per-account data-readiness/confidence
 * report from existing evidence in the database (imports, card reconciliations,
 * holding valuations, extracted drafts, net-worth snapshots).
 *
 * Note on holdings: the `holdings` table is user-scoped (userId), NOT
 * account-scoped — there is no accountId FK on holdings. Consequently,
 * lastValuationAt is derived from the user's most recent holding valuation
 * and applied to all investment-type accounts uniformly.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import {
  accounts,
  extractedTransactions,
  holdings,
  holdingValuations,
  imports,
  netWorthSnapshots,
  statementReconciliations,
} from "../../../db/schema.ts";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AccountReadiness {
  accountId: string;
  accountName: string;
  accountType: string;
  /** ISO date of the most recent committed import; null if never imported */
  lastImportedAt: string | null;
  /** age of last import in days; null if never imported */
  lastImportDaysAgo: number | null;
  /**
   * For credit-card accounts: count of unmatched statement lines in the most
   * recent reconciliation cycle; null for non-card accounts.
   */
  unmatchedStatementLines: number | null;
  /**
   * For investment accounts with holdings: ISO date of the most recent
   * holding valuation across all user holdings (holdings are user-scoped,
   * not account-scoped); null if no valuations.
   */
  lastValuationAt: string | null;
  /** age of last valuation in days; null if no valuations */
  lastValuationDaysAgo: number | null;
  /** "fresh" | "stale" | "missing" — stale = > 30 days, missing = never */
  dataFreshness: "fresh" | "stale" | "missing";
}

export interface DataCompletenessReport {
  /** Today's date (ISO), used as the reference for all age computations */
  asOf: string;
  accounts: AccountReadiness[];
  /** unresolved extracted-transaction drafts waiting for user accept/reject */
  unresolvedDraftCount: number;
  /** ISO date of the most recent net-worth snapshot; null if never run */
  lastSnapshotAt: string | null;
  /** age of the last net-worth snapshot in days; null if never run */
  lastSnapshotDaysAgo: number | null;
  /**
   * Overall confidence signal for advisory features to consume.
   * "high": all active accounts fresh (≤ 7 days), no unresolved drafts, snapshot ≤ 7 days.
   * "medium": no account missing or > 30 days stale, drafts ≤ 5, snapshot present and ≤ 30 days.
   * "low": any account missing or > 30 days stale, or drafts > 5, or snapshot never run or > 30 days.
   */
  confidence: "high" | "medium" | "low";
  /** human-readable summary of why confidence is not "high" */
  confidenceReasons: string[];
}

// ---------------------------------------------------------------------------
// Pure confidence computation (exported for unit testing without a DB)
// ---------------------------------------------------------------------------

export function computeConfidence(params: {
  accounts: Pick<
    AccountReadiness,
    "accountName" | "lastImportDaysAgo" | "lastValuationDaysAgo" | "dataFreshness"
  >[];
  unresolvedDraftCount: number;
  lastSnapshotDaysAgo: number | null;
}): { confidence: DataCompletenessReport["confidence"]; confidenceReasons: string[] } {
  const reasons: string[] = [];

  // Collect per-account reasons
  for (const acc of params.accounts) {
    if (acc.dataFreshness === "missing") {
      reasons.push(`${acc.accountName} has no import data`);
    } else if (acc.dataFreshness === "stale") {
      const daysAgo = acc.lastImportDaysAgo ?? acc.lastValuationDaysAgo ?? 0;
      reasons.push(`${acc.accountName} is ${daysAgo} days stale`);
    } else if (
      (acc.lastImportDaysAgo !== null && acc.lastImportDaysAgo > 7) ||
      (acc.lastValuationDaysAgo !== null && acc.lastValuationDaysAgo > 7)
    ) {
      const daysAgo = acc.lastImportDaysAgo ?? acc.lastValuationDaysAgo ?? 0;
      reasons.push(`${acc.accountName} is ${daysAgo} days since last update`);
    }
  }

  // Draft reasons
  if (params.unresolvedDraftCount > 0) {
    const n = params.unresolvedDraftCount;
    reasons.push(`${n} unresolved AI-extracted draft${n === 1 ? "" : "s"}`);
  }

  // Snapshot reasons
  if (params.lastSnapshotDaysAgo === null) {
    reasons.push("No net-worth snapshot found");
  } else if (params.lastSnapshotDaysAgo > 7) {
    reasons.push(`Net-worth snapshot is ${params.lastSnapshotDaysAgo} days old`);
  }

  // ---- "high" ----------------------------------------------------------------
  // All accounts fresh (≤ 7 days), no drafts, snapshot ≤ 7 days.
  const allAccountsHighFresh = params.accounts.every(
    (a) =>
      a.dataFreshness === "fresh" &&
      (a.lastImportDaysAgo === null || a.lastImportDaysAgo <= 7) &&
      (a.lastValuationDaysAgo === null || a.lastValuationDaysAgo <= 7),
  );
  const noDrafts = params.unresolvedDraftCount === 0;
  const snapshotHighFresh =
    params.lastSnapshotDaysAgo !== null && params.lastSnapshotDaysAgo <= 7;

  if (allAccountsHighFresh && noDrafts && snapshotHighFresh) {
    return { confidence: "high", confidenceReasons: [] };
  }

  // ---- "low" -----------------------------------------------------------------
  // Any account missing or > 30 days stale, or drafts > 5, or snapshot never run.
  const anyMissingOrStale = params.accounts.some(
    (a) => a.dataFreshness === "missing" || a.dataFreshness === "stale",
  );
  const tooManyDrafts = params.unresolvedDraftCount > 5;
  const snapshotMissing = params.lastSnapshotDaysAgo === null;

  if (anyMissingOrStale || tooManyDrafts || snapshotMissing) {
    return { confidence: "low", confidenceReasons: reasons };
  }

  // ---- "medium" --------------------------------------------------------------
  return { confidence: "medium", confidenceReasons: reasons };
}

// ---------------------------------------------------------------------------
// Investment account types that may have holding valuations
// ---------------------------------------------------------------------------

const INVESTMENT_TYPES = new Set(["investment", "ppf", "epf", "nps", "ssy"]);

// ---------------------------------------------------------------------------
// Main report assembly
// ---------------------------------------------------------------------------

/**
 * Build a data-freshness report for all of the user's active accounts.
 *
 * OWNER-ONLY SCOPING: Results are filtered strictly on `userId` — only
 * accounts owned by this user are included in the readiness report.
 * `withSharing` (lib/sharing.ts) is deliberately NOT used because it
 * currently has zero production call sites anywhere in the codebase. Making
 * this function sharing-aware would be inconsistent with every other
 * user-facing query. This decision is reversible and tracked for a future
 * sharing-rollout task (task 061). Household-shared accounts visible elsewhere
 * in the household UI are therefore silently omitted from readiness reporting.
 *
 * @param today Optional override for "now" — a determinism seam for tests.
 *              Not exposed via the HTTP route; clients always get the server's
 *              current date.
 */
export async function getDataCompletenessReport(
  db: Db,
  userId: string,
  today?: Date,
): Promise<DataCompletenessReport> {
  const now = today ?? new Date();
  const asOf = now.toISOString().slice(0, 10);

  // Step 1 — active (non-archived, non-system) accounts
  const userAccounts = await db.query.accounts.findMany({
    where: and(eq(accounts.userId, userId), isNull(accounts.archivedAt)),
    columns: { id: true, name: true, type: true },
  });
  // Exclude system accounts (expenses/income/opening/clearing virtual accounts)
  const activeAccounts = userAccounts.filter((a) => a.type !== "system");

  // Step 2 — most recent committed import per account (YYYY-MM-DD)
  const importRows = await db
    .select({
      accountId: imports.accountId,
      lastImportedAt: sql<string | null>`to_char(max(${imports.createdAt}), 'YYYY-MM-DD')`,
    })
    .from(imports)
    .where(and(eq(imports.userId, userId), eq(imports.status, "committed")))
    .groupBy(imports.accountId);

  const importMap = new Map<string, string>(
    importRows
      .filter((r): r is { accountId: string; lastImportedAt: string } => r.lastImportedAt !== null)
      .map((r) => [r.accountId, r.lastImportedAt]),
  );

  // Step 3 — most recent reconciliation's unmatchedCount for credit-card accounts
  const reconRows = await db
    .select({
      accountId: statementReconciliations.accountId,
      unmatchedCount: statementReconciliations.unmatchedCount,
      period: statementReconciliations.period,
    })
    .from(statementReconciliations)
    .where(eq(statementReconciliations.userId, userId))
    .orderBy(desc(statementReconciliations.period));

  // Keep only the most recent period per account (rows are ordered desc by period)
  const reconMap = new Map<string, number>();
  for (const row of reconRows) {
    if (!reconMap.has(row.accountId)) {
      reconMap.set(row.accountId, row.unmatchedCount);
    }
  }

  // Step 4 — most recent holding valuation (user-scoped; holdings have no accountId FK)
  const valuationRows = await db
    .select({
      lastValuationAt: sql<string | null>`max(${holdingValuations.date})`,
    })
    .from(holdingValuations)
    .innerJoin(holdings, eq(holdingValuations.holdingId, holdings.id))
    .where(eq(holdings.userId, userId));

  const lastValuationAt: string | null = valuationRows[0]?.lastValuationAt ?? null;

  // Step 5 — unresolved AI-extracted drafts
  const draftRows = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(extractedTransactions)
    .where(
      and(eq(extractedTransactions.userId, userId), eq(extractedTransactions.status, "pending")),
    );

  const unresolvedDraftCount: number = draftRows[0]?.count ?? 0;

  // Step 6 — most recent net-worth snapshot date (YYYY-MM-DD)
  const snapshotRows = await db
    .select({
      lastDate: sql<string | null>`max(${netWorthSnapshots.date})`,
    })
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.userId, userId));

  const lastSnapshotAt: string | null = snapshotRows[0]?.lastDate ?? null;

  // Step 7 — assemble AccountReadiness per account
  const accountReadiness: AccountReadiness[] = activeAccounts.map((acc) => {
    const lastImportedAt = importMap.get(acc.id) ?? null;
    const lastImportDaysAgo =
      lastImportedAt !== null
        ? Math.floor((now.getTime() - new Date(lastImportedAt).getTime()) / 86_400_000)
        : null;

    const isInvestment = INVESTMENT_TYPES.has(acc.type);
    const accLastValuationAt = isInvestment ? lastValuationAt : null;
    const lastValuationDaysAgo =
      accLastValuationAt !== null
        ? Math.floor((now.getTime() - new Date(accLastValuationAt).getTime()) / 86_400_000)
        : null;

    const unmatchedStatementLines =
      acc.type === "credit_card" ? (reconMap.get(acc.id) ?? null) : null;

    // dataFreshness: missing → no data ever; stale → oldest data > 30 days; fresh → otherwise
    const hasNoData = lastImportedAt === null && accLastValuationAt === null;
    let dataFreshness: "fresh" | "stale" | "missing";
    if (hasNoData) {
      dataFreshness = "missing";
    } else {
      const availableDays = [lastImportDaysAgo, lastValuationDaysAgo].filter(
        (d): d is number => d !== null,
      );
      const oldestDaysAgo = availableDays.length > 0 ? Math.max(...availableDays) : 0;
      dataFreshness = oldestDaysAgo > 30 ? "stale" : "fresh";
    }

    return {
      accountId: acc.id,
      accountName: acc.name,
      accountType: acc.type,
      lastImportedAt,
      lastImportDaysAgo,
      unmatchedStatementLines,
      lastValuationAt: accLastValuationAt,
      lastValuationDaysAgo,
      dataFreshness,
    };
  });

  // Step 8 — compute confidence
  const lastSnapshotDaysAgo =
    lastSnapshotAt !== null
      ? Math.floor((now.getTime() - new Date(lastSnapshotAt).getTime()) / 86_400_000)
      : null;

  const { confidence, confidenceReasons } = computeConfidence({
    accounts: accountReadiness,
    unresolvedDraftCount,
    lastSnapshotDaysAgo,
  });

  return {
    asOf,
    accounts: accountReadiness,
    unresolvedDraftCount,
    lastSnapshotAt,
    lastSnapshotDaysAgo,
    confidence,
    confidenceReasons,
  };
}
