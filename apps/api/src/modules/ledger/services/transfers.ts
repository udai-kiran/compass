import { and, eq, isNull, sql } from "drizzle-orm";
import type { CreateTransfer, TransferResult, TransferSuggestion } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { postings, transactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedRealAccount } from "../../../lib/ownership.ts";
import { mergeHeaderText, remapReferences, survivorOf } from "./collapse-transfer.ts";
import {
  currentPostings,
  postTransaction,
  resolveSystemAccounts,
  systemKindLookup,
} from "./post-entry.ts";
import {
  buildOrdinaryPostings,
  buildTransferPostings,
  classifyShape,
  primaryRealLeg,
} from "./postings.ts";

type CreateTransferInput = CreateTransfer;

/** Exact object shape passed to `createTransaction` for one leg of a transfer. */
type TransferLeg = {
  accountId: string;
  date: string;
  amountPaise: number;
  merchant: string;
  categoryId: null;
  notes: string;
  tags: string[];
};

export const TRANSFER_WINDOW_DAYS = 3;

/** Pure matcher used by suggestion logic and unit tests. */
export function isTransferPair(
  a: { accountId: string; amountPaise: number; date: string },
  b: { accountId: string; amountPaise: number; date: string },
  windowDays: number = TRANSFER_WINDOW_DAYS,
): boolean {
  if (a.accountId === b.accountId) return false;
  if (a.amountPaise + b.amountPaise !== 0) return false;
  const days = Math.abs(
    (Date.parse(a.date) - Date.parse(b.date)) / (24 * 60 * 60 * 1000),
  );
  return days <= windowDays;
}

/**
 * Candidate transfer pairs, entirely from postings.
 *
 * A candidate is an ordinary transaction — exactly one real posting and one
 * Expenses/Income counter. That single condition replaces the legacy query's
 * three separate exclusions (`is_opening`, `transfer_links` membership, and the
 * implicit assumption that `amount_paise` describes the row): an opening has an
 * Opening counter, an existing transfer has two real postings and no counter,
 * and a split has several counters, so none of them can match.
 */
export async function suggestTransfers(db: Db, userId: string): Promise<TransferSuggestion[]> {
  const rows = await db.execute(sql`
    with candidates as (
      select t.id, t.date, p.account_id, p.amount_paise
      from transactions t
      join postings p on p.transaction_id = t.id
      join accounts a on a.id = p.account_id and a.system_kind is null
      where t.user_id = ${userId}
        and t.deleted_at is null
        and (
          select count(*) from postings p2
          join accounts a2 on a2.id = p2.account_id
          where p2.transaction_id = t.id and a2.system_kind is null
        ) = 1
        and exists (
          select 1 from postings p3
          join accounts a3 on a3.id = p3.account_id
          where p3.transaction_id = t.id and a3.system_kind in ('expenses', 'income')
        )
    )
    select o.id as out_id, i.id as in_id, i.amount_paise as amount, abs(o.date - i.date) as days
    from candidates o
    join candidates i
      on i.account_id <> o.account_id
     and i.amount_paise = -o.amount_paise
     and i.amount_paise > 0
     and abs(o.date - i.date) <= ${TRANSFER_WINDOW_DAYS}
    where o.amount_paise < 0
    order by abs(o.date - i.date), o.date desc
    limit 50
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    outTransactionId: String(r.out_id),
    inTransactionId: String(r.in_id),
    amountPaise: Number(r.amount),
    daysApart: Number(r.days),
  }));
}

export async function linkTransfer(
  db: DbOrTx,
  userId: string,
  outTransactionId: string,
  inTransactionId: string,
): Promise<{ id: string }> {
  // Validation, reference remap, header delete and the new transfer postings
  // all run in ONE db transaction (ATOMICITY LAW). `db.transaction(...)` opens
  // a real transaction when `db` is a bare `Db`, or a nested savepoint when it
  // is already a `Tx`. A half-applied merge — references moved but the header
  // still there, or the header gone and its attachments with it — is the one
  // outcome that must be impossible. The `.for("update")` locks stop a
  // concurrent edit racing the validation.
  //
  // `auto` is gone with `transfer_links`: there is no link row left to record
  // whether the match was made by hand or by autoLinkTransfers.
  return db.transaction(async (t) => {
    // Lock rows in sorted-id order to prevent deadlocks with a concurrent
    // linkTransfer that locks the same two rows in the opposite order.
    const [firstId, secondId] =
      outTransactionId < inTransactionId
        ? [outTransactionId, inTransactionId]
        : [inTransactionId, outTransactionId];
    const firstRows = await t
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, firstId),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      )
      .for("update");
    const secondRows = await t
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, secondId),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      )
      .for("update");
    const out = [firstRows[0], secondRows[0]].find((r) => r?.id === outTransactionId);
    const inn = [firstRows[0], secondRows[0]].find((r) => r?.id === inTransactionId);
    if (!out || !inn) throw new HttpError(404, "Transaction not found");

    // Validate against the POSTINGS, not the legacy columns: they are what the
    // merged transfer is built from, and what every reader will see afterwards.
    const systemKindOf = await systemKindLookup(t, userId);
    const outPostings = await currentPostings(t, outTransactionId);
    const inPostings = await currentPostings(t, inTransactionId);
    for (const stored of [outPostings, inPostings]) {
      const shape = classifyShape(stored, systemKindOf);
      if (shape === "transfer") throw new HttpError(409, "Transaction is already part of a transfer");
      if (shape === "opening") throw new HttpError(400, "Opening balances cannot be transfers");
      if (shape === "split") {
        throw new HttpError(400, "Split the transaction into categories or link it as a transfer, not both");
      }
    }
    const outLeg = primaryRealLeg(outPostings, systemKindOf);
    const inLeg = primaryRealLeg(inPostings, systemKindOf);
    if (outLeg.amountPaise >= 0 || inLeg.amountPaise <= 0 || outLeg.amountPaise + inLeg.amountPaise !== 0) {
      throw new HttpError(400, "Transfer legs must be opposite-sign and equal amounts");
    }
    if (outLeg.accountId === inLeg.accountId) {
      throw new HttpError(400, "Transfer legs must be in different accounts");
    }

    // ONE header survives (the outflow leg). Every reference the absorbed
    // header holds moves first — deleting it would otherwise cascade
    // attachments away and orphan import rows.
    const { survivorId, absorbedId } = survivorOf(outTransactionId, inTransactionId);
    await remapReferences(t, userId, survivorId, absorbedId);
    const merged = mergeHeaderText(out, inn);
    await t
      .update(transactions)
      .set({ notes: merged.notes, tags: merged.tags, updatedAt: new Date() })
      .where(and(eq(transactions.id, survivorId), eq(transactions.userId, userId)));

    await t.delete(postings).where(eq(postings.transactionId, absorbedId));
    await t
      .delete(transactions)
      .where(and(eq(transactions.id, absorbedId), eq(transactions.userId, userId)));

    await postTransaction(
      t,
      survivorId,
      userId,
      buildTransferPostings({
        fromAccountId: outLeg.accountId,
        toAccountId: inLeg.accountId,
        amountPaise: -outLeg.amountPaise,
        note: "",
      }),
    );
    return { id: survivorId };
  });
}

/**
 * Auto-link unambiguous transfer pairs (exact opposite amount, different
 * accounts, within the window). Only links a pair when each leg has exactly one
 * candidate — never guesses between competing matches. Used after a statement
 * import so card payments land as transfers instead of income/expense. Returns
 * the number of pairs linked.
 */
export async function autoLinkTransfers(db: Db, userId: string): Promise<number> {
  const suggestions = await suggestTransfers(db, userId);
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const s of suggestions) {
    outCount.set(s.outTransactionId, (outCount.get(s.outTransactionId) ?? 0) + 1);
    inCount.set(s.inTransactionId, (inCount.get(s.inTransactionId) ?? 0) + 1);
  }
  let linked = 0;
  for (const s of suggestions) {
    // ambiguous — this out or in leg matches more than one counterpart; leave it for manual review
    if (outCount.get(s.outTransactionId) !== 1 || inCount.get(s.inTransactionId) !== 1) continue;
    try {
      await linkTransfer(db, userId, s.outTransactionId, s.inTransactionId);
      linked += 1;
    } catch {
      // a leg was linked concurrently or became ineligible — skip
    }
  }
  return linked;
}

/**
 * Splits a transfer back into two ordinary transactions. Takes a TRANSACTION
 * id — there is no `transfer_links` row to name any more.
 *
 * Deliberately NOT an inverse of the link: which leg originally owned an
 * attachment, a `sip_id` or an import row is destroyed when the two headers are
 * merged, and cannot be recovered. The survivor keeps its id and every
 * reference; the destination leg comes back as a NEW bare transaction carrying
 * only date, merchant, notes, tags and its own posting. The UI presents this as
 * "split into two transactions", not "undo".
 *
 * Returns both ids so the caller can show what it produced.
 */
export async function unlinkTransfer(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<{ transactionIds: [string, string] }> {
  return db.transaction(async (t) => {
    const [row] = await t
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .for("update");
    if (!row) throw new HttpError(404, "Transaction not found");

    const systemKindOf = await systemKindLookup(t, userId);
    const stored = await currentPostings(t, id);
    if (classifyShape(stored, systemKindOf) !== "transfer") {
      throw new HttpError(409, "This transaction is not a transfer");
    }
    const outLeg = primaryRealLeg(stored, systemKindOf);
    const inLeg = stored.find((p) => p !== outLeg && systemKindOf(p.accountId) === null)!;
    const systemAccounts = await resolveSystemAccounts(t, userId);

    // The survivor keeps its id and becomes an uncategorized ordinary
    // transaction for its own leg.
    await postTransaction(
      t,
      id,
      userId,
      buildOrdinaryPostings({
        accountId: outLeg.accountId,
        amountPaise: outLeg.amountPaise,
        categoryId: null,
        necessity: null,
        systemExpensesAccountId: systemAccounts.expenses,
        systemIncomeAccountId: systemAccounts.income,
      }),
    );

    // The destination leg becomes a new bare header on the same date.
    const [created] = await t
      .insert(transactions)
      .values({
        userId,
        date: row.date,
        occurredAt: row.occurredAt,
        merchant: row.merchant,
        notes: row.notes,
        tags: row.tags,
        source: row.source,
      })
      .returning({ id: transactions.id });
    await postTransaction(
      t,
      created!.id,
      userId,
      buildOrdinaryPostings({
        accountId: inLeg.accountId,
        amountPaise: inLeg.amountPaise,
        categoryId: null,
        necessity: null,
        systemExpensesAccountId: systemAccounts.expenses,
        systemIncomeAccountId: systemAccounts.income,
      }),
    );

    return { transactionIds: [id, created!.id] };
  });
}

/**
 * Pure: split a transfer request into its two ledger legs. Signs are derived here
 * rather than trusted from the caller, and the guards are duplicated from the Zod
 * schema so a direct service call (imports, etc.) can't book a nonsense pair.
 * Transfer legs are deliberately uncategorized — they are excluded from
 * income/expense once linked.
 */
export function buildTransferLegs(input: CreateTransferInput): {
  out: TransferLeg;
  in: TransferLeg;
} {
  if (input.fromAccountId === input.toAccountId) {
    throw new HttpError(400, "Transfer legs must be in different accounts");
  }
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new HttpError(400, "Transfer amount must be a positive whole number of paise");
  }
  const common = {
    date: input.date,
    merchant: input.merchant ?? "",
    categoryId: null,
    notes: input.notes ?? "",
    tags: input.tags ?? [],
  };
  return {
    out: { ...common, accountId: input.fromAccountId, amountPaise: -input.amountPaise },
    in: { ...common, accountId: input.toAccountId, amountPaise: input.amountPaise },
  };
}

/**
 * Record a transfer as two linked ledger entries in one transaction: money leaves
 * the source account and arrives in the destination, and the link keeps it out of
 * income/expense. Account ownership is enforced by `createTransaction`; because
 * both legs and the link share a DB transaction, a bad destination rolls the whole
 * thing back rather than leaving a stray one-sided entry.
 */
export async function createTransfer(
  db: Db,
  userId: string,
  input: CreateTransferInput,
): Promise<TransferResult> {
  const legs = buildTransferLegs(input);
  return db.transaction(async (tx) => {
    // ONE header, two real postings — built directly rather than as two rows
    // that are then merged, so a transfer created here and a transfer created
    // by linking two existing rows end up in exactly the same shape.
    await assertOwnedRealAccount(tx, userId, legs.out.accountId);
    await assertOwnedRealAccount(tx, userId, legs.in.accountId);
    const [created] = await tx
      .insert(transactions)
      .values({
        userId,
        date: legs.out.date,
        merchant: legs.out.merchant,
        notes: legs.out.notes,
        tags: legs.out.tags,
      })
      .returning({ id: transactions.id });
    await postTransaction(
      tx,
      created!.id,
      userId,
      buildTransferPostings({
        fromAccountId: legs.out.accountId,
        toAccountId: legs.in.accountId,
        amountPaise: input.amountPaise,
        note: "",
      }),
    );
    return { transactionId: created!.id };
  });
}
