import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, getTableColumns, getTableName, is, isNotNull, sql, Table } from "drizzle-orm";
import * as schema from "../../../db/schema.ts";
import { accounts, attachments, categories, postings, transactions, transactionSplits, transferLinks, userTasks, users } from "../../../db/schema.ts";
import {
  ALL_TABLES,
  buildUserBackupStream,
  collectFileRefs,
  exportGaps,
  FILE_COLUMNS,
  LINKED_TABLES,
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
import { findInconsistentPostings, reconcileUserPostings } from "../../ledger/services/reconcile-postings.ts";

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
      if (column.name === "stored_path" || column.name === "document_path") {
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
  dump.accounts = [{ id: "acc1", goal_id: "goal1" }];
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

  const [account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: account!.id,
      date: "2026-01-05",
      amountPaise: -50000,
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

  const [account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Source bank", type: "bank" })
    .returning({ id: accounts.id });
  await db.insert(transactions).values({
    userId: sourceUserId,
    accountId: account!.id,
    date: "2026-01-05",
    amountPaise: -5000,
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

  // 1. Ordinary transaction
  const [_ordinary] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: bank!.id,
      date: "2026-01-01",
      amountPaise: -5000,
      merchant: "Cafe",
      categoryId: food!.id,
      necessity: "non_essential",
    })
    .returning({ id: transactions.id });

  // 2. Split transaction
  const [splitTxn] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: bank!.id,
      date: "2026-01-02",
      amountPaise: -10000,
      merchant: "Groceries",
    })
    .returning({ id: transactions.id });
  await db.insert(transactionSplits).values([
    { transactionId: splitTxn!.id, categoryId: food!.id, amountPaise: -6000, note: "groceries" },
    { transactionId: splitTxn!.id, categoryId: transport!.id, amountPaise: -4000, note: "bus" },
  ]);

  // 3. Transfer-linked pair
  const [outLeg] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: bank!.id,
      date: "2026-01-03",
      amountPaise: -20000,
      merchant: "Transfer out",
    })
    .returning({ id: transactions.id });
  const [inLeg] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: wallet!.id,
      date: "2026-01-03",
      amountPaise: 20000,
      merchant: "Transfer in",
    })
    .returning({ id: transactions.id });
  await db.insert(transferLinks).values({
    userId: sourceUserId,
    outTransactionId: outLeg!.id,
    inTransactionId: inLeg!.id,
    auto: false,
  });

  // 4. Opening balance
  const [_opening] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: bank!.id,
      date: "2026-01-01",
      amountPaise: 100000,
      merchant: "Opening balance",
      isOpening: true,
    })
    .returning({ id: transactions.id });

  // 5. Soft-deleted transaction
  const [deleted] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: bank!.id,
      date: "2026-01-04",
      amountPaise: -7000,
      merchant: "Old expense",
      categoryId: food!.id,
      deletedAt: new Date(),
    })
    .returning({ id: transactions.id });

  // Dual-write postings for the source user (like the app's writers).
  const sourceReconcile = await reconcileUserPostings(db, sourceUserId);
  assert.equal(sourceReconcile.failures.length, 0, "source reconcile must succeed");

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

  // Post-commit reconcile ran and repaired (inserted) postings for every transaction.
  assert.ok(summary.postings, "summary must have postings field");
  assert.ok(
    summary.postings!.repaired > 0,
    `expected repaired > 0, got ${summary.postings!.repaired}`,
  );
  assert.equal(summary.postings!.failed, 0, "no reconcile failures");

  // No archived posting id was re-inserted verbatim.
  const destPostingIds = new Set(
    (
      await db
        .select({ id: postings.id })
        .from(postings)
        .innerJoin(transactions, eq(postings.transactionId, transactions.id))
        .where(eq(transactions.userId, destUserId))
    ).map((r) => r.id),
  );
  for (const srcId of sourcePostingIds) {
    assert.ok(!destPostingIds.has(srcId), "archived posting id must not be re-inserted verbatim");
  }

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
  const sysClearing = sysRows.find((r) => r.systemKind === "clearing")!.id;
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
  await assertLegs(_ordinary!.id, [
    { accountId: bank!.id, amountPaise: -5000 },
    { accountId: sysExpenses, amountPaise: 5000 },
  ]);

  // Split: -10000 bank; food -6000, transport -4000 → {bank, -10000} + {sys expenses, +6000} + {sys expenses, +4000}
  await assertLegs(splitTxn!.id, [
    { accountId: bank!.id, amountPaise: -10000 },
    { accountId: sysExpenses, amountPaise: 6000 },
    { accountId: sysExpenses, amountPaise: 4000 },
  ]);

  // Transfer OUT: -20000 bank → {bank, -20000} + {sys clearing, +20000}
  await assertLegs(outLeg!.id, [
    { accountId: bank!.id, amountPaise: -20000 },
    { accountId: sysClearing, amountPaise: 20000 },
  ]);

  // Transfer IN: +20000 wallet → {wallet, +20000} + {sys clearing, -20000}
  await assertLegs(inLeg!.id, [
    { accountId: wallet!.id, amountPaise: 20000 },
    { accountId: sysClearing, amountPaise: -20000 },
  ]);

  // Opening balance: +100000 bank, isOpening → {bank, +100000} + {sys opening, -100000}
  await assertLegs(_opening!.id, [
    { accountId: bank!.id, amountPaise: 100000 },
    { accountId: sysOpening, amountPaise: -100000 },
  ]);

  // Soft-deleted: -7000 bank, food → {bank, -7000} + {sys expenses, +7000}
  await assertLegs(deleted!.id, [
    { accountId: bank!.id, amountPaise: -7000 },
    { accountId: sysExpenses, amountPaise: 7000 },
  ]);

  // The soft-deleted transaction also has synthesized postings.
  const deletedPostingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.id, deleted!.id),
        eq(transactions.userId, destUserId),
      ),
    );
  assert.ok(
    Number(deletedPostingCount[0]!.count) > 0,
    "soft-deleted transaction must have synthesized postings",
  );
});

test("A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts", async (t) => {
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
    // 3. Transfer OUT
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
  header.tables.transaction_splits = [
    { id: randomUUID(), transaction_id: splitId, category_id: foodId, amount_paise: -6000, note: "groceries", created_at: now },
    { id: randomUUID(), transaction_id: splitId, category_id: transportId, amount_paise: -4000, note: "bus", created_at: now },
  ];
  header.tables.transfer_links = [
    { id: randomUUID(), user_id: "source", out_transaction_id: outLegId, in_transaction_id: inLegId, auto: false, created_at: now },
  ];
  // Archive has NO postings (old-style) — deliberately empty array.
  header.tables.postings = [];

  // Count non-posting rows for B5 assertion.
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

  // B1: postings synthesized with no failures.
  assert.ok(summary.postings, "summary must have postings field");
  assert.ok(summary.postings!.repaired > 0, `expected repaired > 0, got ${summary.postings!.repaired}`);
  assert.equal(summary.postings!.failed, 0, "no reconcile failures");

  // Every txn zero-sum.
  const destTxns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, destUserId));
  for (const txn of destTxns) {
    const legs = await db
      .select({ amountPaise: postings.amountPaise })
      .from(postings)
      .where(eq(postings.transactionId, txn.id));
    const sum = legs.reduce((a, b) => a + Number(b.amountPaise), 0);
    assert.equal(sum, 0, `postings for transaction ${txn.id} must be zero-sum`);
  }

  // findInconsistentPostings returns [].
  const inconsistent = await findInconsistentPostings(db, destUserId);
  assert.deepEqual(inconsistent, [], "all dest postings must be consistent with derived shape");

  // --- B2: per-shape leg multiset assertions (LITERAL hardcoded values) ---
  const sysRows = await db
    .select({ id: accounts.id, systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, destUserId), isNotNull(accounts.systemKind)));
  const sysExpenses = sysRows.find((r) => r.systemKind === "expenses")!.id;
  const sysClearing = sysRows.find((r) => r.systemKind === "clearing")!.id;
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
  await assertLegs(ordinaryId, [
    { accountId: bankId, amountPaise: -5000 },
    { accountId: sysExpenses, amountPaise: 5000 },
  ]);

  // Split: -10000 bank; food -6000, transport -4000 → {bank, -10000} + {sys expenses, +6000} + {sys expenses, +4000}
  await assertLegs(splitId, [
    { accountId: bankId, amountPaise: -10000 },
    { accountId: sysExpenses, amountPaise: 6000 },
    { accountId: sysExpenses, amountPaise: 4000 },
  ]);

  // Transfer OUT: -20000 bank → {bank, -20000} + {sys clearing, +20000}
  await assertLegs(outLegId, [
    { accountId: bankId, amountPaise: -20000 },
    { accountId: sysClearing, amountPaise: 20000 },
  ]);

  // Transfer IN: +20000 wallet → {wallet, +20000} + {sys clearing, -20000}
  await assertLegs(inLegId, [
    { accountId: walletId, amountPaise: 20000 },
    { accountId: sysClearing, amountPaise: -20000 },
  ]);

  // Opening: +100000 bank, isOpening → {bank, +100000} + {sys opening, -100000}
  await assertLegs(openingId, [
    { accountId: bankId, amountPaise: 100000 },
    { accountId: sysOpening, amountPaise: -100000 },
  ]);

  // Soft-deleted: -7000 bank, food → {bank, -7000} + {sys expenses, +7000}
  await assertLegs(deletedId, [
    { accountId: bankId, amountPaise: -7000 },
    { accountId: sysExpenses, amountPaise: 7000 },
  ]);

  // --- B5: summary counts exclude discarded archived posting rows ---
  assert.equal(
    summary.rows,
    nonPostingRows,
    `summary.rows (${summary.rows}) must equal non-posting rows (${nonPostingRows}) — archived postings excluded`,
  );
  assert.equal(
    summary.tables,
    nonPostingTables,
    `summary.tables (${summary.tables}) must equal non-posting tables (${nonPostingTables}) — postings table excluded`,
  );
});

test("A6 AC5: a posting with a foreign account_id is skipped (never inserted)", async (t) => {
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
  // A posting whose account_id is NOT in the archive — must never be inserted.
  const foreignAccountId = randomUUID();
  const foreignCategoryId = randomUUID();
  header.tables.postings = [
    {
      id: randomUUID(),
      transaction_id: txnId,
      account_id: foreignAccountId, // foreign account id — not in the archive
      category_id: foreignCategoryId, // foreign category id — not in the archive
      amount_paise: 5000,
      necessity: null,
      note: "",
      created_at: now,
    },
  ];

  // B5: compute expected non-posting row/table counts from the header
  // (P=1 archived posting row; accounts=1 + transactions=1 = 2 non-posting rows).
  const nonPostingRows = Object.entries(header.tables)
    .filter(([table]) => table !== "postings")
    .reduce((sum, [, rows]) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  const nonPostingTables = Object.entries(header.tables)
    .filter(([table, rows]) => table !== "postings" && Array.isArray(rows) && rows.length > 0)
    .length;

  const plaintextPath = join(tmpdir(), `a6-ac5-foreign-${randomUUID()}.archive`);
  t.after(() => unlink(plaintextPath).catch(() => {}));
  await pipeline(
    Readable.from(writeArchive(header, async () => null)),
    createWriteStream(plaintextPath),
  );

  await seedSystemAccounts(db, destUserId);
  const summary = await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);

  // The archived posting (foreign account) was skipped; reconcile derived
  // postings from txn1's real account (acc1).
  const destPostings = await db
    .select()
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(eq(transactions.userId, destUserId));
  // Ordinary transaction produces exactly 2 postings (asset + Expenses counter).
  assert.equal(destPostings.length, 2, "dest must have exactly 2 derived postings");
  // Zero-sum.
  const sum = destPostings.reduce((a, p) => a + Number(p.postings.amountPaise), 0);
  assert.equal(sum, 0, "derived postings must be zero-sum");
  // No posting references the foreign (never-inserted) account or category from the archive.
  for (const p of destPostings) {
    assert.notEqual(p.postings.accountId, foreignAccountId, "foreign account must not be referenced");
    assert.notEqual(p.postings.categoryId, foreignCategoryId, "foreign category must not be referenced");
  }
  // Exactly one posting references the restored real account (the asset leg);
  // the other is the system Expenses counter leg.
  const assetLegs = destPostings.filter((p) => p.postings.accountId === accId);
  assert.equal(assetLegs.length, 1, "asset leg must reference the restored account");

  // B5 (non-vacuous, P=1>0): the 1 archived posting row must be excluded from summary counts.
  assert.equal(
    summary.rows,
    nonPostingRows,
    `summary.rows (${summary.rows}) must equal non-posting rows (${nonPostingRows}) — archived posting row must be excluded from summary.rows`,
  );
  assert.equal(
    summary.tables,
    nonPostingTables,
    `summary.tables (${summary.tables}) must equal non-posting tables (${nonPostingTables}) — postings table must not be counted in summary.tables`,
  );
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

  const [account] = await db
    .insert(accounts)
    .values({ userId: sourceUserId, name: "Source bank", type: "bank" })
    .returning({ id: accounts.id });
  const [txn] = await db
    .insert(transactions)
    .values({
      userId: sourceUserId,
      accountId: account!.id,
      date: "2026-01-05",
      amountPaise: -5000,
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
