import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { decryptBackupV2File } from "../../../lib/crypto-backup.ts";
import { HttpError } from "../../../lib/errors.ts";
import {
  buildUserBackupStream,
  createEncryptedBackup,
  exportUserData,
  orphanedStorageKeys,
  transactionsCsv,
} from "../services/backup.ts";
import { restoreUserBackup } from "../services/restore-user.ts";

/** An archive holds every uploaded file, so it dwarfs the multipart default. */
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024; // 1 GB

const PassphraseSchema = z.string().min(8).max(200);

export async function backupRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/api/export.json", async (req, reply) => {
    const data = await exportUserData(app.db, req.session!.userId);
    return reply
      .header("content-type", "application/json")
      .header("content-disposition", `attachment; filename="compass-export.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  r.get("/api/export/transactions.csv", async (req, reply) => {
    const csv = await transactionsCsv(app.db, req.session!.userId);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="compass-transactions.csv"`)
      .send(csv);
  });

  // manual trigger for a full encrypted backup (also runs weekly on a schedule)
  r.post(
    "/api/backup/run",
    { schema: { response: { 200: z.object({ path: z.string(), bytes: z.number().int() }) } } },
    async () => createEncryptedBackup(app.db, app.config),
  );

  // ---- per-user encrypted archive: rows + every referenced storage object ----

  /** Download this account's complete backup, encrypted with a passphrase the
   * user chooses — portable to a fresh instance, unlike the server-keyed
   * weekly backups. POST so the passphrase never lands in access logs. */
  r.post(
    "/api/backup/archive",
    { schema: { body: z.object({ passphrase: PassphraseSchema }) } },
    async (req, reply) => {
      const stream = await buildUserBackupStream(
        app.db,
        app.storage,
        req.session!.userId,
        req.body.passphrase,
      );
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="compass-backup-${stamp}.cmpb"`)
        .send(stream);
    },
  );

  // multipart body (archive file + passphrase field) — schema validation not applicable
  app.post("/api/backup/restore", async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart backup file");
    const rawPassphrase = file.fields.passphrase;
    const passphrase = PassphraseSchema.parse(
      rawPassphrase && "value" in rawPassphrase ? rawPassphrase.value : undefined,
    );

    const envelopePath = join(tmpdir(), `compass-restore-${randomUUID()}.cmpb`);
    const plaintextPath = `${envelopePath}.plain`;
    try {
      await pipeline(file.file, createWriteStream(envelopePath));
      if (file.file.truncated) throw new HttpError(413, "Backup file exceeds the 1 GB limit");
      try {
        await decryptBackupV2File(envelopePath, plaintextPath, passphrase);
      } catch (err) {
        if (err instanceof Error && err.message === "Not a Compass backup file") {
          throw new HttpError(400, err.message);
        }
        throw new HttpError(400, "Wrong passphrase, or the backup file is corrupt");
      }
      const summary = await restoreUserBackup(app.pg, app.storage, req.session!.userId, plaintextPath);
      if (summary.postings?.failed && summary.postings.failed > 0) {
        app.log.error(
          { failed: summary.postings.failed, repaired: summary.postings.repaired },
          "post-commit restore reconcile: PR-B reader gate NOT satisfied — some transactions failed to re-synthesize",
        );
      }
      return summary;
    } finally {
      await unlink(envelopePath).catch(() => {});
      await unlink(plaintextPath).catch(() => {});
    }
  });

  /** Storage objects no row references (crashed uploads, best-effort deletes).
   * Report only — nothing is deleted. */
  r.get(
    "/api/backup/orphans",
    {
      schema: {
        response: {
          200: z.object({
            totalObjects: z.number().int(),
            orphaned: z.number().int(),
            keys: z.array(z.string()),
          }),
        },
      },
    },
    async () => {
      const { total, orphans } = await orphanedStorageKeys(app.db, app.storage);
      return { totalObjects: total, orphaned: orphans.length, keys: orphans.slice(0, 50) };
    },
  );
}
