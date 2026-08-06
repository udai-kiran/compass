import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { CreateTransfer, TransferResult, TransferSuggestion } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { transactions, transferLinks } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { createTransaction, rebuildPostingsForTransaction } from "./transactions.ts";

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

export async function suggestTransfers(db: Db, userId: string): Promise<TransferSuggestion[]> {
  const rows = await db.execute(sql`
    select o.id as out_id, i.id as in_id, i.amount_paise as amount, abs(o.date - i.date) as days
    from transactions o
    join transactions i
      on i.user_id = o.user_id
     and i.account_id <> o.account_id
     and i.amount_paise = -o.amount_paise
     and i.amount_paise > 0
     and abs(o.date - i.date) <= ${TRANSFER_WINDOW_DAYS}
     and i.deleted_at is null
     and not i.is_opening
     and not exists (select 1 from transfer_links tl
       where tl.out_transaction_id = i.id or tl.in_transaction_id = i.id)
    where o.user_id = ${userId}
      and o.deleted_at is null
      and o.amount_paise < 0
      and not o.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = o.id or tl.in_transaction_id = o.id)
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
  auto = false,
): Promise<{ id: string }> {
  // Validation (row locks + shape/membership checks) runs INSIDE the same db
  // transaction as the link insert + both-leg posting rebuild (ATOMICITY LAW).
  // `db.transaction(...)` opens a real transaction when `db` is a bare `Db`,
  // or a nested savepoint when `db` is already a `Tx` (createTransfer passes
  // its own tx here) — either way validation, the link, and both legs'
  // Clearing postings commit/rollback together, and the `.for("update")` locks
  // prevent a concurrent edit/link from racing this validation.
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
    const out = [firstRows[0], secondRows[0]].find(r => r?.id === outTransactionId);
    const inn = [firstRows[0], secondRows[0]].find(r => r?.id === inTransactionId);
    if (!out || !inn) throw new HttpError(404, "Transaction not found");
    if (out.amountPaise >= 0 || inn.amountPaise <= 0 || out.amountPaise + inn.amountPaise !== 0) {
      throw new HttpError(400, "Transfer legs must be opposite-sign and equal amounts");
    }
    if (out.accountId === inn.accountId) {
      throw new HttpError(400, "Transfer legs must be in different accounts");
    }
    if (out.isOpening || inn.isOpening) {
      throw new HttpError(400, "Opening balances cannot be transfers");
    }
    const existingLink = await t.query.transferLinks.findFirst({
      where: or(
        eq(transferLinks.outTransactionId, outTransactionId),
        eq(transferLinks.inTransactionId, outTransactionId),
        eq(transferLinks.outTransactionId, inTransactionId),
        eq(transferLinks.inTransactionId, inTransactionId),
      ),
    });
    if (existingLink) throw new HttpError(409, "Transaction is already part of a transfer");
    const rows = await t
      .insert(transferLinks)
      .values({ userId, outTransactionId, inTransactionId, auto })
      .returning({ id: transferLinks.id });
    await rebuildPostingsForTransaction(t, userId, outTransactionId);
    await rebuildPostingsForTransaction(t, userId, inTransactionId);
    return rows[0]!;
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
      await linkTransfer(db, userId, s.outTransactionId, s.inTransactionId, true);
      linked += 1;
    } catch {
      // a leg was linked concurrently or became ineligible — skip
    }
  }
  return linked;
}

export async function unlinkTransfer(db: Db, userId: string, id: string): Promise<void> {
  // Link delete + both-leg posting rebuild share ONE db transaction (ATOMICITY
  // LAW): read the link first to capture its legs, delete it, then rebuild
  // both legs — now absent from transfer_links, they revert to ordinary shape.
  await db.transaction(async (t) => {
    const link = await t.query.transferLinks.findFirst({
      where: and(eq(transferLinks.id, id), eq(transferLinks.userId, userId)),
    });
    if (!link) throw new HttpError(404, "Transfer link not found");
    await t.delete(transferLinks).where(and(eq(transferLinks.id, id), eq(transferLinks.userId, userId)));
    await rebuildPostingsForTransaction(t, userId, link.outTransactionId);
    await rebuildPostingsForTransaction(t, userId, link.inTransactionId);
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
    const outLeg = await createTransaction(tx, userId, legs.out);
    const inLeg = await createTransaction(tx, userId, legs.in);
    const link = await linkTransfer(tx, userId, outLeg.id, inLeg.id, false);
    return {
      transferLinkId: link.id,
      outTransactionId: outLeg.id,
      inTransactionId: inLeg.id,
    };
  });
}
