import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq, getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "../db/schema.ts";
import { accounts, transactions, userTasks, users } from "../db/schema.ts";
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
import { DEFERRED_RESTORE_COLUMNS, firstPassRow, restoreDump } from "../db/restore.ts";
import { restorableTables, restoreUserBackup } from "./restore-user.ts";
import { decryptBackupV2File } from "../lib/crypto-backup.ts";
import { writeArchive, type ArchiveHeader } from "../lib/backup-archive.ts";
import type { Storage } from "../lib/storage.ts";
import { createDb } from "../db/index.ts";
import { createPool } from "../infra/db.ts";

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
