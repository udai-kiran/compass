import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type {
  AcceptExtractedTxn,
  AcceptRepayment,
  AcceptTransfer,
  ExtractedTransaction,
  ExtractedTxnReviewStatus,
} from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import {
  accounts,
  categories,
  emailIngestions,
  extractedTransactions,
  transactions,
  transferLinks,
} from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { getMerchantRules, normalizeMerchant } from "../modules/ledger/services/merchants.ts";
import { isUniqueViolation } from "../modules/investments/services/sip-lifecycle.ts";
import { createTransaction } from "../modules/ledger/services/transactions.ts";
import { autoLinkTransfers, linkTransfer, TRANSFER_WINDOW_DAYS } from "../modules/ledger/services/transfers.ts";

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
const INBOX_COLUMNS = {
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
      occurredAtTs: extractedTransactions.occurredAtTs,
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
      occurredAt: out.occurredAtTs,
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
      occurredAt: inn.occurredAtTs,
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

/** What to do with a repayment's paying-account leg, given its existing candidates. */
export type RepaymentCandidateSelection =
  | { kind: "create" }
  | { kind: "reuse"; id: string }
  | { kind: "ambiguous"; count: number };

/**
 * Pure 0/1/many selection rule for `acceptRepayment`'s candidate detection: no
 * existing eligible debit means create one; exactly one means reuse it (never
 * touch it); two or more is refused rather than guessed, mirroring
 * `autoLinkTransfers`'s refusal to link an ambiguous pair. Takes only `id`s so
 * it's testable without a database — the SQL eligibility predicate itself
 * (amount/window/user/link-state filtering) is covered separately by DB-backed
 * tests.
 */
export function selectRepaymentCandidate(candidates: { id: string }[]): RepaymentCandidateSelection {
  if (candidates.length === 0) return { kind: "create" };
  if (candidates.length === 1) return { kind: "reuse", id: candidates[0]!.id };
  return { kind: "ambiguous", count: candidates.length };
}

/**
 * Accept a single card-repayment draft (a credit alert on the card) as a
 * transfer, instead of a plain categorized inflow. This is what fixes the
 * double-counted spend: `acceptExtracted` would book the card credit alone,
 * leaving the paying account's own debit (a real ledger row, from a statement
 * import or another alert) counted as ordinary expense on top of the card
 * purchases it repays. Linking both legs excludes both from income/expense.
 *
 * There is no `draftId` in the input — the draft is identified by the route
 * path only — and the amount always comes from the claimed draft, never the
 * client, so the ledger entry can't be severed from the alert that justifies
 * it (no amount override, even for a partial payment).
 *
 * Candidate detection (mirrors `suggestTransfers`, `transfers.ts:37-66`, so
 * the two agree by construction): look for an existing, unlinked debit on
 * `fromAccountId` that is exactly this repayment — opposite integer paise,
 * not soft-deleted, not an opening balance, not already linked, within
 * `TRANSFER_WINDOW_DAYS` of the reviewer's confirmed date. Zero candidates
 * creates the paying-account leg; exactly one is reused untouched (its
 * amount, date, timestamp, merchant and category are never written to);
 * two or more refuses with a 409 naming the count rather than guessing which
 * one is right.
 *
 * The candidate read is not itself an atomic claim — another request could
 * link the same candidate between this SELECT and the `linkTransfer` INSERT.
 * Deliberately not using `SELECT ... FOR UPDATE` here: other `linkTransfer`
 * callers (`transfers.ts:75-98`, `autoLinkTransfers`) never take that lock,
 * so it wouldn't exclude them. The real atomic claim is the `transfer_links`
 * insert itself — `transfer_links_out_transaction_id_unique` guarantees only
 * one link can ever commit for a given out-leg — so the race is resolved by
 * catching that specific unique-violation *outside* the aborted transaction
 * and reporting a defined 409, instead of letting a raw Postgres error escape
 * as a 500.
 *
 * Timestamp/date provenance: newly created legs take the reviewer's `date`
 * (the in leg always; the out leg only in the zero-candidate branch). The in
 * (card) leg also carries the draft's precise `occurredAtTs` — the alert
 * genuinely describes this side. The synthetic out leg gets `occurredAt:
 * null`: there's no paying-side timestamp evidence, and inventing one would
 * block a later paying-account statement line from deduplicating against it.
 *
 * Does NOT call `autoLinkTransfers` afterward — the pair is already
 * explicitly linked, and an auto-link pass could incidentally link unrelated
 * candidates elsewhere in the ledger.
 */
export async function acceptRepayment(
  db: Db,
  userId: string,
  id: string,
  input: AcceptRepayment,
): Promise<ExtractedTransaction> {
  if (input.fromAccountId === input.cardAccountId) {
    throw new HttpError(400, "The paying account must be different from the card");
  }

  try {
    await db.transaction(async (tx) => {
      const claimed = await claimPending(tx, userId, id);
      if (claimed.direction !== "credit") {
        throw new HttpError(400, "A repayment must be a credit draft");
      }

      // Validate both accounts before creating either leg. A foreign account
      // (owned by another user) is 404, never grouped with the 400 cases below.
      const [cardAcct, fromAcct] = await Promise.all([
        tx.query.accounts.findFirst({
          where: and(eq(accounts.id, input.cardAccountId), eq(accounts.userId, userId)),
          columns: { id: true, name: true, type: true, archivedAt: true },
        }),
        tx.query.accounts.findFirst({
          where: and(eq(accounts.id, input.fromAccountId), eq(accounts.userId, userId)),
          columns: { id: true, name: true, type: true, archivedAt: true },
        }),
      ]);
      if (!cardAcct || !fromAcct) throw new HttpError(404, "Account not found");
      if (cardAcct.type !== "credit_card") {
        throw new HttpError(400, "The card account must be a credit card");
      }
      if (fromAcct.type === "credit_card") {
        throw new HttpError(400, "The paying account cannot be a credit card");
      }
      if (fromAcct.archivedAt) {
        throw new HttpError(400, "The paying account is archived");
      }

      const candidates = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.accountId, input.fromAccountId),
            eq(transactions.amountPaise, -claimed.amountPaise),
            isNull(transactions.deletedAt),
            eq(transactions.isOpening, false),
            sql`abs(${transactions.date} - ${input.occurredAt}::date) <= ${TRANSFER_WINDOW_DAYS}`,
            sql`not exists (select 1 from ${transferLinks} tl
              where tl.out_transaction_id = ${transactions.id} or tl.in_transaction_id = ${transactions.id})`,
          ),
        );
      const selection = selectRepaymentCandidate(candidates);
      if (selection.kind === "ambiguous") {
        throw new HttpError(
          409,
          `${selection.count} existing transactions on the paying account could be this repayment — link one manually instead`,
        );
      }

      const outTransactionId =
        selection.kind === "reuse"
          ? selection.id
          : (
              await createTransaction(tx, userId, {
                accountId: input.fromAccountId,
                date: input.occurredAt,
                occurredAt: null,
                amountPaise: -claimed.amountPaise,
                merchant: `Card repayment to ${cardAcct.name}`,
                categoryId: null,
                notes: "Imported from email",
                tags: [],
                source: "import",
              })
            ).id;

      const inTxn = await createTransaction(tx, userId, {
        accountId: input.cardAccountId,
        date: input.occurredAt,
        occurredAt: claimed.occurredAtTs,
        amountPaise: claimed.amountPaise,
        merchant: `Card repayment from ${fromAcct.name}`,
        categoryId: null,
        notes: "Imported from email",
        tags: [],
        source: "import",
      });

      await linkTransfer(tx, userId, outTransactionId, inTxn.id, false);

      await tx
        .update(extractedTransactions)
        .set({ transactionId: inTxn.id })
        .where(and(eq(extractedTransactions.id, id), eq(extractedTransactions.userId, userId)));
    });
  } catch (err) {
    if (isUniqueViolation(err, "transfer_links_out_transaction_id_unique")) {
      throw new HttpError(
        409,
        "That payment was linked to another transfer just now — reload and try again.",
      );
    }
    throw err;
  }

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
