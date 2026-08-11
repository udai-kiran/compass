import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import type { Config } from "../../../config.ts";
import type { Db } from "../../../db/index.ts";
import { writeArchive, type ArchiveFileRef, type ArchiveHeader } from "../../../lib/backup-archive.ts";
import { toCsv } from "../../../lib/csv.ts";
import { encryptBackup, encryptBackupStream } from "../../../lib/crypto-backup.ts";
import type { Storage } from "../../../lib/storage.ts";

/**
 * Every application table in a stable logical order. This is not, and cannot be,
 * a strict FK topological order: accounts.goal_id references goals (which is
 * listed later), and categories.parent_id is self-referential. Restore code must
 * handle those references in two passes. Kept exhaustive on purpose: a table
 * missing here silently drops out of the encrypted backup, so the schema-coverage
 * test guards it against drift as new tables are added.
 *
 * `sips` is placed after `holdings` (not next to `goals`, where it logically
 * belongs) because it FKs both: goal_id and, for an mf_folio target,
 * target_holding_id. Unlike accounts.goal_id/categories.parent_id it has no
 * deferred-column entry below — its one forward-ish reference is just avoided
 * by ordering instead. It must also come *before* `holding_events`:
 * holding_events.sip_id references sips (the SIP installment a buy booked),
 * so sips has to exist first or that FK would target a not-yet-inserted row.
 *
 * `postings` is placed immediately after `transactions` (not with the other
 * ledger-linked children further down) because it FKs accounts, categories,
 * AND transactions — it has to restore after all three of its parents.
 */
export const ALL_TABLES = [
  "users", "accounts", "categories", "resources", "transactions", "postings", "user_tasks", "transaction_splits", "transfer_links",
  "attachments", "transaction_links", "imports", "import_rows", "import_presets", "merchant_rules",
  "budgets", "budget_lines", "budget_alerts", "notifications", "recurring_templates",
  "goals", "alert_ledger", "subscription_dismissals", "notification_prefs", "projection_settings",
  "user_profiles", "family_members",
  "ai_settings",
  "card_details", "card_issuer_settings", "card_statements", "bank_details", "retirement_details", "account_nps_details", "overdraft_details",
  "insurance_policies", "insurance_health_cards",
  "reward_entries", "emi_details", "holdings", "nps_details", "gold_details",
  "holding_valuations", "sips", "holding_events", "net_worth_snapshots",
  "mailbox_accounts", "mailbox_credentials", "email_ingestions", "extracted_transactions",
  "statement_reconciliations", "ai_events",
] as const;

/** Tables that carry a user_id directly — scoped by that column in the export. */
export const USER_TABLES: Record<string, string> = {
  accounts: "user_id", categories: "user_id", resources: "user_id", transactions: "user_id", user_tasks: "user_id", transfer_links: "user_id",
  imports: "user_id", import_presets: "user_id", merchant_rules: "user_id",
  budgets: "user_id", budget_alerts: "user_id", notifications: "user_id", recurring_templates: "user_id",
  goals: "user_id", sips: "user_id", alert_ledger: "user_id", subscription_dismissals: "user_id", notification_prefs: "user_id",
  projection_settings: "user_id", user_profiles: "user_id", family_members: "user_id", ai_settings: "user_id",
  card_details: "user_id", card_issuer_settings: "user_id", card_statements: "user_id",
  bank_details: "user_id", retirement_details: "user_id", account_nps_details: "user_id",
  overdraft_details: "user_id", insurance_policies: "user_id", insurance_health_cards: "user_id",
  reward_entries: "user_id", emi_details: "user_id",
  holdings: "user_id", nps_details: "user_id", gold_details: "user_id",
  net_worth_snapshots: "user_id",
  mailbox_accounts: "user_id", mailbox_credentials: "user_id",
  email_ingestions: "user_id", extracted_transactions: "user_id",
  statement_reconciliations: "user_id", ai_events: "user_id",
};

/**
 * Child tables with no user_id of their own — scoped through a parent that has
 * one, so the export stays a complete per-user reconstruction rather than only
 * the rows Postgres happens to tag with a user_id.
 */
export const LINKED_TABLES: Record<string, { fk: string; parent: string }> = {
  transaction_splits: { fk: "transaction_id", parent: "transactions" },
  postings: { fk: "transaction_id", parent: "transactions" },
  attachments: { fk: "transaction_id", parent: "transactions" },
  transaction_links: { fk: "transaction_id", parent: "transactions" },
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

/**
 * A user's transactions as CSV.
 *
 * Amount, Account and Category are derived from the `postings` table, not from
 * the legacy `transactions.amount_paise` / `account_id` / `category_id` columns.
 * Two independent LEFT JOIN LATERAL sub-queries keep cardinality exactly one row
 * per transaction even for split transactions:
 *   - The real posting (`system_kind IS NULL`) supplies Amount and Account.
 *   - The counter postings (`system_kind IS NOT NULL`) supply Category as the
 *     sorted distinct set of category names joined with `"; "`.
 *
 * Deliberate divergences from the legacy CSV shape (design ruling D9):
 *   - A split transaction's Category is the joined sorted distinct counter
 *     categories, not the stale parent `category_id`.
 *   - A transfer leg, an opening row, or a postings-less transaction exports
 *     blank Category, regardless of any legacy `category_id` still set.
 *   - A transaction with no real posting exports blank Amount AND blank Account,
 *     never `0` (D3).
 *
 * AC18 — bigint safety: `postings.amount_paise` is a bigint column; the pg driver
 * returns it as a string, which `Number()` converts to a JS number. For personal-
 * finance amounts in paise this is within Number.MAX_SAFE_INTEGER (≈ 90 trillion
 * rupees) and the existing behaviour is explicitly accepted here.
 */
export async function transactionsCsv(db: Db, userId: string): Promise<string> {
  const res = await db.execute(sql`
    select
      t.date, t.merchant, rp.amount_paise,
      coalesce(cat.category, '') as category,
      rp.account, t.notes
    from transactions t
    left join lateral (
      select p.amount_paise, a.name as account
      from postings p
      join accounts a on a.id = p.account_id
                     and a.user_id = t.user_id
                     and a.system_kind is null
      where p.transaction_id = t.id
      order by (p.amount_paise < 0) desc, p.id
      limit 1
    ) rp on true
    left join lateral (
      select string_agg(x.name, '; ' order by x.name collate "C") as category
      from (
        select distinct c.name
        from postings cp
        join accounts ca on ca.id = cp.account_id
                        and ca.user_id = t.user_id
                        and ca.system_kind is not null
        join categories c on c.id = cp.category_id
                         and c.user_id = t.user_id
        where cp.transaction_id = t.id
      ) x
    ) cat on true
    where t.user_id = ${userId} and t.deleted_at is null
    order by t.date desc
  `);
  const rows: Array<Array<string | number>> = [["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]];
  for (const r of res.rows as Array<Record<string, unknown>>) {
    rows.push([
      String(r.date), String(r.merchant ?? ""),
      r.amount_paise === null ? "" : Number(r.amount_paise),
      String(r.category ?? ""),
      r.account === null ? "" : String(r.account),
      String(r.notes ?? ""),
    ]);
  }
  return toCsv(rows);
}

/**
 * Every column that holds an opaque storage key. The archive builder pulls the
 * referenced objects from these; the orphan report treats any object NOT
 * referenced here as unowned. A new file-bearing table must be added here or
 * its files silently drop out of backups — the drift test guards this against
 * the schema.
 */
export const FILE_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: "attachments", column: "stored_path" },
  { table: "insurance_policies", column: "document_path" },
  { table: "insurance_health_cards", column: "stored_path" },
  { table: "card_statements", column: "stored_path" },
];

/** File references found in an exported per-user dump, in FILE_COLUMNS order. */
export function collectFileRefs(tables: ArchiveHeader["tables"]): ArchiveFileRef[] {
  const refs: ArchiveFileRef[] = [];
  for (const { table, column } of FILE_COLUMNS) {
    for (const row of tables[table] ?? []) {
      const key = row[column];
      if (typeof key === "string" && key !== "") {
        refs.push({ table, column, rowId: String(row.id), key });
      }
    }
  }
  return refs;
}

/**
 * One user's complete backup — every row plus every storage object those rows
 * reference — as an encrypted v2 envelope stream (constant memory; blobs are
 * fetched one at a time as the stream drains). A missing storage object is
 * recorded as an empty frame rather than failing the whole backup.
 */
export async function buildUserBackupStream(
  db: Db,
  storage: Storage,
  userId: string,
  passphrase: string,
): Promise<Readable> {
  const tables: ArchiveHeader["tables"] = {};
  for (const t of [...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES)]) {
    tables[t] = (await dumpUserTable(db, t, userId)) as Array<Record<string, unknown>>;
  }
  const header: ArchiveHeader = {
    version: 2,
    exportedAt: new Date().toISOString(),
    userId,
    tables,
    files: collectFileRefs(tables),
  };
  const plaintext = Readable.from(writeArchive(header, (ref) => storage.get(ref.key).catch(() => null)));
  return encryptBackupStream(plaintext, passphrase);
}

/** Storage keys referenced by any row, across all users. */
export async function referencedStorageKeys(db: Db): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const { table, column } of FILE_COLUMNS) {
    const res = await db.execute(sql`
      select ${sql.identifier(column)} as key from ${sql.identifier(table)}
      where ${sql.identifier(column)} is not null`);
    for (const row of res.rows as Array<{ key: string }>) if (row.key) keys.add(row.key);
  }
  return keys;
}

/**
 * Objects in storage that no row references (from crashed uploads or the
 * best-effort deletes). Report only — deleting is a human decision.
 */
export async function orphanedStorageKeys(
  db: Db,
  storage: Storage,
): Promise<{ total: number; orphans: string[] }> {
  const referenced = await referencedStorageKeys(db);
  const keys = await storage.list();
  return { total: keys.length, orphans: keys.filter((key) => !referenced.has(key)) };
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
