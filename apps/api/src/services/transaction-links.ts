import { and, asc, eq } from "drizzle-orm";
import type { TransactionLink } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { transactionLinks, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

export const MAX_LINKS_PER_TX = 20;

type TransactionLinkRow = typeof transactionLinks.$inferSelect;

function toTransactionLink(row: TransactionLinkRow): TransactionLink {
  return {
    id: row.id,
    transactionId: row.transactionId,
    url: row.url,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertOwnsTx(db: Db, userId: string, transactionId: string): Promise<void> {
  const tx = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, transactionId), eq(transactions.userId, userId)),
    columns: { id: true },
  });
  if (!tx) throw new HttpError(404, "Transaction not found");
}

export async function listLinks(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<TransactionLink[]> {
  await assertOwnsTx(db, userId, transactionId);
  const rows = await db.query.transactionLinks.findMany({
    where: eq(transactionLinks.transactionId, transactionId),
    orderBy: asc(transactionLinks.createdAt),
  });
  return rows.map(toTransactionLink);
}

export async function addLink(
  db: Db,
  userId: string,
  transactionId: string,
  input: { url: string; title: string },
): Promise<TransactionLink> {
  await assertOwnsTx(db, userId, transactionId);
  const existing = await db.query.transactionLinks.findMany({
    where: eq(transactionLinks.transactionId, transactionId),
    columns: { id: true },
  });
  if (existing.length >= MAX_LINKS_PER_TX) {
    throw new HttpError(422, `Cannot add more than ${MAX_LINKS_PER_TX} links to a transaction`);
  }
  const rows = await db
    .insert(transactionLinks)
    .values({
      transactionId,
      url: input.url,
      title: input.title,
    })
    .returning();
  return toTransactionLink(rows[0]!);
}

export async function deleteLink(
  db: Db,
  userId: string,
  linkId: string,
): Promise<void> {
  const row = await db.query.transactionLinks.findFirst({ where: eq(transactionLinks.id, linkId) });
  if (!row) throw new HttpError(404, "Link not found");
  await assertOwnsTx(db, userId, row.transactionId);
  await db.delete(transactionLinks).where(eq(transactionLinks.id, linkId));
}
