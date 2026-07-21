import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  AcceptExtractedTxn,
  AcceptTransfer,
  ExtractedTransaction,
  ExtractedTxnReviewStatus,
} from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { accounts, categories, emailIngestions, extractedTransactions, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { createTransaction } from "./transactions.ts";
import { autoLinkTransfers, linkTransfer, TRANSFER_WINDOW_DAYS } from "./transfers.ts";

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
  matchedTransactionId: string | null;
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
    matchedTransactionId: row.matchedTransactionId,
    // filled in by listInbox for pending drafts; a plain row has no partner
    transferPartnerId: null,
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
  matchedTransactionId: extractedTransactions.matchedTransactionId,
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
  // Only pending drafts get reviewed, so only they need the pre-fill work.
  if (status === "pending") {
    await applyHistoryCategory(db, userId, dtos);
    const pairs = pickTransferPairs(dtos);
    for (const d of dtos) d.transferPartnerId = pairs.get(d.id) ?? null;
  }
  return dtos;
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

  // Same as the CSV-import path: a card payment (credit) that matches a debit on
  // the paying account becomes a transfer, not income. Runs after commit.
  await autoLinkTransfers(db, userId);
  return reload(db, userId, id);
}

/**
 * Claim one pending draft inside a transaction: flip it to `accepted` only if
 * it's still `pending` (row-locked so racing requests can't both win), and
 * report back what it was. Missing → 404, already-settled → 409.
 */
async function claimPending(db: DbOrTx, userId: string, id: string) {
  const [claimed] = await db
    .update(extractedTransactions)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(
      and(
        eq(extractedTransactions.id, id),
        eq(extractedTransactions.userId, userId),
        eq(extractedTransactions.status, "pending"),
      ),
    )
    .returning({
      amountPaise: extractedTransactions.amountPaise,
      direction: extractedTransactions.direction,
    });
  if (!claimed) {
    const [exists] = await db
      .select({ id: extractedTransactions.id })
      .from(extractedTransactions)
      .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    throw new HttpError(exists ? 409 : 404, exists ? "Draft is not pending" : "Draft not found");
  }
  return claimed;
}

/**
 * Accept two paired drafts as one account-to-account transfer: create the debit
 * leg on `fromAccountId` and the credit leg on `toAccountId`, then link them so
 * the movement never shows up as income + expense. The amount comes from the
 * drafts, not the client. All-or-nothing in a single transaction; both drafts
 * are claimed the same race-safe way an ordinary accept is.
 */
export async function acceptTransfer(
  db: Db,
  userId: string,
  input: AcceptTransfer,
): Promise<ExtractedTransaction[]> {
  if (input.fromAccountId === input.toAccountId) {
    throw new HttpError(400, "A transfer needs two different accounts");
  }
  if (input.outId === input.inId) {
    throw new HttpError(400, "A transfer needs two different drafts");
  }

  await db.transaction(async (tx) => {
    const out = await claimPending(tx, userId, input.outId);
    const inn = await claimPending(tx, userId, input.inId);
    if (out.direction !== "debit" || inn.direction !== "credit") {
      throw new HttpError(400, "A transfer is a debit leg paired with a credit leg");
    }
    if (out.amountPaise !== inn.amountPaise) {
      throw new HttpError(400, "Transfer legs must be equal amounts");
    }

    // Ownership is re-checked inside createTransaction; the names are just for labels.
    const [fromAcct, toAcct] = await Promise.all([
      tx.query.accounts.findFirst({
        where: and(eq(accounts.id, input.fromAccountId), eq(accounts.userId, userId)),
        columns: { name: true },
      }),
      tx.query.accounts.findFirst({
        where: and(eq(accounts.id, input.toAccountId), eq(accounts.userId, userId)),
        columns: { name: true },
      }),
    ]);

    const outTxn = await createTransaction(tx, userId, {
      accountId: input.fromAccountId,
      date: input.occurredAt,
      amountPaise: -out.amountPaise,
      merchant: toAcct ? `Transfer to ${toAcct.name}` : "Transfer out",
      categoryId: null,
      notes: "Transfer imported from email",
      tags: [],
      source: "import",
    });
    const inTxn = await createTransaction(tx, userId, {
      accountId: input.toAccountId,
      date: input.occurredAt,
      amountPaise: inn.amountPaise,
      merchant: fromAcct ? `Transfer from ${fromAcct.name}` : "Transfer in",
      categoryId: null,
      notes: "Transfer imported from email",
      tags: [],
      source: "import",
    });
    await linkTransfer(tx, userId, outTxn.id, inTxn.id, false);

    await tx
      .update(extractedTransactions)
      .set({ transactionId: outTxn.id })
      .where(and(eq(extractedTransactions.id, input.outId), eq(extractedTransactions.userId, userId)));
    await tx
      .update(extractedTransactions)
      .set({ transactionId: inTxn.id })
      .where(and(eq(extractedTransactions.id, input.inId), eq(extractedTransactions.userId, userId)));
  });

  return Promise.all([reload(db, userId, input.outId), reload(db, userId, input.inId)]);
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

/**
 * Un-match a `duplicate` draft back to `pending` — the reviewer says this
 * statement line isn't actually the same as the ledger transaction it was tied
 * to, so it should be reviewed and accepted like any other draft. Clears the link.
 */
export async function unmatchDuplicate(
  db: Db,
  userId: string,
  id: string,
): Promise<ExtractedTransaction> {
  const draft = await loadOne(db, userId, id);
  if (draft.status !== "duplicate") throw new HttpError(409, "Draft is not a matched duplicate");
  await db
    .update(extractedTransactions)
    .set({ status: "pending", matchedTransactionId: null, updatedAt: new Date() })
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  return reload(db, userId, id);
}
