import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ExtractedTransaction, ExtractedTxnReviewStatus } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { emailIngestions, extractedTransactions } from "../schema.ts";
import { categories, transactions } from "../../../db/schema.ts";
import { getMerchantRules, normalizeMerchant } from "../../ledger/services/merchants.ts";
import { TRANSFER_WINDOW_DAYS } from "../../ledger/services/transfers.ts";
import { INBOX_COLUMNS, toDto } from "./inbox-shared.ts";

/**
 * Review inbox for AI-extracted transactions. Rows land here as `pending` drafts
 * from the extractor, pre-filled with an account and a category; a human confirms
 * (creating a ledger transaction) or rejects. The category is chosen history-first
 * — the one the user has filed this merchant under before — and falls back to the
 * extractor's AI guess for a first-time merchant. Both are only suggestions the
 * reviewer can change; nothing is auto-posted.
 */

export async function listInbox(
  db: Db,
  userId: string,
  status: ExtractedTxnReviewStatus,
): Promise<ExtractedTransaction[]> {
  const rows = await db
    .select(INBOX_COLUMNS)
    .from(extractedTransactions)
    .innerJoin(emailIngestions, eq(extractedTransactions.ingestionId, emailIngestions.id))
    .where(and(eq(extractedTransactions.userId, userId), eq(extractedTransactions.status, status)))
    .orderBy(desc(extractedTransactions.createdAt));
  const dtos = rows.map(toDto);
  // Only pending drafts get reviewed, so only they need the pre-fill work.
  if (status === "pending") {
    await applyHistoryCategory(db, userId, dtos);
    const pairs = pickTransferPairs(dtos);
    for (const d of dtos) d.transferPartnerId = pairs.get(d.id) ?? null;
  }
  return dtos;
}

/**
 * Accepted drafts whose ledger transaction no longer exists — `status =
 * 'accepted'` but `transaction_id is null`, because the transaction it points
 * to was hard-deleted (`ON DELETE SET NULL`). Unlike `listInbox`, this is not
 * a queue of things to pre-fill and review for the first time (no history
 * category, no transfer pairing), so it's ordered `updatedAt DESC` — most
 * recently orphaned first — not `createdAt DESC`. A soft-deleted transaction
 * (`deleted_at` set, `transaction_id` still populated) is deliberately NOT an
 * orphan by this predicate; that's a separate recovery workflow.
 */
export async function listOrphanedAccepts(db: Db, userId: string): Promise<ExtractedTransaction[]> {
  const rows = await db
    .select({ ...INBOX_COLUMNS, updatedAt: extractedTransactions.updatedAt })
    .from(extractedTransactions)
    .innerJoin(emailIngestions, eq(extractedTransactions.ingestionId, emailIngestions.id))
    .where(
      and(
        eq(extractedTransactions.userId, userId),
        eq(extractedTransactions.status, "accepted"),
        isNull(extractedTransactions.transactionId),
      ),
    )
    .orderBy(desc(extractedTransactions.updatedAt));
  return rows.map(toDto);
}

/**
 * Find drafts that are the two legs of one account-to-account transfer: a debit
 * and a matching credit (equal amount, within the transfer window, not the same
 * known account). Only pairs a mutually-unique match — if a leg could pair with
 * more than one counterpart it's left alone rather than guessed, mirroring
 * autoLinkTransfers. Returns a symmetric id→partnerId map. Pure/testable.
 */
export function pickTransferPairs(
  drafts: {
    id: string;
    direction: "debit" | "credit";
    amountPaise: number;
    occurredAt: string | null;
    suggestedAccountId: string | null;
  }[],
  windowDays: number = TRANSFER_WINDOW_DAYS,
): Map<string, string> {
  const debits = drafts.filter((d) => d.direction === "debit" && d.occurredAt);
  const credits = drafts.filter((d) => d.direction === "credit" && d.occurredAt);
  const outCandidates = new Map<string, string[]>();
  const inCandidates = new Map<string, string[]>();
  for (const o of debits) {
    for (const i of credits) {
      if (o.amountPaise !== i.amountPaise) continue;
      // a debit and credit on the *same* known account isn't a transfer (e.g. a reversal)
      if (o.suggestedAccountId && i.suggestedAccountId && o.suggestedAccountId === i.suggestedAccountId) {
        continue;
      }
      const days = Math.abs(Date.parse(o.occurredAt!) - Date.parse(i.occurredAt!)) / 86_400_000;
      if (days > windowDays) continue;
      (outCandidates.get(o.id) ?? outCandidates.set(o.id, []).get(o.id)!).push(i.id);
      (inCandidates.get(i.id) ?? inCandidates.set(i.id, []).get(i.id)!).push(o.id);
    }
  }
  const pairs = new Map<string, string>();
  for (const [outId, ins] of outCandidates) {
    if (ins.length !== 1) continue; // this debit matches more than one credit — ambiguous
    const inId = ins[0]!;
    if ((inCandidates.get(inId) ?? []).length !== 1) continue; // that credit is claimed by others too
    pairs.set(outId, inId);
    pairs.set(inId, outId);
  }
  return pairs;
}

/** History key: a normalized merchant paired with the category kind it was filed under. */
export function historyKey(merchant: string, kind: "income" | "expense"): string {
  return `${merchant.toLowerCase()}\u0000${kind}`;
}

/**
 * From the user's own categorized history, the category they file each merchant
 * under most often (ties broken by most recent). Keyed by merchant + kind so a
 * spend and a refund from the same merchant resolve independently. Pure — the
 * DB read is the caller's, so the tally logic is unit-testable in isolation.
 */
export function pickHistoryCategories(
  rows: { merchant: string; categoryId: string; kind: "income" | "expense"; date: string }[],
): Map<string, string> {
  const tally = new Map<string, Map<string, { count: number; lastDate: string }>>();
  for (const r of rows) {
    const key = historyKey(r.merchant, r.kind);
    const byCat = tally.get(key) ?? new Map<string, { count: number; lastDate: string }>();
    const cur = byCat.get(r.categoryId) ?? { count: 0, lastDate: "" };
    cur.count += 1;
    if (r.date > cur.lastDate) cur.lastDate = r.date;
    byCat.set(r.categoryId, cur);
    tally.set(key, byCat);
  }
  const best = new Map<string, string>();
  for (const [key, byCat] of tally) {
    let winner: { id: string; count: number; lastDate: string } | null = null;
    for (const [id, s] of byCat) {
      if (
        !winner ||
        s.count > winner.count ||
        (s.count === winner.count && s.lastDate > winner.lastDate)
      ) {
        winner = { id, count: s.count, lastDate: s.lastDate };
      }
    }
    if (winner) best.set(key, winner.id);
  }
  return best;
}

/**
 * Prefer the category the user has used before for this merchant over the AI's
 * guess — most email alerts are repeat merchants, so their own past choice is
 * both cheaper and more accurate. Only overrides when there's a history hit;
 * otherwise the extractor's AI suggestion stands. Merchants are matched after
 * the same normalization the ledger stores, so "AMAZON PAY INDIA" lines up with
 * a saved "Amazon".
 */
async function applyHistoryCategory(
  db: Db,
  userId: string,
  dtos: ExtractedTransaction[],
): Promise<void> {
  const named = dtos.filter((d) => d.counterparty.trim());
  if (named.length === 0) return;
  const rules = await getMerchantRules(db, userId);
  const keyOf = new Map<string, string>();
  const merchants = new Set<string>();
  for (const d of named) {
    const merchant = normalizeMerchant(d.counterparty, rules);
    const kind = d.direction === "credit" ? "income" : "expense";
    keyOf.set(d.id, historyKey(merchant, kind));
    merchants.add(merchant);
  }
  const rows = await db
    .select({
      merchant: transactions.merchant,
      categoryId: transactions.categoryId,
      kind: categories.kind,
      date: transactions.date,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(categories.archivedAt),
        inArray(transactions.merchant, [...merchants]),
      ),
    );
  const best = pickHistoryCategories(
    rows.map((r) => ({ merchant: r.merchant, categoryId: r.categoryId!, kind: r.kind, date: r.date })),
  );
  for (const d of named) {
    const hit = best.get(keyOf.get(d.id)!);
    if (hit) d.suggestedCategoryId = hit;
  }
}

export async function countPending(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(extractedTransactions)
    .where(and(eq(extractedTransactions.userId, userId), eq(extractedTransactions.status, "pending")));
  return row?.n ?? 0;
}
