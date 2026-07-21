import { readFile } from "node:fs/promises";
import pg from "pg";
import { decryptBackup } from "../lib/crypto-backup.ts";
import { ALL_TABLES } from "../services/backup.ts";

type Dump = Record<string, Array<Record<string, unknown>>>;

/** References that cannot be populated during the first insert pass. */
export const DEFERRED_RESTORE_COLUMNS = {
  accounts: ["goal_id"],
  categories: ["parent_id"],
  // insurance_policies restores after transactions in ALL_TABLES order
  transactions: ["policy_id"],
} as const satisfies Record<string, readonly string[]>;

/** Database-generated columns present in `select *` dumps but never insertable. */
export const OMITTED_RESTORE_COLUMNS = {
  transactions: ["search"],
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

    for (const row of dump.accounts ?? []) {
      if (row.goal_id !== null && row.goal_id !== undefined) {
        await client.query("update accounts set goal_id = $1 where id = $2", [row.goal_id, row.id]);
      }
    }
    for (const row of dump.categories ?? []) {
      if (row.parent_id !== null && row.parent_id !== undefined) {
        await client.query("update categories set parent_id = $1 where id = $2", [row.parent_id, row.id]);
      }
    }
    for (const row of dump.transactions ?? []) {
      if (row.policy_id !== null && row.policy_id !== undefined) {
        await client.query("update transactions set policy_id = $1 where id = $2", [row.policy_id, row.id]);
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
