import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Attachment } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { attachments, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

type AttachmentRow = typeof attachments.$inferSelect;

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    transactionId: row.transactionId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
  };
}

async function assertOwnsTx(db: Db, userId: string, transactionId: string): Promise<void> {
  const tx = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, transactionId), eq(transactions.userId, userId)),
    columns: { id: true },
  });
  if (!tx) throw new HttpError(404, "Transaction not found");
}

export async function listAttachments(
  db: Db,
  userId: string,
  transactionId: string,
): Promise<Attachment[]> {
  await assertOwnsTx(db, userId, transactionId);
  const rows = await db.query.attachments.findMany({
    where: eq(attachments.transactionId, transactionId),
  });
  return rows.map(toAttachment);
}

export async function saveAttachment(
  db: Db,
  storageDir: string,
  userId: string,
  transactionId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
): Promise<Attachment> {
  await assertOwnsTx(db, userId, transactionId);
  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw new HttpError(415, `Unsupported file type ${file.mimeType} — allowed: images, PDF`);
  }
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, "File exceeds the 10 MB attachment limit");
  }
  // Content-addressed-ish path: shard by hash prefix, unique name.
  const hash = createHash("sha256").update(file.data).digest("hex").slice(0, 8);
  const storedPath = join(hash.slice(0, 2), `${randomUUID()}-${hash}`);
  const absDir = join(storageDir, hash.slice(0, 2));
  await mkdir(absDir, { recursive: true });
  await writeFile(join(storageDir, storedPath), file.data);
  const rows = await db
    .insert(attachments)
    .values({
      transactionId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.data.byteLength,
      storedPath,
    })
    .returning();
  return toAttachment(rows[0]!);
}

export async function readAttachment(
  db: Db,
  storageDir: string,
  userId: string,
  id: string,
): Promise<{ meta: Attachment; data: Buffer }> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!row) throw new HttpError(404, "Attachment not found");
  await assertOwnsTx(db, userId, row.transactionId);
  const data = await readFile(join(storageDir, row.storedPath));
  return { meta: toAttachment(row), data };
}

export async function deleteAttachment(
  db: Db,
  storageDir: string,
  userId: string,
  id: string,
): Promise<void> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!row) throw new HttpError(404, "Attachment not found");
  await assertOwnsTx(db, userId, row.transactionId);
  await db.delete(attachments).where(eq(attachments.id, id));
  await unlink(join(storageDir, row.storedPath)).catch(() => {});
}
