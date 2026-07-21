import type pg from "pg";
import { HttpError } from "../lib/errors.ts";
import type { Storage } from "../lib/storage.ts";
import { openArchive, type ArchiveHeader } from "../lib/backup-archive.ts";
import { DEFERRED_RESTORE_COLUMNS, firstPassRow } from "../db/restore.ts";
import { ALL_TABLES, LINKED_TABLES, USER_TABLES } from "./backup.ts";

/** ALL_TABLES order restricted to what a per-user archive contains. */
export function restorableTables(): string[] {
  return ALL_TABLES.filter((t) => t in USER_TABLES || t in LINKED_TABLES);
}

/** Tables that must be empty before a restore — the "fresh account" guard. */
const MUST_BE_EMPTY = ["accounts", "transactions", "insurance_policies", "goals", "holdings"] as const;

/** The MIME a restored object is stored under, from its owning row. */
function mimeOf(header: ArchiveHeader, table: string, rowId: string): string {
  const row = header.tables[table]?.find((r) => String(r.id) === rowId);
  const mime = table === "insurance_policies" ? row?.document_mime : row?.mime_type;
  return typeof mime === "string" && mime !== "" ? mime : "application/octet-stream";
}

function ident(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

async function insertRow(client: pg.PoolClient, table: string, row: Record<string, unknown>) {
  const entries = Object.entries(row);
  if (entries.length === 0) return;
  const columns = entries.map(([key]) => ident(key)).join(", ");
  const params = entries.map((_, i) => `$${i + 1}`).join(", ");
  await client.query(
    `insert into ${ident(table)} (${columns}) values (${params})`,
    entries.map(([, value]) => value),
  );
}

export interface RestoreSummary {
  tables: number;
  rows: number;
  files: number;
}

/**
 * Restore a decrypted per-user archive into `userId`'s account.
 *
 * The account must be fresh (guarded on the data tables); whatever registration
 * seeded (default categories, preference rows) is wiped first so the restored
 * rows land cleanly. Every row's user_id is remapped to the new account, and
 * every storage object is re-uploaded — the new keys are written into the rows,
 * so the restored account never points at objects that don't exist. Row inserts
 * run in one transaction; if it fails, the freshly uploaded objects are removed
 * again best-effort.
 */
export async function restoreUserBackup(
  pool: pg.Pool,
  storage: Storage,
  userId: string,
  archivePath: string,
): Promise<RestoreSummary> {
  const archive = await openArchive(archivePath);
  const uploaded: string[] = [];
  try {
    const { header } = archive;

    // Fast-fail before uploading anything; the transaction re-checks authoritatively.
    for (const table of MUST_BE_EMPTY) {
      const res = await pool.query<{ count: string }>(
        `select count(*)::bigint as count from ${ident(table)} where user_id = $1`,
        [userId],
      );
      if (Number(res.rows[0]?.count ?? 0) !== 0) {
        throw new HttpError(409, "This account already has data — restore needs a fresh account");
      }
    }

    // Re-upload blobs first (outside the transaction — storage isn't
    // transactional), building old key → new key for rewriting rows.
    const keyMap = new Map<string, string>();
    for (let i = 0; i < header.files.length; i++) {
      const ref = header.files[i]!;
      const data = await archive.readBlob(i);
      if (data === null) continue; // was already missing at backup time
      const newKey = await storage.put(data, mimeOf(header, ref.table, ref.rowId));
      uploaded.push(newKey);
      keyMap.set(ref.key, newKey);
    }
    const fileColumns = new Map(header.files.map((f) => [`${f.table}.${f.column}`, f.column]));

    const client = await pool.connect();
    try {
      await client.query("begin");

      for (const table of MUST_BE_EMPTY) {
        const res = await client.query<{ count: string }>(
          `select count(*)::bigint as count from ${ident(table)} where user_id = $1`,
          [userId],
        );
        if (Number(res.rows[0]?.count ?? 0) !== 0) {
          throw new HttpError(409, "This account already has data — restore needs a fresh account");
        }
      }

      // Clear what registration seeded so the restored rows replace it.
      const tables = restorableTables();
      for (const table of [...tables].reverse()) {
        if (table in USER_TABLES) {
          await client.query(
            `delete from ${ident(table)} where ${ident(USER_TABLES[table]!)} = $1`,
            [userId],
          );
        }
      }

      let rowCount = 0;
      let tableCount = 0;
      for (const table of tables) {
        const rows = header.tables[table];
        if (!Array.isArray(rows)) continue; // older archive without this table
        if (rows.length > 0) tableCount++;
        const userColumn = USER_TABLES[table];
        for (const row of rows) {
          const rewritten: Record<string, unknown> = { ...row };
          if (userColumn) rewritten[userColumn] = userId;
          for (const [scoped, column] of fileColumns) {
            if (scoped.startsWith(`${table}.`) && typeof rewritten[column] === "string") {
              rewritten[column] = keyMap.get(rewritten[column] as string) ?? rewritten[column];
            }
          }
          await insertRow(client, table, firstPassRow(table, rewritten));
          rowCount++;
        }
      }

      // Second pass: references deferred out of the first insert.
      for (const [table, columns] of Object.entries(DEFERRED_RESTORE_COLUMNS)) {
        for (const column of columns) {
          for (const row of header.tables[table] ?? []) {
            const value = row[column];
            if (value !== null && value !== undefined) {
              await client.query(
                `update ${ident(table)} set ${ident(column)} = $1 where id = $2`,
                [value, row.id],
              );
            }
          }
        }
      }

      await client.query("commit");
      return { tables: tableCount, rows: rowCount, files: keyMap.size };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    // The DB rolled back (or never started) — don't leave the blobs behind.
    for (const key of uploaded) await storage.delete(key).catch(() => {});
    throw error;
  } finally {
    await archive.close();
  }
}
