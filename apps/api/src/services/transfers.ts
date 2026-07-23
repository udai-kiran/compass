import { and, eq, isNull, sql } from "drizzle-orm";
import type { TransferSuggestion } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { transactions, transferLinks } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

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
  const [out, inn] = await Promise.all([
    db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, outTransactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    }),
    db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, inTransactionId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
      ),
    }),
  ]);
  if (!out || !inn) throw new HttpError(404, "Transaction not found");
  if (out.amountPaise >= 0 || inn.amountPaise <= 0 || out.amountPaise + inn.amountPaise !== 0) {
    throw new HttpError(400, "Transfer legs must be opposite-sign and equal amounts");
  }
  if (out.accountId === inn.accountId) {
    throw new HttpError(400, "Transfer legs must be in different accounts");
  }
  const rows = await db
    .insert(transferLinks)
    .values({ userId, outTransactionId, inTransactionId, auto })
    .returning({ id: transferLinks.id });
  return rows[0]!;
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
  const rows = await db
    .delete(transferLinks)
    .where(and(eq(transferLinks.id, id), eq(transferLinks.userId, userId)))
    .returning({ id: transferLinks.id });
  if (rows.length === 0) throw new HttpError(404, "Transfer link not found");
}
