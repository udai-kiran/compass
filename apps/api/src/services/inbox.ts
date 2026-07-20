import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AcceptExtractedTxn, ExtractedTransaction, ExtractedTxnReviewStatus } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { categories, emailIngestions, extractedTransactions, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { createTransaction } from "./transactions.ts";

/**
 * Review inbox for AI-extracted transactions. Rows land here as `pending` drafts
 * from the extractor, pre-filled with an account and a category; a human confirms
 * (creating a ledger transaction) or rejects. The category is chosen history-first
 * — the one the user has filed this merchant under before — and falls back to the
 * extractor's AI guess for a first-time merchant. Both are only suggestions the
 * reviewer can change; nothing is auto-posted.
 */

function toDto(row: {
  id: string;
  ingestionId: string;
  amountPaise: number;
  direction: "debit" | "credit";
  occurredAt: string | null;
  counterparty: string;
  suggestedAccountId: string | null;
  suggestedCategoryId: string | null;
  bankRef: string | null;
  sourceQuote: string;
  confidence: number | null;
  status: ExtractedTxnReviewStatus;
  transactionId: string | null;
  createdAt: Date;
  subject: string;
  fromAddr: string;
  receivedAt: Date | null;
}): ExtractedTransaction {
  return {
    id: row.id,
    ingestionId: row.ingestionId,
    amountPaise: row.amountPaise,
    direction: row.direction,
    occurredAt: row.occurredAt,
    counterparty: row.counterparty,
    suggestedAccountId: row.suggestedAccountId,
    suggestedCategoryId: row.suggestedCategoryId,
    bankRef: row.bankRef,
    sourceQuote: row.sourceQuote,
    confidence: row.confidence ?? 0,
    status: row.status,
    transactionId: row.transactionId,
    createdAt: row.createdAt.toISOString(),
    subject: row.subject,
    fromAddr: row.fromAddr,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
  };
}

/** Column projection joining a draft to its source email — used by every read. */
const INBOX_COLUMNS = {
  id: extractedTransactions.id,
  ingestionId: extractedTransactions.ingestionId,
  amountPaise: extractedTransactions.amountPaise,
  direction: extractedTransactions.direction,
  occurredAt: extractedTransactions.occurredAt,
  counterparty: extractedTransactions.counterparty,
  suggestedAccountId: extractedTransactions.suggestedAccountId,
  suggestedCategoryId: extractedTransactions.suggestedCategoryId,
  bankRef: extractedTransactions.bankRef,
  sourceQuote: extractedTransactions.sourceQuote,
  confidence: extractedTransactions.confidence,
  status: extractedTransactions.status,
  transactionId: extractedTransactions.transactionId,
  createdAt: extractedTransactions.createdAt,
  subject: emailIngestions.subject,
  fromAddr: emailIngestions.fromAddr,
  receivedAt: emailIngestions.receivedAt,
} as const;

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
  // Only pending drafts get reviewed, so only they need a category pre-fill.
  if (status === "pending") await applyHistoryCategory(db, userId, dtos);
  return dtos;
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

async function loadOne(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(extractedTransactions)
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  if (!row) throw new HttpError(404, "Draft not found");
  return row;
}

async function reload(db: Db, userId: string, id: string): Promise<ExtractedTransaction> {
  const [row] = await db
    .select(INBOX_COLUMNS)
    .from(extractedTransactions)
    .innerJoin(emailIngestions, eq(extractedTransactions.ingestionId, emailIngestions.id))
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  if (!row) throw new HttpError(404, "Draft not found");
  return toDto(row);
}

/**
 * Accept a draft into the ledger. `debit` becomes a negative (outflow) amount,
 * `credit` a positive (inflow) one. It carries the category the reviewer
 * confirmed (the AI's guess, editable) — or none if they cleared it.
 *
 * Concurrency-safe: the whole thing runs in one transaction that first *claims*
 * the draft with `UPDATE … WHERE status = 'pending' RETURNING`. Row locking
 * means only one of two racing requests matches the still-pending row; the other
 * matches nothing and 409s, so a draft can never be double-posted. If creating
 * the ledger transaction fails, the transaction rolls back and the draft stays
 * pending.
 */
export async function acceptExtracted(
  db: Db,
  userId: string,
  id: string,
  input: AcceptExtractedTxn,
): Promise<ExtractedTransaction> {
  const signed = input.direction === "debit" ? -input.amountPaise : input.amountPaise;

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(extractedTransactions)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(extractedTransactions.id, id),
          eq(extractedTransactions.userId, userId),
          eq(extractedTransactions.status, "pending"),
        ),
      )
      .returning({ bankRef: extractedTransactions.bankRef });
    if (!claimed) {
      // Nothing to claim: the draft is missing, or already settled / lost a race.
      const [exists] = await tx
        .select({ id: extractedTransactions.id })
        .from(extractedTransactions)
        .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
      throw new HttpError(exists ? 409 : 404, exists ? "Draft is not pending" : "Draft not found");
    }

    const txn = await createTransaction(tx, userId, {
      accountId: input.accountId,
      date: input.occurredAt,
      amountPaise: signed,
      merchant: input.merchant,
      // The reviewer's confirmed category (AI-guessed then editable); null if cleared.
      categoryId: input.categoryId ?? null,
      notes: claimed.bankRef ? `Imported from email · ref ${claimed.bankRef}` : "Imported from email",
      tags: [],
      source: "import",
    });

    await tx
      .update(extractedTransactions)
      .set({ transactionId: txn.id })
      .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  });

  return reload(db, userId, id);
}

export async function rejectExtracted(
  db: Db,
  userId: string,
  id: string,
): Promise<ExtractedTransaction> {
  const draft = await loadOne(db, userId, id);
  if (draft.status === "accepted") throw new HttpError(409, "Draft was already accepted");
  await db
    .update(extractedTransactions)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  return reload(db, userId, id);
}
