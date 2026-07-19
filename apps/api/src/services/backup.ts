import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { toCsv } from "../lib/csv.ts";
import { encryptBackup } from "../lib/crypto-backup.ts";

/**
 * Every application table in a stable logical order. This is not, and cannot be,
 * a strict FK topological order: accounts.goal_id references goals (which is
 * listed later), and categories.parent_id is self-referential. Restore code must
 * handle those references in two passes. Kept exhaustive on purpose: a table
 * missing here silently drops out of the encrypted backup, so the schema-coverage
 * test guards it against drift as new tables are added.
 */
export const ALL_TABLES = [
  "users", "accounts", "categories", "transactions", "transaction_splits", "transfer_links",
  "attachments", "imports", "import_rows", "import_presets", "merchant_rules",
  "budgets", "budget_lines", "budget_alerts", "notifications", "recurring_templates",
  "goals", "alert_ledger", "subscription_dismissals", "notification_prefs", "projection_settings",
  "ai_settings",
  "card_details", "bank_details", "retirement_details", "overdraft_details",
  "reward_entries", "emi_details", "holdings", "nps_details", "gold_details",
  "holding_valuations", "holding_events", "net_worth_snapshots",
  "mailbox_accounts", "mailbox_credentials", "email_ingestions", "extracted_transactions",
] as const;

/** Tables that carry a user_id directly — scoped by that column in the export. */
export const USER_TABLES: Record<string, string> = {
  accounts: "user_id", categories: "user_id", transactions: "user_id", transfer_links: "user_id",
  imports: "user_id", import_presets: "user_id", merchant_rules: "user_id",
  budgets: "user_id", budget_alerts: "user_id", notifications: "user_id", recurring_templates: "user_id",
  goals: "user_id", alert_ledger: "user_id", subscription_dismissals: "user_id", notification_prefs: "user_id",
  projection_settings: "user_id", ai_settings: "user_id",
  card_details: "user_id", bank_details: "user_id", retirement_details: "user_id",
  overdraft_details: "user_id", reward_entries: "user_id", emi_details: "user_id",
  holdings: "user_id", nps_details: "user_id", gold_details: "user_id",
  net_worth_snapshots: "user_id",
  mailbox_accounts: "user_id", mailbox_credentials: "user_id",
  email_ingestions: "user_id", extracted_transactions: "user_id",
};

/**
 * Child tables with no user_id of their own — scoped through a parent that has
 * one, so the export stays a complete per-user reconstruction rather than only
 * the rows Postgres happens to tag with a user_id.
 */
export const LINKED_TABLES: Record<string, { fk: string; parent: string }> = {
  transaction_splits: { fk: "transaction_id", parent: "transactions" },
  attachments: { fk: "transaction_id", parent: "transactions" },
  import_rows: { fk: "import_id", parent: "imports" },
  budget_lines: { fk: "budget_id", parent: "budgets" },
  holding_valuations: { fk: "holding_id", parent: "holdings" },
  holding_events: { fk: "holding_id", parent: "holdings" },
};

/**
 * Which of {@link ALL_TABLES} the per-user export omits. Empty means the export
 * reconstructs every table for a user; anything here is a coverage gap. Used by
 * the export and by the drift test — `users` is excluded because a user does not
 * export the accounts table's owning row of itself.
 */
export function exportGaps(): string[] {
  const covered = new Set([...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES), "users"]);
  return ALL_TABLES.filter((t) => !covered.has(t));
}

async function dumpTable(db: Db, table: string): Promise<unknown[]> {
  const res = await db.execute(sql`select * from ${sql.identifier(table)}`);
  return res.rows;
}

async function dumpUserTable(db: Db, table: string, userId: string): Promise<unknown[]> {
  const linked = LINKED_TABLES[table];
  const res = linked
    ? await db.execute(sql`
        select c.* from ${sql.identifier(table)} c
        join ${sql.identifier(linked.parent)} p on p.id = c.${sql.identifier(linked.fk)}
        where p.user_id = ${userId}`)
    : await db.execute(sql`
        select * from ${sql.identifier(table)}
        where ${sql.identifier(USER_TABLES[table]!)} = ${userId}`);
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
  for (const t of [...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES)]) {
    out[t] = await dumpUserTable(db, t, userId);
  }
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
