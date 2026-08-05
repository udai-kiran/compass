import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AcceptExtractedTxn, ExtractedTransaction } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { emailIngestions, extractedTransactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { autoLinkTransfers } from "../../ledger/services/transfers.ts";
import { reload, toDto } from "./inbox-shared.ts";

/** State-machine actions on a review-inbox draft: accept, restore, reject, unmatch. */

async function loadOne(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(extractedTransactions)
    .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
  if (!row) throw new HttpError(404, "Draft not found");
  return row;
}

/**
 * Build the response DTO directly from a guarded UPDATE's `RETURNING` row
 * (full `extracted_transactions` columns) plus a follow-up ingestion fetch
 * for the denormalized subject/from/receivedAt — never a post-hoc `reload`
 * of live state. This matters for restore/reject: reloading after commit
 * could observe a concurrent operation that claimed the row in the interim
 * (e.g. a restore immediately re-accepted), making the endpoint report a
 * status the caller's own request never produced. The `RETURNING` row is the
 * state as of this call's own claim, and that's what's reported.
 */
async function dtoFromRow(
  db: DbOrTx,
  row: typeof extractedTransactions.$inferSelect,
): Promise<ExtractedTransaction> {
  const [ing] = await db
    .select({
      subject: emailIngestions.subject,
      fromAddr: emailIngestions.fromAddr,
      receivedAt: emailIngestions.receivedAt,
    })
    .from(emailIngestions)
    .where(and(eq(emailIngestions.id, row.ingestionId), eq(emailIngestions.userId, row.userId)));
  return toDto({
    ...row,
    subject: ing?.subject ?? "",
    fromAddr: ing?.fromAddr ?? "",
    receivedAt: ing?.receivedAt ?? null,
  });
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
      .returning({
        bankRef: extractedTransactions.bankRef,
        occurredAtTs: extractedTransactions.occurredAtTs,
      });
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
      // Keep the alert's precise instant so a later statement line matches on it.
      occurredAt: claimed.occurredAtTs,
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
 * Restore an orphaned accepted draft — `status = 'accepted'` with a null
 * `transaction_id` (its ledger transaction was hard-deleted) — back to
 * `pending` so a human re-reviews and re-accepts it. A single guarded
 * UPDATE, not load-then-write: only a row that is still `accepted` with a
 * null `transaction_id` matches the predicate, so two concurrent restores
 * can't both win (row locking serializes them — the second finds nothing
 * left to claim), and a restore racing an in-flight reject is decided by the
 * WHERE predicate re-evaluated at claim time, never by a stale read. Zero
 * rows updated means either the draft doesn't exist (404) or it isn't an
 * orphaned accept — already pending/rejected/duplicate, or a healthy accept
 * with a live transaction (409).
 *
 * Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it
 * an ordinary pending draft — no stored transfer pairing is resurrected
 * (hard-deleting one leg already cascaded away the `transfer_links` row). If
 * its partner is also orphaned and later restored, `pickTransferPairs`
 * re-pairs them heuristically from `listInbox("pending")`, exactly like any
 * other pending debit/credit pair, only when uniquely matchable. If the
 * partner's transaction still exists, the partner stays `accepted` and the
 * restored leg is reviewed alone as an ordinary draft.
 */
export async function restoreOrphan(db: DbOrTx, userId: string, id: string): Promise<ExtractedTransaction> {
  const [claimed] = await db
    .update(extractedTransactions)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(extractedTransactions.id, id),
        eq(extractedTransactions.userId, userId),
        eq(extractedTransactions.status, "accepted"),
        isNull(extractedTransactions.transactionId),
      ),
    )
    .returning();
  if (!claimed) {
    const [exists] = await db
      .select({ id: extractedTransactions.id })
      .from(extractedTransactions)
      .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    throw new HttpError(exists ? 409 : 404, exists ? "Draft is not an orphaned accept" : "Draft not found");
  }
  return dtoFromRow(db, claimed);
}

/**
 * Dismiss a draft. Guarded atomic UPDATE (not load-then-write): matches
 * `pending`/`duplicate` rows, or an orphaned accept (`accepted` with a null
 * `transaction_id`) — never a healthy `accepted` row whose ledger
 * transaction still exists. This closes a check-then-act race the previous
 * load-then-write shape had: a reject that read an orphaned accept could
 * otherwise land *after* a concurrent restore→accept re-created its
 * transaction, detaching a live ledger transaction from its draft. Under the
 * guarded predicate, that reject instead finds nothing left to claim (the
 * row is no longer `accepted with null transaction_id`) and 409s. Zero rows
 * updated means either the draft doesn't exist (404) or it's a healthy
 * accepted row (409). Response built from `RETURNING` + ingestion fetch, as
 * in `restoreOrphan` — never a post-hoc reload.
 */
export async function rejectExtracted(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<ExtractedTransaction> {
  const [claimed] = await db
    .update(extractedTransactions)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(extractedTransactions.id, id),
        eq(extractedTransactions.userId, userId),
        or(
          inArray(extractedTransactions.status, ["pending", "duplicate"]),
          and(eq(extractedTransactions.status, "accepted"), isNull(extractedTransactions.transactionId)),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    const [exists] = await db
      .select({ id: extractedTransactions.id })
      .from(extractedTransactions)
      .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    throw new HttpError(exists ? 409 : 404, exists ? "Draft was already accepted" : "Draft not found");
  }
  return dtoFromRow(db, claimed);
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
