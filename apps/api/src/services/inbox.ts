import { and, desc, eq, sql } from "drizzle-orm";
import type { AcceptExtractedTxn, ExtractedTransaction, ExtractedTxnReviewStatus } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { emailIngestions, extractedTransactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createTransaction } from "./transactions.ts";

/**
 * Review inbox for AI-extracted transactions. Rows land here as `pending` drafts
 * from the extractor; a human accepts (creating a ledger transaction — with no
 * category, which stays manual) or rejects. Nothing is auto-posted.
 */

function toDto(row: {
  id: string;
  ingestionId: string;
  amountPaise: number;
  direction: "debit" | "credit";
  occurredAt: string | null;
  counterparty: string;
  suggestedAccountId: string | null;
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
  return rows.map(toDto);
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
 * `credit` a positive (inflow) one. The created transaction carries no category
 * — categorization stays a manual step.
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
      categoryId: null,
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
