import type pg from "pg";
import { HttpError } from "../../../lib/errors.ts";
import type { Storage } from "../../../lib/storage.ts";
import { openArchive, type ArchiveHeader } from "../../../lib/backup-archive.ts";
import { createDb } from "../../../db/index.ts";
import { findInconsistentPostings } from "../../ledger/services/reconcile-postings.ts";
import { DEFERRED_RESTORE_COLUMNS, firstPassRow } from "../../../db/restore.ts";
import { ALL_TABLES, LINKED_TABLES, USER_TABLES } from "./backup.ts";

/**
 * Tables that must be empty (no user rows) before a restore is allowed.
 * Seeded data (categories, preferences) is wiped by the delete loop
 * and does NOT block the restore.
 */
const MUST_BE_EMPTY = ["accounts", "transactions", "insurance_policies", "goals", "holdings"] as const;

/** ALL_TABLES order restricted to what a per-user archive contains. */
export function restorableTables(): string[] {
  return ALL_TABLES.filter((t) => t in USER_TABLES || t in LINKED_TABLES);
}

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

/**
 * Count rows in a user-scoped table that would block a restore. For accounts
 * the count excludes system accounts (system_kind is null), so the 4 seeded
 * system accounts don't trigger the "fresh account" guard.
 */
async function countBlockingRows(
  q: pg.PoolClient | pg.Pool,
  table: string,
  userId: string,
): Promise<number> {
  const whereSystem = table === "accounts" ? " and system_kind is null" : "";
  const res = await q.query<{ count: string }>(
    `select count(*)::bigint as count from ${ident(table)} where user_id = $1${whereSystem}`,
    [userId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export interface RestoreSummary {
  tables: number;
  rows: number;
  files: number;
  postings?: { repaired: number; failed: number };
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
 *
 * Archived posting rows are RESTORED, not discarded. Before PR-G1 they were
 * skipped and re-synthesized afterwards from the legacy columns — that
 * derivation is gone, so skipping them now would restore transactions with no
 * postings at all, i.e. with no amount, account or category that any reader can
 * see. Postings are the data.
 *
 * The post-commit `validate` callback therefore VERIFIES the restored shapes
 * instead of repairing them; a throw from it does NOT trigger DB rollback or
 * blob deletion (the DB already committed).
 */
export async function restoreUserBackup(
  pool: pg.Pool,
  storage: Storage,
  userId: string,
  archivePath: string,
  validate: (pool: pg.Pool, userId: string) => Promise<{ repaired: number; failures: unknown[] }> = async (
    p,
    uid,
  ) => ({ repaired: 0, failures: await findInconsistentPostings(createDb(p), uid) }),
): Promise<RestoreSummary> {
  const archive = await openArchive(archivePath);
  const uploaded: string[] = [];
  let summary!: RestoreSummary;
  try {
    const { header } = archive;

    // Fast-fail before uploading anything; the transaction re-checks authoritatively.
    for (const table of MUST_BE_EMPTY) {
      const count = await countBlockingRows(pool, table, userId);
      if (count > 0) {
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

      // Re-check inside the transaction that the destination is still fresh.
      for (const table of MUST_BE_EMPTY) {
        const count = await countBlockingRows(client, table, userId);
        if (count > 0) {
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
        // `postings` is restored like any other table: it IS the ledger now.
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
      summary = { tables: tableCount, rows: rowCount, files: keyMap.size };
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

  // Post-commit validation (only runs when the transaction committed — if the
  // outer catch re-threw this code is unreachable). A throw MUST NOT trigger DB
  // rollback or blob deletion (the DB already committed), so a bad archive
  // surfaces as a reported failure count rather than a half-undone restore.
  try {
    const r = await validate(pool, userId);
    summary.postings = { repaired: r.repaired, failed: r.failures.length };
  } catch {
    summary.postings = { repaired: 0, failed: 1 };
  }

  return summary;
}