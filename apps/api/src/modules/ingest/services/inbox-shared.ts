import { and, eq } from "drizzle-orm";
import type { ExtractedTransaction, ExtractedTxnReviewStatus } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { emailIngestions, extractedTransactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

/**
 * Cross-unit helpers shared by ≥2 of the three inbox units (review-queue,
 * review-actions, transfer-classification) — see the split rationale and
 * import-edge design in `tasks/017-migrate-ingest/TASK.md`'s "inbox.ts split
 * design". `claimPending` is deliberately NOT here: its only two callers
 * (`acceptTransfer`, `acceptRepayment`) both live in
 * `transfer-classification.ts`, so it stays private to that file instead
 * (Codex review-1 B2) — `acceptExtracted` has its own inline claim and never
 * called it, even in the original monolithic `services/inbox.ts`.
 */

export function toDto(row: {
  id: string;
  ingestionId: string;
  amountPaise: number;
  direction: "debit" | "credit";
  occurredAt: string | null;
  counterparty: string;
  suggestedAccountId: string | null;
  suggestedCategoryId: string | null;
  intent: "repayment" | "refund" | "cashback" | null;
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
    intent: row.intent,
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
export const INBOX_COLUMNS = {
  id: extractedTransactions.id,
  ingestionId: extractedTransactions.ingestionId,
  amountPaise: extractedTransactions.amountPaise,
  direction: extractedTransactions.direction,
  occurredAt: extractedTransactions.occurredAt,
  counterparty: extractedTransactions.counterparty,
  suggestedAccountId: extractedTransactions.suggestedAccountId,
  suggestedCategoryId: extractedTransactions.suggestedCategoryId,
  intent: extractedTransactions.intent,
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

export async function reload(db: Db, userId: string, id: string): Promise<ExtractedTransaction> {
  const [row] = await db
    .select(INBOX_COLUMNS)
    .from(extractedTransactions)
    .innerJoin(emailIngestions, eq(extractedTransactions.ingestionId, emailIngestions.id))
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  if (!row) throw new HttpError(404, "Draft not found");
  return toDto(row);
}
