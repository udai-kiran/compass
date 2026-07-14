import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { toCsv } from "../lib/csv.ts";
import { encryptBackup } from "../lib/crypto-backup.ts";

/** All tables in dependency order — snapshot for a full logical backup. */
const ALL_TABLES = [
  "users", "accounts", "categories", "transactions", "transaction_splits", "transfer_links",
  "attachments", "imports", "import_rows", "import_presets", "merchant_rules",
  "budgets", "budget_lines", "budget_alerts", "notifications", "recurring_templates",
  "goals", "goal_contributions", "alert_ledger", "subscription_dismissals", "notification_prefs",
  "card_details", "reward_entries", "emi_details", "holdings", "holding_valuations",
  "holding_events", "net_worth_snapshots",
] as const;

/** Tables that carry a user_id, for the per-user data-ownership export. */
const USER_TABLES: Record<string, string> = {
  accounts: "user_id", categories: "user_id", transactions: "user_id", transfer_links: "user_id",
  budgets: "user_id", budget_alerts: "user_id", notifications: "user_id", recurring_templates: "user_id",
  goals: "user_id", alert_ledger: "user_id", subscription_dismissals: "user_id", notification_prefs: "user_id",
  card_details: "user_id", reward_entries: "user_id", emi_details: "user_id", holdings: "user_id",
  net_worth_snapshots: "user_id",
};

async function dumpTable(db: Db, table: string, whereUserId?: string): Promise<unknown[]> {
  const res = whereUserId
    ? await db.execute(sql`select * from ${sql.identifier(table)} where ${sql.identifier(USER_TABLES[table]!)} = ${whereUserId}`)
    : await db.execute(sql`select * from ${sql.identifier(table)}`);
  return res.rows;
}

/** Full logical dump of every table → JSON (used by the encrypted backup). */
export async function dumpDatabase(db: Db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of ALL_TABLES) out[t] = await dumpTable(db, t);
  return out;
}

/** Portable JSON of a single user's data (data-ownership export). */
export async function exportUserData(db: Db, userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), userId };
  for (const t of Object.keys(USER_TABLES)) out[t] = await dumpTable(db, t, userId);
  return out;
}

/** A user's transactions as CSV. */
export async function transactionsCsv(db: Db, userId: string): Promise<string> {
  const res = await db.execute(sql`
    select t.date, t.merchant, t.amount_paise, c.name as category, a.name as account, t.notes
    from transactions t
    left join categories c on c.id = t.category_id
    left join accounts a on a.id = t.account_id
    where t.user_id = ${userId} and t.deleted_at is null
    order by t.date desc
  `);
  const rows: Array<Array<string | number>> = [["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]];
  for (const r of res.rows as Array<Record<string, unknown>>) {
    rows.push([
      String(r.date), String(r.merchant ?? ""), Number(r.amount_paise),
      String(r.category ?? ""), String(r.account ?? ""), String(r.notes ?? ""),
    ]);
  }
  return toCsv(rows);
}

function backupKey(config: Config): string {
  return config.BACKUP_KEY || config.SESSION_SECRET;
}

/**
 * Write an encrypted logical backup to BACKUP_DIR. Portable (no pg_dump
 * dependency): the whole database is dumped to JSON, gzipped, and AES-256-GCM
 * encrypted. Returns the file path and size.
 */
export async function createEncryptedBackup(
  db: Db,
  config: Config,
): Promise<{ path: string; bytes: number }> {
  const dir = resolve(config.BACKUP_DIR);
  await mkdir(dir, { recursive: true });
  const dump = await dumpDatabase(db);
  const plaintext = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data: dump }));
  const envelope = encryptBackup(plaintext, backupKey(config));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(dir, `compass-backup-${stamp}.json.gz.enc`);
  await writeFile(path, envelope);
  return { path, bytes: envelope.length };
}
