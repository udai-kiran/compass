import { and, desc, eq } from "drizzle-orm";
import type { CardStatement } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, cardStatements } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import type { Storage } from "../lib/storage.ts";
import { assertUploadable } from "./attachments.ts";

type StatementRow = typeof cardStatements.$inferSelect;

function toStatement(row: StatementRow): CardStatement {
  return {
    id: row.id,
    accountId: row.accountId,
    period: row.period,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
  };
}

/** Assert the user owns this account and it's a credit card. */
async function assertOwnsCard(db: Db, userId: string, accountId: string): Promise<void> {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
    columns: { type: true },
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (acc.type !== "credit_card") throw new HttpError(400, "Not a credit card account");
}

export async function listCardStatements(
  db: Db,
  userId: string,
  accountId: string,
): Promise<CardStatement[]> {
  await assertOwnsCard(db, userId, accountId);
  const rows = await db.query.cardStatements.findMany({
    where: eq(cardStatements.accountId, accountId),
    orderBy: [desc(cardStatements.period), desc(cardStatements.createdAt)],
  });
  return rows.map(toStatement);
}

export async function saveCardStatement(
  db: Db,
  storage: Storage,
  userId: string,
  accountId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
  period: string | null,
): Promise<CardStatement> {
  await assertOwnsCard(db, userId, accountId);
  assertUploadable(file);
  const storedPath = await storage.put(file.data, file.mimeType);
  const rows = await db
    .insert(cardStatements)
    .values({
      accountId,
      userId,
      period: period || null,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storedPath,
    })
    .returning();
  return toStatement(rows[0]!);
}

export async function readCardStatement(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
): Promise<{ meta: CardStatement; data: Buffer }> {
  const row = await db.query.cardStatements.findFirst({
    where: and(eq(cardStatements.id, id), eq(cardStatements.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Statement not found");
  const data = await storage.get(row.storedPath);
  return { meta: toStatement(row), data };
}

export async function deleteCardStatement(
  db: Db,
  storage: Storage,
  userId: string,
  accountId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(cardStatements)
    .where(
      and(
        eq(cardStatements.id, id),
        eq(cardStatements.accountId, accountId),
        eq(cardStatements.userId, userId),
      ),
    )
    .returning({ storedPath: cardStatements.storedPath });
  if (rows.length === 0) throw new HttpError(404, "Statement not found");
  await storage.delete(rows[0]!.storedPath).catch(() => {});
}
