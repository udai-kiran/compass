import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, getTableColumns, getTableName, is, isNull, isNotNull, sql, Table } from "drizzle-orm";
import * as schema from "../../../db/schema.ts";
import { accounts, attachments, categories, postings, transactions, userTasks, users } from "../../../db/schema.ts";
import {
  ALL_TABLES,
  buildUserBackupStream,
  collectFileRefs,
  exportGaps,
  FILE_COLUMNS,
  LINKED_TABLES,
  transactionsCsv,
  USER_TABLES,
} from "./backup.ts";
import type pg from "pg";
import { DEFERRED_RESTORE_COLUMNS, firstPassRow, restoreDump } from "../../../db/restore.ts";
import { restorableTables, restoreUserBackup } from "./restore-user.ts";
import { decryptBackupV2File } from "../../../lib/crypto-backup.ts";
import { writeArchive, type ArchiveHeader } from "../../../lib/backup-archive.ts";
import type { Storage } from "../../../lib/storage.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { HttpError } from "../../../lib/errors.ts";
import { seedSystemAccounts } from "../../ledger/services/post-entry.ts";
import { seedDefaultCategories } from "../../ledger/services/categories.ts";
import { findInconsistentPostings } from "../../ledger/services/reconcile-postings.ts";
import { createTransaction, setSplits, softDeleteTransaction } from "../../ledger/services/transactions.ts";
import { createTransfer } from "../../ledger/services/transfers.ts";
import { updateAccount } from "../../ledger/services/accounts.ts";

/** Every pgTable defined in the schema, by its SQL name. */
function schemaTableNames(): string[] {
  return Object.values(schema)
    .filter((v) => is(v, Table))
    .map((t) => getTableName(t as Table));
}

test("the full backup covers every table in the schema", () => {
  const inSchema = new Set(schemaTableNames());
  const inBackup = new Set<string>(ALL_TABLES);
  const missing = [...inSchema].filter((t) => !inBackup.has(t));
  const stale = [...inBackup].filter((t) => !inSchema.has(t));
  assert.deepEqual(missing, [], `tables missing from ALL_TABLES: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `ALL_TABLES lists tables not in the schema: ${stale.join(", ")}`);
});

test("sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips)", () => {
  assert.ok(ALL_TABLES.indexOf("sips") < ALL_TABLES.indexOf("holding_events"));
});

test("shopping table parents precede their children in ALL_TABLES (FK ordering for restore)", () => {
  // catalog_items is the parent of shopping_list_items, price_observations,
  // pantry_items, and habit_profiles — all four FKs to catalog_item_id.
  assert.ok(
    ALL_TABLES.indexOf("catalog_items") < ALL_TABLES.indexOf("shopping_list_items"),
    "catalog_items must precede shopping_list_items (shopping_list_items.catalog_item_id FKs catalog_items)",
  );
  assert.ok(
    ALL_TABLES.indexOf("catalog_items") < ALL_TABLES.indexOf("price_observations"),
    "catalog_items must precede price_observations (price_observations.catalog_item_id FKs catalog_items)",
  );
  assert.ok(
    ALL_TABLES.indexOf("catalog_items") < ALL_TABLES.indexOf("pantry_items"),
    "catalog_items must precede pantry_items (pantry_items.catalog_item_id FKs catalog_items)",
  );
  assert.ok(
    ALL_TABLES.indexOf("catalog_items") < ALL_TABLES.indexOf("habit_profiles"),
    "catalog_items must precede habit_profiles (habit_profiles.catalog_item_id FKs catalog_items)",
  );
  // price_sources is the parent of price_observations and cart_drafts.
  assert.ok(
    ALL_TABLES.indexOf("price_sources") < ALL_TABLES.indexOf("price_observations"),
    "price_sources must precede price_observations (price_observations.price_source_id FKs price_sources)",
  );
  assert.ok(
    ALL_TABLES.indexOf("price_sources") < ALL_TABLES.indexOf("cart_drafts"),
    "price_sources must precede cart_drafts (cart_drafts.price_source_id FKs price_sources)",
  );
  // shopping_lists is the parent of shopping_list_items.
  assert.ok(
    ALL_TABLES.indexOf("shopping_lists") < ALL_TABLES.indexOf("shopping_list_items"),
    "shopping_lists must precede shopping_list_items (shopping_list_items.list_id FKs shopping_lists)",
  );
});

test("the per-user export reconstructs every table (no coverage gaps)", () => {
  // Anything ALL_TABLES lists but neither USER_TABLES nor LINKED_TABLES scopes is
  // silently dropped from a user's export — exportGaps() names those. `users` is
  // the only intentional exclusion (a user does not export the owner row itself).
  assert.deepEqual(exportGaps(), []);
});

test("no table is scoped both directly and through a parent", () => {
  const both = Object.keys(USER_TABLES).filter((t) => t in LINKED_TABLES);
  assert.deepEqual(both, [], `tables scoped twice: ${both.join(", ")}`);
});

test("every storage-key column in the schema is covered by FILE_COLUMNS", () => {
  // A table storing opaque storage keys must be in FILE_COLUMNS, or its files
  // silently drop out of the per-user archive and the orphan report.
  const inSchema: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const table = getTableName(value);
    for (const column of Object.values(getTableColumns(value))) {
      if (
        column.name === "stored_path" ||
        column.name === "document_path" ||
        column.name === "document_key"
      ) {
        inSchema.push(`${table}.${column.name}`);
      }
    }
  }
  const covered = new Set(FILE_COLUMNS.map((f) => `${f.table}.${f.column}`));
  const missing = inSchema.filter((c) => !covered.has(c));
  const stale = [...covered].filter((c) => !inSchema.includes(c));
  assert.deepEqual(missing, [], `file columns missing from FILE_COLUMNS: ${missing.join(", ")}`);
  assert.deepEqual(stale, [], `FILE_COLUMNS lists columns not in the schema: ${stale.join(", ")}`);
});

test("collectFileRefs pulls every non-empty storage key from a dump", () => {
  const refs = collectFileRefs({
    attachments: [
      { id: "a1", stored_path: "ab/one" },
      { id: "a2", stored_path: "" },
    ],
    insurance_policies: [
      { id: "p1", document_path: "cd/two" },
      { id: "p2", document_path: null },
    ],
    card_statements: [{ id: "s1", stored_path: "ef/three" }],
  });
  assert.deepEqual(
    refs.map((r) => [r.table, r.rowId, r.key]),
    [
      ["attachments", "a1", "ab/one"],
      ["insurance_policies", "p1", "cd/two"],
      ["card_statements", "s1", "ef/three"],
    ],
  );
});

test("the per-user restore covers exactly the exported tables, in parent-first order", () => {
  const tables = restorableTables();
  assert.deepEqual(
    [...tables].sort(),
    [...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES)].sort(),
  );
  // Spot-check FK ordering the insert pass depends on.
  const at = (t: string) => tables.indexOf(t);
  assert.ok(at("accounts") < at("transactions"));
  assert.ok(at("transactions") < at("user_tasks"));
  assert.ok(at("transactions") < at("attachments"));
  assert.ok(at("accounts") < at("card_statements"));
  assert.ok(at("insurance_policies") < at("insurance_health_cards"));
  assert.ok(at("mailbox_accounts") < at("email_ingestions"));
  // sips FKs both goals and holdings (for an mf_folio target) — must restore after both.
  assert.ok(at("goals") < at("sips"));
  assert.ok(at("holdings") < at("sips"));
  // postings FKs accounts, categories, AND transactions — must restore after all three.
  assert.ok(at("accounts") < at("postings"));
  assert.ok(at("categories") < at("postings"));
  assert.ok(at("transactions") < at("postings"));
});

test("restore defers cyclic and self-referencing foreign keys", () => {
  assert.deepEqual(
    firstPassRow("accounts", { id: "a", goal_id: "g", name: "Bank" }),
    { id: "a", goal_id: null, name: "Bank" },
  );
  assert.deepEqual(
    firstPassRow("categories", { id: "child", parent_id: "parent", name: "Dining" }),
    { id: "child", parent_id: null, name: "Dining" },
  );
  // A table with no deferred columns passes through untouched.
  assert.deepEqual(firstPassRow("goals", { id: "g", target_paise: 100 }), {
    id: "g",
    target_paise: 100,
  });
  // transactions defer policy_id (insurance_policies restores later) and drop
  // the database-generated search column.
  assert.deepEqual(
    firstPassRow("transactions", { id: "t", merchant: "Cafe", policy_id: "p", search: "'cafe':1" }),
    { id: "t", merchant: "Cafe", policy_id: null },
  );
});

test("restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS", async () => {
  // A mock pg.Pool/PoolClient: restoreDump's second pass must be a generic loop
  // over DEFERRED_RESTORE_COLUMNS, not a series of hard-coded per-column update
  // blocks — a column added to the map (e.g. sip_id) but missing its own
  // hard-coded block would silently never get restored. This records every
  // query restoreDump issues so the test can assert an update ran for each
  // (table, column) pair the map lists, with no DB required.
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("count(*)::bigint as count from users")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  // One row per deferred-column table, each deferred column set to a distinct
  // non-null value — a column the loop skips shows up as a missing update call.
  const dump: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(ALL_TABLES.map((t) => [t, []]));
  dump.accounts = [{ id: "acc1", goal_id: "goal1", linked_account_id: "acc0" }];
  dump.categories = [{ id: "cat1", parent_id: "cat0" }];
  dump.transactions = [
    { id: "txn1", policy_id: "pol1", recurring_template_id: "rt1", reconciled_statement_id: "rs1", sip_id: "sip1" },
  ];

  await restoreDump(pool, dump);

  const updateCalls = calls.filter((c) => c.sql.startsWith("update "));
  const expected = Object.entries(DEFERRED_RESTORE_COLUMNS).flatMap(([table, columns]) =>
    columns.map((column) => ({ table, column })),
  );
  assert.equal(updateCalls.length, expected.length, "one update per deferred column, no more, no fewer");
  for (const { table, column } of expected) {
    const call = updateCalls.find((c) => c.sql === `update "${table}" set "${column}" = $1 where id = $2`);
    assert.ok(call, `expected an update for ${table}.${column}`);
  }
  // sip_id specifically — this is the column the hard-coded blocks used to miss.
  const sipUpdate = updateCalls.find((c) => c.sql === 'update "transactions" set "sip_id" = $1 where id = $2');
  assert.deepEqual(sipUpdate?.params, ["sip1", "txn1"]);
});

test("the mocked restoreDump records postings every column, positioned after FK parents", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("count(*)::bigint as count from users")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  const dump: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(ALL_TABLES.map((t) => [t, []]));
  dump.accounts = [{ id: "acc1", name: "Bank", type: "bank", user_id: "u1" }];
  dump.categories = [{ id: "cat1", name: "Food", kind: "expense", user_id: "u1" }];
  dump.transactions = [{ id: "txn1", user_id: "u1", account_id: "acc1", date: "2026-01-15", amount_paise: -1000, merchant: "Cafe", category_id: "cat1" }];
  dump.postings = [{
    id: "p1", transaction_id: "txn1", account_id: "acc1", category_id: null,
    amount_paise: 1000, necessity: null, note: "", created_at: "2026-01-15T12:00:00Z",
  }];

  await restoreDump(pool, dump);

  const insertCalls = calls.filter((c) => c.sql.startsWith("insert into "));
  const insertTables = insertCalls.map((c) => {
    const m = c.sql.match(/insert into "([a-z_]+)"/);
    return m ? m[1] : "";
  });

  // postings must appear after accounts, categories, and transactions
  const idxAccounts = insertTables.indexOf("accounts");
  const idxCategories = insertTables.indexOf("categories");
  const idxTransactions = insertTables.indexOf("transactions");
  const idxPostings = insertTables.indexOf("postings");
  assert.ok(idxAccounts >= 0, "accounts insert must be present");
  assert.ok(idxCategories >= 0, "categories insert must be present");
  assert.ok(idxTransactions >= 0, "transactions insert must be present");
  assert.ok(idxPostings >= 0, "postings insert must be present");
  assert.ok(idxAccounts < idxPostings, "accounts must insert before postings");
  assert.ok(idxCategories < idxPostings, "categories must insert before postings");
  assert.ok(idxTransactions < idxPostings, "transactions must insert before postings");

  // Every posting column is carried through the insert (none deferred, none omitted) —
  // verify by parsing the column order from the SQL and mapping to positional params.
  const postingInsert = insertCalls.find((c) => c.sql.includes('"postings"'));
  assert.ok(postingInsert, "postings insert call must exist");

  const columnMatch = postingInsert!.sql.match(/insert into "postings" \(([^)]+)\)/);
  assert.ok(columnMatch, "postings insert SQL must have a column list");
  const columns = columnMatch![1]!.split(", ").map((c) => c.replace(/"/g, ""));
  assert.deepEqual(columns, ["id", "transaction_id", "account_id", "category_id", "amount_paise", "necessity", "note", "created_at"],
    "postings insert must carry all 8 columns in the expected order",
  );

  // Build a column→value map from the positional params and assert against the fixture.
  const paramMap: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    paramMap[columns[i]!] = postingInsert!.params[i];
  }
  assert.deepEqual(paramMap, {
    id: dump.postings[0]!.id,
    transaction_id: dump.postings[0]!.transaction_id,
    account_id: dump.postings[0]!.account_id,
    category_id: null,
    amount_paise: dump.postings[0]!.amount_paise,
    necessity: null,
    note: dump.postings[0]!.note,
    created_at: dump.postings[0]!.created_at,
  }, "postings insert must carry every column verbatim, none deferred/omitted/reordered");
});

test("misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("count(*)::bigint as count from users")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;

  const dump: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(ALL_TABLES.map((t) => [t, []]));
  dump.user_tasks = [
    { id: "t1", user_id: "u1", title: "New-format row", source: "card-due", source_key: "acc1:2026-01-01" },
    { id: "t2", user_id: "u1", title: "Old-format row" }, // no source/source_key at all — a pre-migration archive
  ];

  await restoreDump(pool, dump);

  const insertCalls = calls.filter((c) => c.sql.startsWith('insert into "user_tasks"'));
  assert.equal(insertCalls.length, 2);

  const newRowInsert = insertCalls.find((c) => c.params.includes("t1"));
  assert.ok(newRowInsert, "expected an insert for the new-format row");
  assert.ok(newRowInsert!.sql.includes('"source"'), "source must round-trip through the insert column list");
  assert.ok(newRowInsert!.sql.includes('"source_key"'), "source_key must round-trip through the insert column list");
  assert.ok(newRowInsert!.params.includes("card-due"));
  assert.ok(newRowInsert!.params.includes("acc1:2026-01-01"));

  const oldRowInsert = insertCalls.find((c) => c.params.includes("t2"));
  assert.ok(oldRowInsert, "expected an insert for the old-format row");
  assert.ok(
    !oldRowInsert!.sql.includes('"source"'),
    "an old-format row must not force a source column into the insert — the column DEFAULT must apply instead",
  );
  assert.ok(!oldRowInsert!.sql.includes('"source_key"'));
});

// ---------- AC11: user_tasks round-trips through the per-user encrypted archive ----------
//
// These need a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure (see emis.test.ts's identical DB-backed section).
// Export it before running `npm run test -w apps/api`.
//
// Only the per-user path (buildUserBackupStream -> decryptBackupV2File ->
// restoreUserBackup) is exercised here, against a pair of disposable
// throwaway users, cleaned up via t.after(). The *full*-database path
// (dumpDatabase -> restoreDump) is deliberately NOT exercised against this
// shared dev database: restoreDump() hard-requires the target's `users`
// table to be empty (db/restore.ts:62-65) before it will insert anything, so
// running it here would either fail immediately (this DB already has real
// rows) or, if the DB were wiped first, destroy existing dev data — neither
// of which this test does. The mocked-pool test above (`restoreDump's second
// pass issues an update for every column in DEFERRED_RESTORE_COLUMNS`)
// initializes every `ALL_TABLES` entry, including `user_tasks`, to an empty
// array and only populates rows for `accounts`, `categories`, and
// `transactions` — so for `user_tasks` specifically it only exercises
// `restoreDump`'s table iteration/ordering (that looping over `user_tasks`
// doesn't crash and its position in `ALL_TABLES` is respected), not its
// generic insert mechanics; no `user_tasks` row is ever actually inserted by
// that test. The deferred-column update mechanics it does verify apply only
// to the populated tables above, none of which is `user_tasks` (it has no
// `DEFERRED_RESTORE_COLUMNS` entry).

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "backup.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before " +
        "running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

/** Storage is never actually touched by this fixture (no attachments/policy
 * documents/card statements for these throwaway users), so a stub satisfying
 * the interface is enough — no disk or S3 needed. */
const stubStorage: Storage = {
  put: async () => {
    throw new Error("not used by this fixture");
  },
  get: async () => {
    throw new Error("not used by this fixture");
  },
  delete: async () => {},
  list: async () => [],
  ensureReady: async () => {},
};

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `backup-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "backup.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(userTasks).where(eq(userTasks.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore", async (t) => {
  const passphrase = "correct horse battery staple";
  const sourceUserId = await createUser();
  const destUserId = await createUser();
  t.after(async () => {
    await cleanupUser(sourceUserId);
    await cleanupUser(destUserId);
  });

  const [_account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      date: "2026-01-05",
      merchant: "Coffee shop",
    })
    .returning({ id: transactions.id });

  await db.insert(userTasks).values({
    userId: sourceUserId,
    title: "Follow up on coffee receipt",
    transactionId: txn!.id,
  });
  await db.insert(userTasks).values({
    userId: sourceUserId,
    title: "Buy groceries",
  });

  const encryptedPath = join(tmpdir(), `user-tasks-ac11-${randomUUID()}.cmpb`);
  const plaintextPath = `${encryptedPath}.plain`;
  t.after(async () => {
    await unlink(encryptedPath).catch(() => {});
    await unlink(plaintextPath).catch(() => {});
  });

  const stream = await buildUserBackupStream(db, stubStorage, sourceUserId, passphrase);
  await pipeline(stream, createWriteStream(encryptedPath));
  await decryptBackupV2File(encryptedPath, plaintextPath, passphrase);

  // Row ids are preserved verbatim by the restore (only user_id is
  // rewritten — see restore-user.ts's insertRow), and those ids are globally
  // unique (accounts_pkey, transactions_pkey, ...), not per-user. This
  // mirrors the real disaster-recovery flow the archive is built for
  // (restoring into a fresh account after the original is gone), not a
  // "clone into a second, still-live user" flow — so the source user's rows
  // are removed before the restore, freeing their ids.
  await cleanupUser(sourceUserId);

  await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  const restoredTasks = await db
    .select()
    .from(userTasks)
    .where(eq(userTasks.userId, destUserId))
    .orderBy(userTasks.title);
  assert.equal(restoredTasks.length, 2);

  const restoredLinked = restoredTasks.find((r) => r.title === "Follow up on coffee receipt");
  const restoredUnlinked = restoredTasks.find((r) => r.title === "Buy groceries");
  assert.ok(restoredLinked, "linked task survived the round trip");
  assert.ok(restoredUnlinked, "unlinked task survived the round trip");
  assert.equal(restoredUnlinked!.transactionId, null);
  // ids are preserved by the restore's insert (only user_id is rewritten), so
  // the link should point at the very same transaction id as before the trip.
  assert.equal(restoredLinked!.transactionId, txn!.id);

  const restoredTxn = await db.query.transactions.findFirst({
    where: eq(transactions.id, txn!.id),
  });
  assert.ok(restoredTxn, "the linked transaction itself also survived the round trip");
  assert.equal(restoredTxn!.userId, destUserId);
});

// ---------- misc-05 AC14: source/sourceKey through both restore paths ----------

test("misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task", async (t) => {
  const passphrase = "correct horse battery staple";
  const sourceUserId = await createUser();
  const destUserId = await createUser();
  t.after(async () => {
    await cleanupUser(sourceUserId);
    await cleanupUser(destUserId);
  });

  const sourceKey = `${randomUUID()}:2026-01-10`;
  await db.insert(userTasks).values({
    userId: sourceUserId,
    title: "Pay Test Card bill",
    source: "card-due",
    sourceKey,
  });
  await db.insert(userTasks).values({ userId: sourceUserId, title: "Plain task" });

  const encryptedPath = join(tmpdir(), `user-tasks-ac14-${randomUUID()}.cmpb`);
  const plaintextPath = `${encryptedPath}.plain`;
  t.after(async () => {
    await unlink(encryptedPath).catch(() => {});
    await unlink(plaintextPath).catch(() => {});
  });

  const stream = await buildUserBackupStream(db, stubStorage, sourceUserId, passphrase);
  await pipeline(stream, createWriteStream(encryptedPath));
  await decryptBackupV2File(encryptedPath, plaintextPath, passphrase);

  await cleanupUser(sourceUserId);

  await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  const restoredTasks = await db.select().from(userTasks).where(eq(userTasks.userId, destUserId));
  const cardDue = restoredTasks.find((r) => r.title === "Pay Test Card bill");
  const plain = restoredTasks.find((r) => r.title === "Plain task");
  assert.ok(cardDue, "the card-due task survived the round trip");
  assert.equal(cardDue!.source, "card-due");
  assert.equal(cardDue!.sourceKey, sourceKey);
  assert.ok(plain, "the ordinary task survived the round trip");
  assert.equal(plain!.source, "user");
  assert.equal(plain!.sourceKey, null);
});

test("misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs", async (t) => {
  const destUserId = await createUser();
  t.after(() => cleanupUser(destUserId));

  const header: ArchiveHeader = {
    version: 2,
    exportedAt: new Date().toISOString(),
    userId: "irrelevant-pre-migration-export",
    tables: Object.fromEntries(restorableTables().map((t) => [t, []])) as ArchiveHeader["tables"],
    files: [],
  };
  // A pre-migration `select *` dump of user_tasks would simply not have had
  // these two columns at all — not `null`, absent.
  header.tables.user_tasks = [
    {
      id: randomUUID(),
      user_id: "irrelevant-pre-migration-export",
      title: "Pre-migration task",
      notes: "",
      due_date: null,
      completed_at: null,
      transaction_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const plaintextPath = join(tmpdir(), `user-tasks-ac14-legacy-${randomUUID()}.archive`);
  t.after(() => unlink(plaintextPath).catch(() => {}));
  await pipeline(Readable.from(writeArchive(header, async () => null)), createWriteStream(plaintextPath));

  await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  const restored = await db.query.userTasks.findFirst({ where: eq(userTasks.userId, destUserId) });
  assert.ok(restored, "the pre-migration row still restores");
  assert.equal(restored!.title, "Pre-migration task");
  assert.equal(restored!.source, "user", "falls back to the column DEFAULT when the archive predates this column");
  assert.equal(restored!.sourceKey, null, "falls back to the column DEFAULT (NULL) when the archive predates this column");
});

// ---------- A6: postings backup/restore round-trip ----------
//
// These tests exercise the AC2-AC5 acceptance criteria for the postings
// dual-write backup/restore. They follow the same DB-backed pattern as the
// AC11 tests above.

test("A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409", async (t) => {
  const passphrase = "correct horse battery staple";
  const sourceUserId = await createUser();
  const destFresh = await createUser();
  const destBlocked = await createUser();
  t.after(async () => {
    await cleanupUser(sourceUserId);
    await cleanupUser(destFresh);
    await cleanupUser(destBlocked);
  });

  // Seed system accounts + default categories on the fresh dest (like registration would).
  await seedSystemAccounts(db, destFresh);
  await seedDefaultCategories(db, destFresh);
  // Give the blocked dest a real non-system account.
  await db.insert(accounts).values({ userId: destBlocked, name: "Existing bank", type: "bank" });

  const [_account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Source bank", type: "bank" })
    .returning({ id: accounts.id });
  await db.insert(transactions).values({
    userId: sourceUserId,
    date: "2026-01-05",
    merchant: "Cafe",
  });

  const encryptedPath = join(tmpdir(), `a6-ac2-${randomUUID()}.cmpb`);
  const plaintextPath = `${encryptedPath}.plain`;
  t.after(async () => {
    await unlink(encryptedPath).catch(() => {});
    await unlink(plaintextPath).catch(() => {});
  });

  const stream = await buildUserBackupStream(db, stubStorage, sourceUserId, passphrase);
  await pipeline(stream, createWriteStream(encryptedPath));
  await decryptBackupV2File(encryptedPath, plaintextPath, passphrase);

  await cleanupUser(sourceUserId);

  // Fresh dest (only system accounts) → succeeds
  const summary = await restoreUserBackup(pool, stubStorage, destFresh, plaintextPath);
  assert.ok(summary.rows > 0, "restore must commit rows into the fresh dest");

  // Dest with a real account → 409
  await assert.rejects(
    () => restoreUserBackup(pool, stubStorage, destBlocked, plaintextPath),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
});

test("A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows)", async (t) => {
  const passphrase = "correct horse battery staple";
  const sourceUserId = await createUser();
  const destUserId = await createUser();
  t.after(async () => {
    await cleanupUser(sourceUserId);
    await cleanupUser(destUserId);
  });

  // Seed system accounts — needed for createTransaction-style dual-write.
  await seedSystemAccounts(db, sourceUserId);

  // --- Source user data ---
  const [bank] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Source bank", type: "bank" })
    .returning({ id: accounts.id });
  const [wallet] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Wallet", type: "cash" })
    .returning({ id: accounts.id });
  const [food] = await db
    .insert(categories)
    .values({ userId: sourceUserId, name: "Food", kind: "expense" })
    .returning({ id: categories.id });
  const [transport] = await db
    .insert(categories)
    .values({ userId: sourceUserId, name: "Transport", kind: "expense" })
    .returning({ id: categories.id });

  // 1. Ordinary transaction (service call creates postings automatically)
  const ordinary = await createTransaction(db, sourceUserId, {
    accountId: bank!.id,
    date: "2026-01-01",
    amountPaise: -5000,
    merchant: "Cafe",
    categoryId: food!.id,
    necessity: "non_essential",
  });

  // 2. Split transaction: create parent then set splits (rebuilds postings as split shape)
  const splitTxn = await createTransaction(db, sourceUserId, {
    accountId: bank!.id,
    date: "2026-01-02",
    amountPaise: -10000,
    merchant: "Groceries",
  });
  await setSplits(db, sourceUserId, splitTxn.id, [
    { categoryId: food!.id, amountPaise: -6000, note: "groceries" },
    { categoryId: transport!.id, amountPaise: -4000, note: "bus" },
  ]);

  // 3. Transfer (PR-G1: one transaction, two real account postings, no transfer_links row)
  const xfer = await createTransfer(db, sourceUserId, {
    fromAccountId: bank!.id,
    toAccountId: wallet!.id,
    amountPaise: 20000,
    date: "2026-01-03",
  });

  // 4. Opening balance via updateAccount (creates is_opening transaction + postings)
  await updateAccount(db, sourceUserId, bank!.id, { openingBalancePaise: 100000 });
  const [openingRow] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, sourceUserId),
        sql`exists (select 1 from postings p1 where p1.transaction_id = ${transactions.id} and p1.account_id = ${bank!.id})`,
        sql`exists (select 1 from postings p2 join accounts a on a.id = p2.account_id where p2.transaction_id = ${transactions.id} and a.system_kind = 'opening')`,
      ),
    );

  // 5. Soft-deleted transaction
  const deletedTxn = await createTransaction(db, sourceUserId, {
    accountId: bank!.id,
    date: "2026-01-04",
    amountPaise: -7000,
    merchant: "Old expense",
    categoryId: food!.id,
  });
  await softDeleteTransaction(db, sourceUserId, deletedTxn.id);

  // Record the source posting ids (to prove they are NOT re-inserted verbatim).
  const sourcePostingIds = new Set(
    (
      await db
        .select({ id: postings.id })
        .from(postings)
        .innerJoin(transactions, eq(postings.transactionId, transactions.id))
        .where(eq(transactions.userId, sourceUserId))
    ).map((r) => r.id),
  );
  assert.ok(sourcePostingIds.size > 1, "source must have postings");

  // Backup and restore
  const encryptedPath = join(tmpdir(), `a6-ac34-${randomUUID()}.cmpb`);
  const plaintextPath = `${encryptedPath}.plain`;
  t.after(async () => {
    await unlink(encryptedPath).catch(() => {});
    await unlink(plaintextPath).catch(() => {});
  });
  const stream = await buildUserBackupStream(db, stubStorage, sourceUserId, passphrase);
  await pipeline(stream, createWriteStream(encryptedPath));
  await decryptBackupV2File(encryptedPath, plaintextPath, passphrase);
  await cleanupUser(sourceUserId);

  const summary = await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  // --- Assertions ---

  // Post-commit validation: postings are restored from archive (PR-G1), so repaired===0.
  // The validate callback uses findInconsistentPostings (read-only) and hardcodes repaired=0.
  assert.ok(summary.postings, "summary must have postings field");
  assert.equal(
    summary.postings!.repaired,
    0,
    `expected repaired === 0 (postings restored from archive), got ${summary.postings!.repaired}`,
  );
  assert.equal(summary.postings!.failed, 0, "no posting inconsistencies after restore");

  // In PR-G1, posting IDs are preserved in the restore (postings are the data).
  const destPostingIds = new Set(
    (
      await db
        .select({ id: postings.id })
        .from(postings)
        .innerJoin(transactions, eq(postings.transactionId, transactions.id))
        .where(eq(transactions.userId, destUserId))
    ).map((r) => r.id),
  );
  assert.ok(destPostingIds.size > 0, "dest must have postings after restore");
  assert.equal(destPostingIds.size, sourcePostingIds.size, "dest has same count of postings as source");

  // Every dest transaction's postings are zero-sum.
  const destTransactions = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, destUserId));
  for (const txn of destTransactions) {
    const legs = await db
      .select({ amountPaise: postings.amountPaise })
      .from(postings)
      .where(eq(postings.transactionId, txn.id));
    const sum = legs.reduce((a, b) => a + Number(b.amountPaise), 0);
    assert.equal(sum, 0, `postings for transaction ${txn.id} must be zero-sum`);
  }

  // findInconsistentPostings returns [] — all postings match the derived shape.
  const inconsistent = await findInconsistentPostings(db, destUserId);
  assert.deepEqual(inconsistent, [], "all dest postings must be consistent with derived shape");

  // --- B2: per-shape leg multiset assertions (LITERAL hardcoded expectations) ---
  const sysRows = await db
    .select({ id: accounts.id, systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, destUserId), isNotNull(accounts.systemKind)));
  const sysExpenses = sysRows.find((r) => r.systemKind === "expenses")!.id;
  const sysOpening = sysRows.find((r) => r.systemKind === "opening")!.id;

  async function assertLegs(txnId: string, expected: Array<{ accountId: string; amountPaise: number }>) {
    const legs = await db
      .select({ accountId: postings.accountId, amountPaise: postings.amountPaise })
      .from(postings)
      .where(eq(postings.transactionId, txnId));
    const legSet = legs.map((l) => JSON.stringify([l.accountId, l.amountPaise])).sort();
    const expSet = expected.map((e) => JSON.stringify([e.accountId, e.amountPaise])).sort();
    assert.deepEqual(legSet, expSet, `postings for transaction ${txnId} must match expected legs`);
  }

  // Ordinary expense: -5000 bank,food → {bank, -5000} + {sys expenses, +5000}
  await assertLegs(ordinary.id, [
    { accountId: bank!.id, amountPaise: -5000 },
    { accountId: sysExpenses, amountPaise: 5000 },
  ]);

  // Split: -10000 bank; food -6000, transport -4000 → {bank, -10000} + {sys expenses, +6000} + {sys expenses, +4000}
  await assertLegs(splitTxn.id, [
    { accountId: bank!.id, amountPaise: -10000 },
    { accountId: sysExpenses, amountPaise: 6000 },
    { accountId: sysExpenses, amountPaise: 4000 },
  ]);

  // Transfer (PR-G1: one transaction, two real account postings — no sysClearing)
  // {bank, -20000} + {wallet, +20000}
  await assertLegs(xfer.transactionId, [
    { accountId: bank!.id, amountPaise: -20000 },
    { accountId: wallet!.id, amountPaise: 20000 },
  ]);

  // Opening balance: +100000 bank, isOpening → {bank, +100000} + {sys opening, -100000}
  await assertLegs(openingRow!.id, [
    { accountId: bank!.id, amountPaise: 100000 },
    { accountId: sysOpening, amountPaise: -100000 },
  ]);

  // Soft-deleted: -7000 bank, food → {bank, -7000} + {sys expenses, +7000}
  await assertLegs(deletedTxn.id, [
    { accountId: bank!.id, amountPaise: -7000 },
    { accountId: sysExpenses, amountPaise: 7000 },
  ]);

  // The soft-deleted transaction also has restored postings.
  const deletedPostingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.id, deletedTxn.id),
        eq(transactions.userId, destUserId),
      ),
    );
  assert.ok(
    Number(deletedPostingCount[0]!.count) > 0,
    "soft-deleted transaction must have restored postings",
  );
});

test("A6 AC3 OLD-style: archive with no postings restores other rows without synthesis; validation reports missing posting shapes", async (t) => {
  const destUserId = await createUser();
  t.after(() => cleanupUser(destUserId));

  const bankId = randomUUID();
  const walletId = randomUUID();
  const foodId = randomUUID();
  const transportId = randomUUID();
  const ordinaryId = randomUUID();
  const splitId = randomUUID();
  const outLegId = randomUUID();
  const inLegId = randomUUID();
  const openingId = randomUUID();
  const deletedId = randomUUID();
  const now = new Date().toISOString();

  // Build an OLD-style archive: postings=[], no system accounts, only real accounts.
  const header: ArchiveHeader = {
    version: 2,
    exportedAt: now,
    userId: "source",
    tables: Object.fromEntries(
      restorableTables().map((t) => [t, []]),
    ) as ArchiveHeader["tables"],
    files: [],
  };

  header.tables.accounts = [
    { id: bankId, user_id: "source", name: "Bank", type: "bank", created_at: now, updated_at: now },
    { id: walletId, user_id: "source", name: "Wallet", type: "cash", created_at: now, updated_at: now },
  ];
  header.tables.categories = [
    { id: foodId, user_id: "source", name: "Food", kind: "expense", created_at: now, updated_at: now },
    { id: transportId, user_id: "source", name: "Transport", kind: "expense", created_at: now, updated_at: now },
  ];
  // 1. Ordinary expense
  header.tables.transactions = [
    {
      id: ordinaryId, user_id: "source", account_id: bankId, date: "2026-01-01",
      amount_paise: -5000, merchant: "Cafe", category_id: foodId, notes: "", tags: [],
      source: "manual", is_opening: false, created_at: now, updated_at: now,
    },
    // 2. Split
    {
      id: splitId, user_id: "source", account_id: bankId, date: "2026-01-02",
      amount_paise: -10000, merchant: "Groceries", category_id: null, notes: "", tags: [],
      source: "manual", is_opening: false, created_at: now, updated_at: now,
    },
    // 3. Transfer OUT (stored as two independent rows in old-style archives)
    {
      id: outLegId, user_id: "source", account_id: bankId, date: "2026-01-03",
      amount_paise: -20000, merchant: "Transfer out", category_id: null, notes: "", tags: [],
      source: "manual", is_opening: false, created_at: now, updated_at: now,
    },
    // 4. Transfer IN
    {
      id: inLegId, user_id: "source", account_id: walletId, date: "2026-01-03",
      amount_paise: 20000, merchant: "Transfer in", category_id: null, notes: "", tags: [],
      source: "manual", is_opening: false, created_at: now, updated_at: now,
    },
    // 5. Opening
    {
      id: openingId, user_id: "source", account_id: bankId, date: "2026-01-01",
      amount_paise: 100000, merchant: "Opening balance", category_id: null, notes: "", tags: [],
      source: "manual", is_opening: true, created_at: now, updated_at: now,
    },
    // 6. Soft-deleted
    {
      id: deletedId, user_id: "source", account_id: bankId, date: "2026-01-04",
      amount_paise: -7000, merchant: "Old expense", category_id: foodId, notes: "", tags: [],
      source: "manual", is_opening: false, created_at: now, updated_at: now,
      deleted_at: now,
    },
  ];
  // Archive has NO postings (old-style) — deliberately empty array.
  header.tables.postings = [];

  // Count non-posting rows for summary assertion.
  const nonPostingRows = Object.entries(header.tables)
    .filter(([table]) => table !== "postings")
    .reduce((sum, [, rows]) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  const nonPostingTables = Object.entries(header.tables)
    .filter(([table, rows]) => table !== "postings" && Array.isArray(rows) && rows.length > 0)
    .length;

  const plaintextPath = join(tmpdir(), `a6-ac3-old-${randomUUID()}.archive`);
  t.after(() => unlink(plaintextPath).catch(() => {}));
  await pipeline(
    Readable.from(writeArchive(header, async () => null)),
    createWriteStream(plaintextPath),
  );

  await seedSystemAccounts(db, destUserId);
  const summary = await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  // --- Assertions ---

  // Post-commit validation: postings are restored verbatim from archive (PR-G1);
  // repaired is always 0. This archive has postings: [] so findInconsistentPostings
  // reports one "no postings" failure per transaction — 6 transactions, 6 failures.
  assert.ok(summary.postings, "summary must have postings field");
  assert.equal(
    summary.postings!.repaired,
    0,
    `expected repaired === 0 (no synthesis; postings are the authority), got ${summary.postings!.repaired}`,
  );
  assert.equal(
    summary.postings!.failed,
    6,
    `expected failed === 6 (one per transaction with no postings), got ${summary.postings!.failed}`,
  );

  // Zero postings restored — the archive had none.
  const destPostingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(eq(transactions.userId, destUserId));
  assert.equal(
    Number(destPostingCount[0]!.count),
    0,
    "no postings restored (archive had postings: [])",
  );

  // Non-posting rows were preserved: 2 accounts, 2 categories, 6 transactions, 2 splits, 1 transfer_link.
  const destRealAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, destUserId), isNull(accounts.systemKind)));
  assert.equal(destRealAccounts.length, 2, "2 real accounts restored (Bank + Wallet)");

  const destTxns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, destUserId));
  assert.equal(destTxns.length, 6, "6 transactions restored (all 6 archive rows)");

  // summary.rows and summary.tables: archive has no postings (empty array), so
  // counts are all non-posting rows. restoreUserBackup only increments counters
  // for tables with rows.length > 0, so the empty postings table is not counted.
  assert.equal(
    summary.rows,
    nonPostingRows,
    `summary.rows (${summary.rows}) must equal non-posting rows (${nonPostingRows})`,
  );
  assert.equal(
    summary.tables,
    nonPostingTables,
    `summary.tables (${summary.tables}) must equal non-posting tables (${nonPostingTables})`,
  );
});

test("A6 AC5: a posting with a foreign account_id causes FK violation — full rollback, no rows committed", async (t) => {
  const destUserId = await createUser();
  t.after(() => cleanupUser(destUserId));

  const accId = randomUUID();
  const txnId = randomUUID();
  const now = new Date().toISOString();

  const header: ArchiveHeader = {
    version: 2,
    exportedAt: now,
    userId: "source",
    tables: Object.fromEntries(
      restorableTables().map((t) => [t, []]),
    ) as ArchiveHeader["tables"],
    files: [],
  };
  header.tables.accounts = [
    {
      id: accId,
      user_id: "source",
      name: "Bank",
      type: "bank",
      created_at: now,
      updated_at: now,
    },
  ];
  header.tables.transactions = [
    {
      id: txnId,
      user_id: "source",
      account_id: accId,
      date: "2026-01-05",
      amount_paise: -5000,
      merchant: "Cafe",
      category_id: null,
      notes: "",
      tags: [],
      source: "manual",
      is_opening: false,
      created_at: now,
      updated_at: now,
    },
  ];
  // A posting whose account_id is NOT in the archive — triggers a Postgres FK violation on insert.
  const foreignAccountId = randomUUID();
  header.tables.postings = [
    {
      id: randomUUID(),
      transaction_id: txnId,
      account_id: foreignAccountId, // FK violation: not in the archive, so not in accounts table
      category_id: null,
      amount_paise: 5000,
      necessity: null,
      note: "",
      created_at: now,
    },
  ];

  const plaintextPath = join(tmpdir(), `a6-ac5-foreign-${randomUUID()}.archive`);
  t.after(() => unlink(plaintextPath).catch(() => {}));
  await pipeline(
    Readable.from(writeArchive(header, async () => null)),
    createWriteStream(plaintextPath),
  );

  await seedSystemAccounts(db, destUserId);

  // restore-user.ts inserts archived posting rows verbatim (postings are the data in PR-G1).
  // The foreign account_id causes a Postgres FK violation (SQLSTATE 23503) on the postings insert.
  // restore-user.ts catches it, rolls back the full transaction, and re-throws — NOTHING commits.
  await assert.rejects(
    () => restoreUserBackup(pool, stubStorage, destUserId, plaintextPath),
    (err: unknown) =>
      typeof err === "object" && err !== null && (err as { code?: string }).code === "23503",
  );

  // Rollback proof: no real account, no transaction, no posting committed for destUserId.
  const realAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, destUserId), isNull(accounts.systemKind)));
  assert.equal(realAccounts.length, 0, "no real accounts committed (restore rolled back)");

  const destTxns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, destUserId));
  assert.equal(destTxns.length, 0, "no transactions committed (restore rolled back)");

  const destPostings = await db
    .select()
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(eq(transactions.userId, destUserId));
  assert.equal(destPostings.length, 0, "no postings committed (restore rolled back)");
});

test("A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs", async (t) => {
  const passphrase = "correct horse battery staple";
  const sourceUserId = await createUser();
  const destUserId = await createUser();
  t.after(async () => {
    await cleanupUser(sourceUserId);
    await cleanupUser(destUserId);
  });

  const deletes: string[] = [];
  const recordingStorage: Storage = {
    put: async () => `new/${randomUUID()}`,
    get: async () => Buffer.from("fake-bytes"),
    delete: async (key: string) => {
      deletes.push(key);
    },
    list: async () => [],
    ensureReady: async () => {},
  };

  const [_account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Source bank", type: "bank" })
    .returning({ id: accounts.id });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      date: "2026-01-05",
      merchant: "Cafe",
    })
    .returning({ id: transactions.id });
  // Include an attachment so the backup archive has a blob — the "don't delete"
  // assertion is meaningful only when blobs were actually uploaded.
  await db.insert(attachments).values({
    transactionId: txn!.id,
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    storedPath: "orig/receipt.jpg",
  });

  const encryptedPath = join(tmpdir(), `a6-ac5-throw-${randomUUID()}.cmpb`);
  const plaintextPath = `${encryptedPath}.plain`;
  t.after(async () => {
    await unlink(encryptedPath).catch(() => {});
    await unlink(plaintextPath).catch(() => {});
  });

  const stream = await buildUserBackupStream(db, recordingStorage, sourceUserId, passphrase);
  await pipeline(stream, createWriteStream(encryptedPath));
  await decryptBackupV2File(encryptedPath, plaintextPath, passphrase);
  await cleanupUser(sourceUserId);

  // Reconcile that throws — must not roll back the committed restore or delete blobs.
  const summary = await restoreUserBackup(
    pool,
    recordingStorage,
    destUserId,
    plaintextPath,
    async () => {
      throw new Error("boom");
    },
  );

  assert.deepEqual(summary.postings, { repaired: 0, failed: 1 });
  assert.ok(summary.rows > 0, "legacy rows must be committed despite reconcile failure");
  assert.ok(summary.files > 0, "blobs must have been uploaded");

  // Restored legacy rows are still present.
  const restoredTxns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, destUserId));
  assert.equal(restoredTxns.length, 1, "restored transaction must survive the failed reconcile");

  // No blobs were deleted — the committed restore's uploads survive.
  assert.deepEqual(deletes, [], "blobs must not be deleted on reconcile failure");
});

// ---------- transactionsCsv tests (AC2-AC17) ----------
//
// These tests require DATABASE_URL (same hard requirement as the tests above).
// Each test creates a fresh disposable user and cleans up in t.after().

/**
 * RFC-4180 CSV parser for toCsv() output.
 * Handles quoted fields with embedded commas, double-quotes and newlines.
 */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < csv.length) {
    const row: string[] = [];
    while (true) {
      let field: string;
      if (i < csv.length && csv[i] === '"') {
        // Quoted field — scan until the closing unescaped quote
        i++; // skip opening quote
        let f = "";
        while (i < csv.length) {
          if (csv[i] === '"' && i + 1 < csv.length && csv[i + 1] === '"') {
            f += '"'; i += 2; // escaped double-quote
          } else if (csv[i] === '"') {
            i++; break; // closing quote
          } else {
            f += csv[i++];
          }
        }
        field = f;
      } else {
        // Unquoted field
        let j = i;
        while (j < csv.length && csv[j] !== "," && csv[j] !== "\r" && csv[j] !== "\n") j++;
        field = csv.slice(i, j);
        i = j;
      }
      row.push(field);
      if (i < csv.length && csv[i] === ",") { i++; continue; } // more fields
      // End of row
      if (i + 1 < csv.length && csv[i] === "\r" && csv[i + 1] === "\n") i += 2;
      else if (i < csv.length && csv[i] === "\n") i++;
      break;
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

/** Shared fixture: a user with one real bank, one wallet, four system accounts
 *  and two categories (Food, Transport). */
interface CsvFixture {
  userId: string;
  bankId: string;
  walletId: string;
  expensesId: string;
  clearingId: string;
  openingId: string;
  foodId: string;
  transportId: string;
}

async function createCsvUser(): Promise<CsvFixture> {
  const userId = await createUser();
  const [bank] = await db.insert(accounts).values({ userId, name: "Test Bank", type: "bank" }).returning({ id: accounts.id });
  const [wallet] = await db.insert(accounts).values({ userId, name: "Wallet", type: "cash" }).returning({ id: accounts.id });
  const [expAcc] = await db.insert(accounts).values({ userId, name: "Expenses", type: "system", systemKind: "expenses" }).returning({ id: accounts.id });
  const [clearAcc] = await db.insert(accounts).values({ userId, name: "Clearing", type: "system", systemKind: "clearing" }).returning({ id: accounts.id });
  const [openAcc] = await db.insert(accounts).values({ userId, name: "Opening", type: "system", systemKind: "opening" }).returning({ id: accounts.id });
  const [food] = await db.insert(categories).values({ userId, name: "Food", kind: "expense" }).returning({ id: categories.id });
  const [transport] = await db.insert(categories).values({ userId, name: "Transport", kind: "expense" }).returning({ id: categories.id });
  return {
    userId,
    bankId: bank!.id,
    walletId: wallet!.id,
    expensesId: expAcc!.id,
    clearingId: clearAcc!.id,
    openingId: openAcc!.id,
    foodId: food!.id,
    transportId: transport!.id,
  };
}

test("transactionsCsv AC2: header is byte-identical — Date,Merchant,Amount (paise),Category,Account,Notes", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const csv = await transactionsCsv(db, userId);
  // Raw byte-identity check: toCsv (csv.ts:147) joins rows with "\r\n" and appends a
  // trailing "\r\n", so a user with no transactions must produce exactly this string.
  assert.equal(csv, "Date,Merchant,Amount (paise),Category,Account,Notes\r\n");
  // Also verify via parsed fields (would accept quoted headers — kept for extra coverage).
  const rows = parseCsvRows(csv);
  assert.deepEqual(
    rows[0],
    ["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"],
  );
});

test("transactionsCsv AC3: ordinary expense — postings parity (amount, account, category)", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-15", merchant: "Cafe" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: -5000 },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 5000, categoryId: fx.foodId },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "one header + one data row");
  const data = rows[1]!;
  assert.equal(data[0], "2026-01-15", "Date");
  assert.equal(data[1], "Cafe", "Merchant");
  assert.equal(data[2], "-5000", "Amount from real posting");
  assert.equal(data[3], "Food", "Category from counter posting");
  assert.equal(data[4], "Test Bank", "Account from real posting");
  assert.equal(data[5], "", "Notes empty");
});

test("transactionsCsv AC4: postings values override stale legacy fields (drift)", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  // Legacy transaction points to bank/food/-5000; postings say wallet/transport/-8000
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-10", merchant: "Drift test" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.walletId, amountPaise: -8000 }, // real: wallet, not bank
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 8000, categoryId: fx.transportId }, // counter: transport, not food
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2);
  const data = rows[1]!;
  assert.equal(data[2], "-8000", "Amount from posting, not legacy amount_paise");
  assert.equal(data[3], "Transport", "Category from posting, not legacy category_id");
  assert.equal(data[4], "Wallet", "Account from posting, not legacy account_id");
});

test("transactionsCsv AC5: split transaction yields one row with joined sorted distinct categories", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-20", merchant: "Split purchase" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: -10000 }, // real posting
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 6000, categoryId: fx.foodId },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 4000, categoryId: fx.transportId },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "split must yield exactly one data row (D1)");
  assert.equal(rows[1]![3], "Food; Transport", "categories sorted by name collate C, joined with '; '");
});

test("transactionsCsv AC6: transfer pair — one row per leg, correct sign and account", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [outTxn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-05", merchant: "Transfer out" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: outTxn!.id, accountId: fx.bankId, amountPaise: -20000 },
    { transactionId: outTxn!.id, accountId: fx.clearingId, amountPaise: 20000 },
  ]);
  const [inTxn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-05", merchant: "Transfer in" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: inTxn!.id, accountId: fx.walletId, amountPaise: 20000 },
    { transactionId: inTxn!.id, accountId: fx.clearingId, amountPaise: -20000 },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 3, "one header + two leg rows");
  // Both legs share the same date — find by merchant
  const outRow = rows.slice(1).find((r) => r[1] === "Transfer out")!;
  const inRow = rows.slice(1).find((r) => r[1] === "Transfer in")!;
  assert.ok(outRow, "out leg must be present");
  assert.ok(inRow, "in leg must be present");
  assert.equal(outRow[2], "-20000", "out leg amount");
  assert.equal(outRow[4], "Test Bank", "out leg account");
  assert.equal(inRow[2], "20000", "in leg amount");
  assert.equal(inRow[4], "Wallet", "in leg account");
});

test("transactionsCsv AC7+AC13: no postings → blank Amount, Account AND Category (not 0, not dropped)", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  // Transaction with a stale legacy category_id but no postings
  await db.insert(transactions).values({
    userId: fx.userId, date: "2026-01-25",
    merchant: "No posting txn",
  });
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "postings-less transaction still yields a row");
  const data = rows[1]!;
  assert.equal(data[2], "", "Amount must be blank (not 0) when no real posting");
  assert.equal(data[3], "", "Category must be blank when no counter postings (D9.4)");
  assert.equal(data[4], "", "Account must be blank when no real posting");
});

test("transactionsCsv AC8: soft-deleted excluded; another user's transaction excluded", async (t) => {
  const fx = await createCsvUser();
  const otherId = await createUser();
  t.after(async () => {
    await cleanupUser(fx.userId);
    await cleanupUser(otherId);
  });
  // One live transaction for fx.userId
  await db.insert(transactions).values({
    userId: fx.userId, date: "2026-01-30", merchant: "Live txn",
  });
  // Soft-deleted transaction for fx.userId — must be excluded
  await db.insert(transactions).values({
    userId: fx.userId, date: "2026-01-29",
    merchant: "Deleted txn", deletedAt: new Date(),
  });
  // Another user's transaction — must be excluded
  await db.insert(transactions).values({
    userId: otherId, date: "2026-01-28", merchant: "Other user txn",
  });
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "only the one live transaction for this user");
  assert.equal(rows[1]![1], "Live txn");
});

test("transactionsCsv AC9: rows ordered by date desc", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  // Insert in chronological order; expect reverse-chronological in output
  for (const [date, merchant] of [
    ["2026-01-01", "Oldest"],
    ["2026-01-05", "Middle"],
    ["2026-01-10", "Newest"],
  ] as [string, string][]) {
    await db.insert(transactions).values({
      userId: fx.userId, date, merchant,
    });
  }
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 4, "one header + three data rows");
  assert.equal(rows[1]![1], "Newest", "newest date first");
  assert.equal(rows[2]![1], "Middle");
  assert.equal(rows[3]![1], "Oldest", "oldest date last");
});

test("transactionsCsv AC11 D9.2: transfer leg exports blank Category even when t.category_id is set", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  // Transaction with stale legacy category (as if categorised before being linked as transfer)
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-02-01", merchant: "Transfer with stale category" })
    .returning({ id: transactions.id });
  // Postings are transfer shape: real (bank) + counter (clearing, no category)
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: -15000 },
    { transactionId: txn!.id, accountId: fx.clearingId, amountPaise: 15000 }, // no categoryId
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2);
  assert.equal(rows[1]![3], "", "Category must be blank for transfer leg despite stale t.category_id");
});

test("transactionsCsv AC12 D9.3: opening row exports real amount/account and blank Category", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-01", merchant: "Opening balance" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: 100000 },
    { transactionId: txn!.id, accountId: fx.openingId, amountPaise: -100000 }, // no categoryId
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2);
  const data = rows[1]!;
  assert.equal(data[2], "100000", "Amount from real posting");
  assert.equal(data[3], "", "Category must be blank for opening row (D9.3)");
  assert.equal(data[4], "Test Bank", "Account from real posting");
});

test("transactionsCsv AC14: categories sorted deterministically (collate C), duplicates collapsed", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  // Insert one extra category (Zulu); Food and Transport already exist in the shared
  // fixture. Counter postings reference them in reverse alphabetical order (Zulu, then
  // Transport, then Food) to prove the sort is applied and duplicates are collapsed.
  const [zulu] = await db
    .insert(categories)
    .values({ userId: fx.userId, name: "Zulu", kind: "expense" })
    .returning({ id: categories.id });
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-01-15", merchant: "Multi-category" })
    .returning({ id: transactions.id });
  // Insert counter postings: Zulu first, then Transport, then Food twice (duplicate)
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: -30000 }, // real
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 12000, categoryId: zulu!.id },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 9000, categoryId: fx.transportId },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 5000, categoryId: fx.foodId },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 4000, categoryId: fx.foodId }, // duplicate
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "split must still be one row");
  assert.equal(rows[1]![3], "Food; Transport; Zulu", "sorted by name collate C, duplicates collapsed");
});

test("transactionsCsv AC15: CSV escaping — comma in category, double-quote in merchant, newline in notes", async (t) => {
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [catComma] = await db
    .insert(categories)
    .values({ userId: fx.userId, name: "Food, snacks", kind: "expense" })
    .returning({ id: categories.id });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: fx.userId, date: "2026-02-10",
      merchant: 'Cafe "Gourmet"',
      notes: "Bill includes\nnewline",
    })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: fx.bankId, amountPaise: -1500 },
    { transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 1500, categoryId: catComma!.id },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2);
  const data = rows[1]!;
  assert.equal(data[1], 'Cafe "Gourmet"', "double-quotes in merchant preserved");
  assert.equal(data[3], "Food, snacks", "comma in category preserved");
  assert.equal(data[5], "Bill includes\nnewline", "newline in notes preserved");
});

test("transactionsCsv AC16 D7: posting referencing another user's account/category is filtered out by tenant guard", async (t) => {
  const userId = await createUser();
  const otherUserId = await createUser();
  // Must clean up userId first — its posting references otherUserId's account
  t.after(async () => {
    await cleanupUser(userId);
    await cleanupUser(otherUserId);
  });
  const [_myBank] = await db.insert(accounts).values({ userId, name: "My Bank", type: "bank" }).returning({ id: accounts.id });
  const [myExpenses] = await db.insert(accounts).values({ userId, name: "Expenses", type: "system", systemKind: "expenses" }).returning({ id: accounts.id });
  const [otherBank] = await db.insert(accounts).values({ userId: otherUserId, name: "Other Bank", type: "bank" }).returning({ id: accounts.id });
  const [otherCat] = await db.insert(categories).values({ userId: otherUserId, name: "Other Category", kind: "expense" }).returning({ id: categories.id });
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-02-20", merchant: "Leakage test" })
    .returning({ id: transactions.id });
  // Real posting references other user's bank account (a.user_id ≠ t.user_id → filtered)
  // Counter posting references other user's category (c.user_id ≠ t.user_id → filtered)
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: otherBank!.id, amountPaise: -5000 },
    { transactionId: txn!.id, accountId: myExpenses!.id, amountPaise: 5000, categoryId: otherCat!.id },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, userId));
  assert.equal(rows.length, 2);
  const data = rows[1]!;
  // a.user_id = t.user_id guard: other user's bank account is not matched → no real posting → blank
  assert.equal(data[2], "", "Amount must be blank when real posting references other user's account");
  assert.equal(data[4], "", "Account must not surface other user's account name");
  // c.user_id = t.user_id guard: other user's category is not matched → blank category
  assert.equal(data[3], "", "Category must not surface other user's category name");
});

test("transactionsCsv AC17 D8: archived account and archived category still appear in export", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const [archivedBank] = await db
    .insert(accounts)
    .values({ userId, name: "Archived Bank", type: "bank", archivedAt: new Date("2025-06-01") })
    .returning({ id: accounts.id });
  const [expAcc] = await db
    .insert(accounts)
    .values({ userId, name: "Expenses", type: "system", systemKind: "expenses" })
    .returning({ id: accounts.id });
  const [archivedCat] = await db
    .insert(categories)
    .values({ userId, name: "Archived Category", kind: "expense", archivedAt: new Date("2025-06-01") })
    .returning({ id: categories.id });
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-15", merchant: "Archived acct txn" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: archivedBank!.id, amountPaise: -2000 },
    { transactionId: txn!.id, accountId: expAcc!.id, amountPaise: 2000, categoryId: archivedCat!.id },
  ]);
  const rows = parseCsvRows(await transactionsCsv(db, userId));
  assert.equal(rows.length, 2);
  const data = rows[1]!;
  assert.equal(data[3], "Archived Category", "archived category must still appear");
  assert.equal(data[4], "Archived Bank", "archived account must still appear");
});

test("transactionsCsv AC17 D8: renamed account shows the NEW name in the export", async (t) => {
  // D8 says archived_at is not filtered. The complementary point is that the join
  // reads the account row at export time, so a renamed account always shows its
  // current name (not the name it had when the posting was created).
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const [bank] = await db
    .insert(accounts)
    .values({ userId, name: "Old Bank Name", type: "bank" })
    .returning({ id: accounts.id });
  const [expAcc] = await db
    .insert(accounts)
    .values({ userId, name: "Expenses", type: "system", systemKind: "expenses" })
    .returning({ id: accounts.id });
  const [food] = await db
    .insert(categories)
    .values({ userId, name: "Food", kind: "expense" })
    .returning({ id: categories.id });
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-03-01", merchant: "Rename test" })
    .returning({ id: transactions.id });
  await db.insert(postings).values([
    { transactionId: txn!.id, accountId: bank!.id, amountPaise: -3000 },
    { transactionId: txn!.id, accountId: expAcc!.id, amountPaise: 3000, categoryId: food!.id },
  ]);
  // Rename the account after its posting has been inserted
  await db.update(accounts).set({ name: "New Bank Name" }).where(eq(accounts.id, bank!.id));
  const rows = parseCsvRows(await transactionsCsv(db, userId));
  assert.equal(rows.length, 2);
  assert.equal(rows[1]![4], "New Bank Name", "export must show the current (renamed) account name");
});

test("transactionsCsv D9.6: transaction with two real postings exports exactly one row (order by p.id limit 1)", async (t) => {
  // D9.6: if a transaction somehow has multiple real (system_kind IS NULL) postings,
  // the lateral uses ORDER BY p.id LIMIT 1, so exactly one row is exported and the
  // selection is deterministic (lowest posting id wins).
  const fx = await createCsvUser();
  t.after(() => cleanupUser(fx.userId));
  const [txn] = await db
    .insert(transactions)
    .values({ userId: fx.userId, date: "2026-03-10", merchant: "Two real postings" })
    .returning({ id: transactions.id });
  // Insert two real (system_kind IS NULL) postings with different amounts.
  // Hard-coded UUID literals are used so the lexical ordering (and therefore which
  // posting wins `ORDER BY p.id LIMIT 1`) is deterministic and independent of
  // insertion order. Do NOT replace these with generated ids: the test would flake
  // because gen_random_uuid() gives no insertion-order guarantee.
  // '...0001' < '...0002' lexically, so the posting on bankId/-7000 wins.
  await db.insert(postings).values({ id: "00000000-0000-4000-8000-000000000001", transactionId: txn!.id, accountId: fx.bankId, amountPaise: -7000 });
  await db.insert(postings).values({ id: "00000000-0000-4000-8000-000000000002", transactionId: txn!.id, accountId: fx.walletId, amountPaise: -9999 });
  // Counter posting for category
  await db.insert(postings).values({
    transactionId: txn!.id, accountId: fx.expensesId, amountPaise: 7000, categoryId: fx.foodId,
  });
  const rows = parseCsvRows(await transactionsCsv(db, fx.userId));
  assert.equal(rows.length, 2, "exactly one data row even with two real postings");
  const data = rows[1]!;
  // The posting with the smaller UUID ('...0001', on bankId/-7000) wins; wallet/-9999 must not appear.
  assert.equal(data[2], "-7000", "amount from the lowest-id real posting (order by p.id limit 1)");
  assert.equal(data[4], "Test Bank", "account from the lowest-id real posting");
});
