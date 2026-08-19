import { readFile } from "node:fs/promises";
import pg from "pg";
import { decryptBackup } from "../lib/crypto-backup.ts";
import { ALL_TABLES } from "../modules/system/services/backup.ts";

type Dump = Record<string, Array<Record<string, unknown>>>;

/** References that cannot be populated during the first insert pass. */
export const DEFERRED_RESTORE_COLUMNS = {
  accounts: ["goal_id", "linked_account_id"],
  categories: ["parent_id"],
  // policy_id → insurance_policies and reconciled_statement_id →
  // statement_reconciliations both restore after transactions in ALL_TABLES order.
  // sips also restores after transactions in ALL_TABLES order, so sip_id must
  // be filled on the second pass too.
  transactions: ["policy_id", "recurring_template_id", "reconciled_statement_id", "sip_id"],
} as const satisfies Record<string, readonly string[]>;

/** Database-generated columns present in `select *` dumps but never insertable.
 * `search` is database-generated (tsvector) and cannot be inserted directly.
 * `is_opening`, `account_id`, `amount_paise`, and `category_id` are legacy
 * columns dropped in v3.0.0; old per-user archives exported before that release
 * may still carry them, so we silently drop them on restore. */
export const OMITTED_RESTORE_COLUMNS = {
  transactions: ["search", "is_opening", "account_id", "amount_paise", "category_id"],
} as const satisfies Record<string, readonly string[]>;

function ident(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

export function firstPassRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const deferred = new Set<string>(DEFERRED_RESTORE_COLUMNS[table as keyof typeof DEFERRED_RESTORE_COLUMNS] ?? []);
  const omitted = new Set<string>(OMITTED_RESTORE_COLUMNS[table as keyof typeof OMITTED_RESTORE_COLUMNS] ?? []);
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !omitted.has(key))
      .map(([key, value]) => [key, deferred.has(key) ? null : value]),
  );
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
 * Restore a logical dump into an empty migrated database.
 *
 * Accounts and goals form an FK cycle, while categories reference other rows in
 * the same table. The first pass inserts those nullable references as null; the
 * second pass restores them after every parent row exists. Everything happens in
 * one transaction, so any invalid/corrupt reference rolls back the whole restore.
 */
export async function restoreDump(pool: pg.Pool, dump: Dump): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ count: string }>("select count(*)::bigint as count from users");
    if (Number(existing.rows[0]?.count ?? 0) !== 0) {
      throw new Error("Restore target is not empty");
    }

    for (const table of ALL_TABLES) {
      if (!Array.isArray(dump[table])) throw new Error(`Backup is missing table ${table}`);
      for (const row of dump[table]!) await insertRow(client, table, firstPassRow(table, row));
    }

    // Second pass: references deferred out of the first insert. This loop is
    // generic over DEFERRED_RESTORE_COLUMNS so that adding a column there can
    // never again silently do nothing — a hard-coded per-column block here
    // (as this used to be) would need updating in lockstep with that map, and
    // did not (sip_id was added to the map but had no corresponding block).
    for (const [table, columns] of Object.entries(DEFERRED_RESTORE_COLUMNS)) {
      for (const column of columns) {
        for (const row of dump[table] ?? []) {
          const value = row[column];
          if (value !== null && value !== undefined) {
            await client.query(`update ${ident(table)} set ${ident(column)} = $1 where id = $2`, [value, row.id]);
          }
        }
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const path = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  const key = process.env.BACKUP_KEY || process.env.SESSION_SECRET;
  if (!path) throw new Error("Usage: npm run db:restore -w apps/api -- <backup-file>");
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!key) throw new Error("BACKUP_KEY or SESSION_SECRET is required");

  const envelope = await readFile(path);
  const parsed = JSON.parse(decryptBackup(envelope, key).toString()) as { version: number; data: Dump };
  if (parsed.version !== 1 || !parsed.data) throw new Error("Unsupported backup format");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await restoreDump(pool, parsed.data);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
