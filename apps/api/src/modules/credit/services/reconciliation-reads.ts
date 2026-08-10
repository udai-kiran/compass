import { and, desc, eq, sql } from "drizzle-orm";
import type { StatementReconciliation } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { statementReconciliations } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { ownedCardAccount } from "./cards.ts";

type ReconciliationRow = typeof statementReconciliations.$inferSelect;

/**
 * Drift between the issuer's stated `totalDuePaise` and what the ledger itself
 * says was due at the statement close: `totalDue − ledgerDue`. Positive means
 * the ledger is short (a carried-forward balance, or spend never captured
 * this cycle); negative means the ledger shows more owed than the statement
 * (a payment/refund not reflected in this cycle's lines). `null` unless both
 * inputs are known — a card with no statement date, or a statement that never
 * stated a total, has nothing to compare.
 */
export function dueDrift(totalDuePaise: number | null, ledgerDuePaise: number | null): number | null {
  if (totalDuePaise === null || ledgerDuePaise === null) return null;
  return totalDuePaise - ledgerDuePaise;
}

export interface DriftPresentation {
  kind: "none" | "shortfall" | "surplus" | "credit";
  /** only ever true for `shortfall` — a credit balance is never "carried forward" */
  carryForwardHint: boolean;
  /** true only for `shortfall`; a credit or surplus keeps the "all lines matched" badge */
  suppressCleared: boolean;
}

/**
 * Classifies a due-drift for display. `ledgerDuePaise < 0` (the ledger holds a
 * credit balance on this card) is checked BEFORE the drift sign: a credit
 * balance against a small/zero statement due still subtracts to a *positive*
 * `dueDrift`, but that is not a shortfall — the ledger has money in hand, not
 * a gap — so it is classified `credit` first and never folds into
 * `shortfall`'s "more due than the ledger shows" copy or carry-forward hint.
 */
export function driftPresentation(
  dueDriftPaise: number | null,
  ledgerDuePaise: number | null,
): DriftPresentation {
  if (dueDriftPaise === null || ledgerDuePaise === null) {
    return { kind: "none", carryForwardHint: false, suppressCleared: false };
  }
  if (ledgerDuePaise < 0) {
    return { kind: "credit", carryForwardHint: false, suppressCleared: false };
  }
  if (dueDriftPaise > 0) {
    return { kind: "shortfall", carryForwardHint: true, suppressCleared: true };
  }
  if (dueDriftPaise < 0) {
    return { kind: "surplus", carryForwardHint: false, suppressCleared: false };
  }
  return { kind: "none", carryForwardHint: false, suppressCleared: false };
}

/**
 * Maps a raw reconciliation row (+ its already-computed ledger due) to the API
 * DTO. Exported — an internal cross-module-file export required by the split
 * (`reconciliation-writes.ts` needs it for `recomputeReconciliation`/
 * `absorbCarryover`'s own enrichment), not a public API commitment.
 */
export function toReconciliationDto(
  r: ReconciliationRow,
  ledgerDuePaise: number | null,
): StatementReconciliation {
  const dueDriftPaise = dueDrift(r.totalDuePaise, ledgerDuePaise);
  if (dueDriftPaise !== null && !Number.isSafeInteger(dueDriftPaise)) {
    throw new HttpError(500, "Due drift aggregate exceeded a safe integer — refusing to lose paise");
  }
  return {
    id: r.id,
    accountId: r.accountId,
    period: r.period,
    statementDate: r.statementDate,
    totalDuePaise: r.totalDuePaise,
    minDuePaise: r.minDuePaise,
    rewardClosing: r.rewardClosing,
    lineCount: r.lineCount,
    lineDebitPaise: r.lineDebitPaise,
    matchedCount: r.matchedCount,
    matchedPaise: r.matchedPaise,
    unmatchedCount: r.unmatchedCount,
    deltaPaise: Math.max(0, r.lineDebitPaise - r.matchedPaise),
    ledgerDuePaise,
    dueDriftPaise,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Signed ledger balance at close — `−(opening + Σ tx dated before that
 * date)` — for each of `dates`, in ONE query regardless of how many distinct
 * dates are asked for (bounded per AC6: `listReconciliations` must not issue
 * one aggregate per row). Negative means the ledger shows this card in
 * credit; never clamped here (see `driftPresentation` for how a negative
 * value is presented). `date < statementDate` (strict) matches this card's
 * documented `[start, close)` cycle convention — a transaction dated exactly
 * on the close belongs to the *next* cycle. Scoped to `accountId` AND
 * `userId`, and excludes soft-deleted rows.
 *
 * Exported — an internal cross-module-file export required by the split
 * (`reconciliation-writes.ts` calls this for `recomputeReconciliation`'s and
 * `absorbCarryover`'s own ledger-due enrichment), not a public API
 * commitment. Reads directly from `../../../db/schema.ts`'s `transactions`
 * table (ledger-owned) via raw SQL, same as before the move.
 */
export async function ledgerDuesAtDates(
  db: DbOrTx,
  userId: string,
  accountId: string,
  openingBalancePaise: number,
  dates: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const distinct = [...new Set(dates)];
  if (distinct.length === 0) return result;
  const dateList = sql.join(
    distinct.map((d) => sql`${d}::date`),
    sql`, `,
  );
  const agg = await db.execute(sql`
    select ds.stmt_date::text as stmt_date,
      coalesce(sum(sub.amount_paise), 0)::bigint as sum_paise
    from unnest(array[${dateList}]) as ds(stmt_date)
    left join (
      select p.amount_paise, t.date
      from postings p
      join transactions t on t.id = p.transaction_id
      where p.account_id = ${accountId}
        and t.user_id = ${userId}
        and t.deleted_at is null
    ) sub on sub.date < ds.stmt_date
    group by ds.stmt_date
  `);
  for (const row of agg.rows as { stmt_date: string; sum_paise: string }[]) {
    const sum = Number(row.sum_paise);
    if (!Number.isSafeInteger(sum)) {
      throw new HttpError(500, "Ledger balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const ledgerDuePaise = -(openingBalancePaise + sum);
    if (!Number.isSafeInteger(ledgerDuePaise)) {
      throw new HttpError(500, "Ledger balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    result.set(row.stmt_date, ledgerDuePaise);
  }
  return result;
}

/**
 * A card's statement reconciliations, newest cycle first. `deltaPaise` — the
 * listed spend not yet cleared in the ledger — is derived here so the client
 * doesn't have to. Read-only; the extractor writes these when it processes a
 * statement (see apps/extractor: upsertReconciliation).
 *
 * `ledgerDuePaise`/`dueDriftPaise` compare the issuer's own total due against
 * the ledger's own balance at that statement's close, surfacing a
 * carried-forward balance or other ledger shortfall the statement's lines
 * never mention (see tasks/cc-recon-01-statement-drift). Bounded to at most
 * 3 total queries regardless of row count (AC6): ownership lookup, the
 * reconciliations themselves, and one aggregate over their distinct
 * statement dates.
 */
export async function listReconciliations(
  db: Db,
  userId: string,
  accountId: string,
): Promise<StatementReconciliation[]> {
  const acc = await ownedCardAccount(db, userId, accountId);
  const rows = await db.query.statementReconciliations.findMany({
    where: and(
      eq(statementReconciliations.userId, userId),
      eq(statementReconciliations.accountId, accountId),
    ),
    orderBy: [desc(statementReconciliations.period)],
    limit: 24,
  });
  const dates = rows.map((r) => r.statementDate).filter((d): d is string => d !== null);
  const ledgerDueByDate = await ledgerDuesAtDates(db, userId, accountId, acc.openingBalancePaise, dates);
  return rows.map((r) =>
    toReconciliationDto(r, r.statementDate !== null ? (ledgerDueByDate.get(r.statementDate) ?? null) : null),
  );
}

// ---------- statement reconciliation: pure recompute helpers ----------

/** One statement line plus the live ledger transaction it is tied to, if any. */
export interface StatementLineState {
  direction: "debit" | "credit";
  /** positive magnitude, as extracted */
  amountPaise: number;
  /** the live ledger transaction this line is tied to, or null when it isn't */
  ledgerTxnId: string | null;
}

/** Recomputed match stats over a statement's lines. Mirrors the extractor's shape. */
export interface RecomputedStats {
  lineCount: number;
  lineDebitPaise: number;
  matchedCount: number;
  matchedPaise: number;
  unmatchedCount: number;
  matchedTxnIds: string[];
}

/**
 * What the statement itself said — the issuer's own totals, as first extracted.
 * These are facts about the bill, not about our ledger, so a recompute preserves
 * them verbatim.
 */
export interface StatementFacts {
  lineCount: number;
  lineDebitPaise: number;
}

/**
 * Re-derive a cycle's match stats from the links recorded on its statement lines,
 * keeping the issuer's own totals untouched.
 *
 * This deliberately does NOT re-run fuzzy matching. The extractor matches once,
 * at extraction time, against the ledger as it stood then — so a statement that
 * arrives before its spends are accepted records zero matches forever. By then the
 * link is no longer a guess: the line was either auto-matched to a transaction or
 * accepted into one. Recomputing from that recorded link is both cheaper and more
 * truthful than guessing again.
 *
 * `lineCount` and `lineDebitPaise` are carried over from `facts` rather than
 * recounted, because the surviving lines are not the whole statement: the
 * extractor skips inserting a line whose spend was already captured from a
 * real-time alert (`on conflict (user_id, dedupe_hash) do nothing`). Recounting
 * would quietly replace what the issuer billed with whatever rows happen to
 * remain — on a fully-deduplicated statement, zero.
 *
 * A skipped line is therefore invisible here and counts as unmatched, which
 * overstates what is left to review rather than claiming a false all-clear.
 *
 * Only matched *debits* add to `matchedPaise`, exactly as the extractor does — a
 * cleared refund is not cleared spend and must not shrink the spend delta.
 */
export function summarizeStatementLines(
  facts: StatementFacts,
  lines: StatementLineState[],
): RecomputedStats {
  let matchedCount = 0;
  let matchedPaise = 0;
  const matchedTxnIds: string[] = [];
  for (const line of lines) {
    if (line.ledgerTxnId === null) continue;
    matchedCount += 1;
    if (line.direction === "debit") matchedPaise += line.amountPaise;
    matchedTxnIds.push(line.ledgerTxnId);
  }
  return {
    lineCount: facts.lineCount,
    lineDebitPaise: facts.lineDebitPaise,
    matchedCount,
    matchedPaise,
    // Never negative: a statement may carry more recorded links than the issuer
    // listed lines if a line was re-extracted after a replay.
    unmatchedCount: Math.max(0, facts.lineCount - matchedCount),
    matchedTxnIds,
  };
}
