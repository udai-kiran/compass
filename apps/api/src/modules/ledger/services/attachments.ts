import { and, eq } from "drizzle-orm";
import type { Attachment } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { attachments, transactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { Storage } from "../../../lib/storage.ts";

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

/** The leading bytes every allowed type must start with — the declared MIME
 * type is client-supplied, so the content has to back it up. */
function matchesMagicBytes(mimeType: string, data: Buffer): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case "image/png":
      return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return (
        data.length >= 12 &&
        data.toString("latin1", 0, 4) === "RIFF" &&
        data.toString("latin1", 8, 12) === "WEBP"
      );
    case "application/pdf":
      return data.toString("latin1", 0, 5) === "%PDF-";
    default:
      return false;
  }
}

/** Validate an uploaded file's type, content signature and size; throws on rejection. */
export function assertUploadable(file: { mimeType: string; data: Buffer }): void {
  if (!ALLOWED_MIME.has(file.mimeType)) {
    throw new HttpError(415, `Unsupported file type ${file.mimeType} — allowed: images, PDF`);
  }
  if (!matchesMagicBytes(file.mimeType, file.data)) {
    throw new HttpError(415, "File content does not match its declared type");
  }
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, "File exceeds the 10 MB limit");
  }
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
  storage: Storage,
  userId: string,
  transactionId: string,
  file: { fileName: string; mimeType: string; data: Buffer },
): Promise<Attachment> {
  await assertOwnsTx(db, userId, transactionId);
  assertUploadable(file);
  const storedPath = await storage.put(file.data, file.mimeType);
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
  storage: Storage,
  userId: string,
  id: string,
): Promise<{ meta: Attachment; data: Buffer }> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!row) throw new HttpError(404, "Attachment not found");
  await assertOwnsTx(db, userId, row.transactionId);
  const data = await storage.get(row.storedPath);
  return { meta: toAttachment(row), data };
}

export async function deleteAttachment(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
): Promise<void> {
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!row) throw new HttpError(404, "Attachment not found");
  await assertOwnsTx(db, userId, row.transactionId);
  await db.delete(attachments).where(eq(attachments.id, id));
  await storage.delete(row.storedPath).catch(() => {});
}
