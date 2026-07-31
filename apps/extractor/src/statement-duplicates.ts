import type pg from "pg";
import { loadCardLedgerTxns, type SaveRow } from "./db.ts";
import { matchLinesToLedger, STATEMENT_MATCH_WINDOW_DAYS, type InboxRow } from "./extract.ts";

export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Flag statement lines that just re-list a spend already in the ledger (recorded
 * from a real-time alert during the cycle): match each to a ledger transaction
 * and mark the hits `duplicate` so they stay out of the pending review queue.
 * Matching runs against the card's ledger over the lines' own date span padded
 * by the posting-lag window — never the statement period — so a near-close spend
 * that bills next cycle isn't force-matched here. Non-matches pass through as
 * ordinary pending drafts.
 */
export async function annotateStatementDuplicates(
  pool: pg.Pool,
  rows: InboxRow[],
  userId: string,
): Promise<SaveRow[]> {
  const accountId = rows.find((r) => r.suggestedAccountId)?.suggestedAccountId ?? null;
  const dates = rows.map((r) => r.occurredAt).filter((d): d is string => d !== null);
  if (!accountId || dates.length === 0) return rows;
  const from = shiftIso(dates.reduce((a, b) => (a < b ? a : b)), -STATEMENT_MATCH_WINDOW_DAYS);
  const to = shiftIso(dates.reduce((a, b) => (a > b ? a : b)), STATEMENT_MATCH_WINDOW_DAYS);
  const ledger = await loadCardLedgerTxns(pool, userId, accountId, from, to);
  if (ledger.length === 0) return rows;
  const matched = matchLinesToLedger(
    rows.map((r) => ({
      amountPaise: r.amountPaise,
      direction: r.direction,
      occurredAt: r.occurredAt,
      occurredAtTs: r.occurredAtTs,
      counterparty: r.counterparty,
    })),
    ledger,
  );
  return rows.map((r, i) =>
    matched[i] ? { ...r, status: "duplicate" as const, matchedTransactionId: matched[i]! } : r,
  );
}
