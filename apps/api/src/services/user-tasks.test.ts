import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateUserTask } from "@compass/shared";
import { createDb } from "../db/index.ts";
import { createPool } from "../infra/db.ts";
import { accounts, transactions, userTasks, users } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { softDeleteTransaction } from "./transactions.ts";
import {
  createUserTask,
  deleteUserTask,
  getUserTask,
  listUserTasks,
  updateUserTask,
} from "./user-tasks.ts";

// These need a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure (see emis.test.ts's identical DB-backed section).
// Each test creates its own throwaway user(s) and cleans them up via
// t.after(), so it's safe to run against a shared dev DB.

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "user-tasks.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `user-tasks-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "user-tasks.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createAccount(userId: string): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: "Test account", type: "bank" })
    .returning({ id: accounts.id });
  return a!.id;
}

async function createTxn(
  userId: string,
  accountId: string,
  overrides: Partial<{ date: string; amountPaise: number; merchant: string }> = {},
): Promise<string> {
  const [t] = await db
    .insert(transactions)
    .values({
      userId,
      accountId,
      date: overrides.date ?? "2026-01-05",
      amountPaise: overrides.amountPaise ?? -1000,
      merchant: overrides.merchant ?? "Test merchant",
    })
    .returning({ id: transactions.id });
  return t!.id;
}

/** Deletes everything a test user (and its accounts/transactions) created. */
async function cleanupUser(userId: string): Promise<void> {
  await db.delete(userTasks).where(eq(userTasks.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

const isHttp404 = (e: unknown): boolean => e instanceof HttpError && e.statusCode === 404;

// ---------- AC1: six independent cross-user cases ----------

test("AC1(1): list for user A never includes a task belonging to user B", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  await createUserTask(db, userA, { title: "A's task", notes: "", transactionId: null, dueDate: null });
  await createUserTask(db, userB, { title: "B's task", notes: "", transactionId: null, dueDate: null });

  const listA = await listUserTasks(db, userA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0]!.title, "A's task");
  assert.ok(listA.every((t2) => t2.title !== "B's task"));
});

test("AC1(2): getting another user's task by id is rejected 404 (not empty-vs-error leakage)", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const task = await createUserTask(db, userA, { title: "A's task", notes: "", transactionId: null, dueDate: null });
  await assert.rejects(getUserTask(db, userB, task.id), isHttp404);
});

test("AC1(3): editing another user's title/notes/dueDate is rejected 404", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const task = await createUserTask(db, userA, { title: "A's task", notes: "original", transactionId: null, dueDate: null });
  await assert.rejects(
    updateUserTask(db, userB, task.id, { title: "hijacked", notes: "hijacked", dueDate: "2026-05-05" }),
    isHttp404,
  );
  const stillA = await getUserTask(db, userA, task.id);
  assert.equal(stillA.title, "A's task");
  assert.equal(stillA.notes, "original");
});

test("AC1(4): completing or un-completing another user's task is rejected 404", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const task = await createUserTask(db, userA, { title: "A's task", notes: "", transactionId: null, dueDate: null });
  await assert.rejects(updateUserTask(db, userB, task.id, { completed: true }), isHttp404);
  const stillIncomplete = await getUserTask(db, userA, task.id);
  assert.equal(stillIncomplete.completedAt, null);
});

test("AC1(5): relinking or clearing another user's task's transaction link is rejected 404", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountA = await createAccount(userA);
  const txnA = await createTxn(userA, accountA);
  const task = await createUserTask(db, userA, { title: "A's task", notes: "", transactionId: txnA, dueDate: null });
  await assert.rejects(updateUserTask(db, userB, task.id, { transactionId: null }), isHttp404);
  const stillLinked = await getUserTask(db, userA, task.id);
  assert.equal(stillLinked.transactionId, txnA);
});

test("AC1(6): deleting another user's task is rejected 404, and the row still exists", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const task = await createUserTask(db, userA, { title: "A's task", notes: "", transactionId: null, dueDate: null });
  await assert.rejects(deleteUserTask(db, userB, task.id), isHttp404);
  const stillThere = await getUserTask(db, userA, task.id);
  assert.equal(stillThere.id, task.id);
});

// ---------- AC3-AC6: transaction-linking validation ----------

test("AC3: create cannot link another user's transaction — 404, and no task row is inserted", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountB = await createAccount(userB);
  const txnB = await createTxn(userB, accountB);

  await assert.rejects(
    createUserTask(db, userA, { title: "Should not exist", notes: "", transactionId: txnB, dueDate: null }),
    isHttp404,
  );
  const rows = await db.select().from(userTasks).where(eq(userTasks.userId, userA));
  assert.equal(rows.length, 0);
});

test("AC4: update cannot relink to another user's transaction — 404, prior state (including existing link) unchanged", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountA = await createAccount(userA);
  const txnA = await createTxn(userA, accountA);
  const accountB = await createAccount(userB);
  const txnB = await createTxn(userB, accountB);

  const task = await createUserTask(db, userA, { title: "Existing", notes: "", transactionId: txnA, dueDate: null });

  await assert.rejects(updateUserTask(db, userA, task.id, { transactionId: txnB }), isHttp404);

  const after = await getUserTask(db, userA, task.id);
  assert.equal(after.transactionId, txnA);
  assert.equal(after.updatedAt, task.updatedAt);
});

test("AC5: linking a soft-deleted transaction is rejected 404 on both create and update, with no state change in either case", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const txnId = await createTxn(userId, accountId);
  await softDeleteTransaction(db, userId, txnId);

  await assert.rejects(
    createUserTask(db, userId, { title: "Should not exist", notes: "", transactionId: txnId, dueDate: null }),
    isHttp404,
  );
  const afterCreateAttempt = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(afterCreateAttempt.length, 0);

  const task = await createUserTask(db, userId, { title: "Unlinked task", notes: "", transactionId: null, dueDate: null });
  await assert.rejects(updateUserTask(db, userId, task.id, { transactionId: txnId }), isHttp404);
  const afterUpdateAttempt = await getUserTask(db, userId, task.id);
  assert.equal(afterUpdateAttempt.transactionId, null);
  assert.equal(afterUpdateAttempt.updatedAt, task.updatedAt);
});

test("AC6: create accepts null or a valid transactionId with a matching transaction projection; an existing link can be explicitly cleared via update", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const txnId = await createTxn(userId, accountId, { date: "2026-02-01", amountPaise: -12345, merchant: "Bookstore" });

  const unlinked = await createUserTask(db, userId, { title: "Unlinked", notes: "", transactionId: null, dueDate: null });
  assert.equal(unlinked.transactionId, null);
  assert.equal(unlinked.transaction, null);

  const linked = await createUserTask(db, userId, { title: "Linked", notes: "", transactionId: txnId, dueDate: null });
  assert.equal(linked.transactionId, txnId);
  assert.deepEqual(linked.transaction, {
    id: txnId,
    accountId,
    date: "2026-02-01",
    merchant: "Bookstore",
    amountPaise: -12345,
  });

  const cleared = await updateUserTask(db, userId, linked.id, { transactionId: null });
  assert.equal(cleared.transactionId, null);
  assert.equal(cleared.transaction, null);
});

// ---------- AC7/AC8: soft-delete vs. hard-delete (FK) behaviour ----------

test("AC7: soft-deleting the linked transaction via the transaction service retains transactionId but nulls the transaction projection, in both list and get", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountId = await createAccount(userA);
  const txnId = await createTxn(userA, accountId);
  const task = await createUserTask(db, userA, { title: "Reconcile", notes: "", transactionId: txnId, dueDate: null });

  await softDeleteTransaction(db, userA, txnId);

  const got = await getUserTask(db, userA, task.id);
  assert.equal(got.transactionId, txnId);
  assert.equal(got.transaction, null);

  const list = await listUserTasks(db, userA);
  const listed = list.find((t2) => t2.id === task.id);
  assert.ok(listed);
  assert.equal(listed!.transactionId, txnId);
  assert.equal(listed!.transaction, null);

  // A second user cannot obtain any transaction metadata for a task they don't own.
  await assert.rejects(getUserTask(db, userB, task.id), isHttp404);
});

test("AC8 (FK-level test, not normal product behaviour): a direct db.delete(transactions) sets the task's transactionId to null via ON DELETE SET NULL", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const txnId = await createTxn(userId, accountId);
  const task = await createUserTask(db, userId, { title: "Hard delete test", notes: "", transactionId: txnId, dueDate: null });

  await db.delete(transactions).where(eq(transactions.id, txnId));

  const rawRow = await db.query.userTasks.findFirst({ where: eq(userTasks.id, task.id) });
  assert.equal(rawRow?.transactionId, null);

  const dto = await getUserTask(db, userId, task.id);
  assert.equal(dto.transactionId, null);
  assert.equal(dto.transaction, null);
});

// ---------- AC9: completedAt/updatedAt mutation rules ----------

test("AC9: completing/un-completing sets/clears completedAt server-side; real edits bump updatedAt (deliberately old fixture, not two live timestamps); an empty PATCH does not bump updatedAt", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const txnId = await createTxn(userId, accountId);
  const task = await createUserTask(db, userId, { title: "Task", notes: "", transactionId: null, dueDate: null });
  const oldFixture = new Date("2020-01-01T00:00:00.000Z");

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const completed = await updateUserTask(db, userId, task.id, { completed: true });
  assert.ok(completed.completedAt !== null);
  assert.ok(new Date(completed.completedAt!).getTime() > oldFixture.getTime());
  assert.ok(new Date(completed.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const uncompleted = await updateUserTask(db, userId, task.id, { completed: false });
  assert.equal(uncompleted.completedAt, null);
  assert.ok(new Date(uncompleted.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const edited = await updateUserTask(db, userId, task.id, { title: "Renamed" });
  assert.equal(edited.title, "Renamed");
  assert.ok(new Date(edited.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const noop = await updateUserTask(db, userId, task.id, {});
  assert.equal(new Date(noop.updatedAt).getTime(), oldFixture.getTime());

  // Independent assertions per mutation category — not combined into one
  // mutation — since the point is that each category bumps updatedAt on its
  // own, not merely that PATCH in general does.

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const notesEdited = await updateUserTask(db, userId, task.id, { notes: "Updated notes" });
  assert.equal(notesEdited.notes, "Updated notes");
  assert.ok(new Date(notesEdited.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const dueDateSet = await updateUserTask(db, userId, task.id, { dueDate: "2026-03-01" });
  assert.equal(dueDateSet.dueDate, "2026-03-01");
  assert.ok(new Date(dueDateSet.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const dueDateCleared = await updateUserTask(db, userId, task.id, { dueDate: null });
  assert.equal(dueDateCleared.dueDate, null);
  assert.ok(new Date(dueDateCleared.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const linkSet = await updateUserTask(db, userId, task.id, { transactionId: txnId });
  assert.equal(linkSet.transactionId, txnId);
  assert.ok(new Date(linkSet.updatedAt).getTime() > oldFixture.getTime());

  await db.update(userTasks).set({ updatedAt: oldFixture }).where(eq(userTasks.id, task.id));
  const linkCleared = await updateUserTask(db, userId, task.id, { transactionId: null });
  assert.equal(linkCleared.transactionId, null);
  assert.ok(new Date(linkCleared.updatedAt).getTime() > oldFixture.getTime());
});

// ---------- AC10: list ordering ----------

function fixedId(suffix: string): string {
  return `00000000-0000-4000-8000-00000000000${suffix}`;
}

test("AC10: list ordering is (completed_at is not null) asc, due_date asc nulls last, created_at desc, id asc — fixture forces independent ties at every tier", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const BASE = new Date("2026-01-01T00:00:00.000Z");
  const BASE_1H = new Date(BASE.getTime() + 3_600_000);
  const BASE_2H = new Date(BASE.getTime() + 7_200_000);

  // D and E tie on completion group + due date + created_at -> id asc breaks
  // the tie (fixedId("4") < fixedId("5")).
  // C differs from D/E only by an older created_at -> created_at desc places
  // D/E ahead of C.
  // B differs from C only by a later due date -> due-date-asc places C ahead
  // of B.
  // A has no due date -> nulls-last places it after B.
  // F/G are completed: F has an earlier due date than any incomplete task
  // and G has no due date at all, yet both must sort after every incomplete
  // task — proving the completion tier dominates due date. Within the
  // completed group, F (a real due date) sorts before G (nulls last).
  const rows: Array<{
    suffix: string;
    title: string;
    dueDate: string | null;
    completedAt: Date | null;
    createdAt: Date;
  }> = [
    { suffix: "1", title: "A", dueDate: null, completedAt: null, createdAt: BASE },
    { suffix: "2", title: "B", dueDate: "2026-01-20", completedAt: null, createdAt: BASE },
    { suffix: "3", title: "C", dueDate: "2026-01-10", completedAt: null, createdAt: BASE },
    { suffix: "4", title: "D", dueDate: "2026-01-10", completedAt: null, createdAt: BASE_1H },
    { suffix: "5", title: "E", dueDate: "2026-01-10", completedAt: null, createdAt: BASE_1H },
    { suffix: "6", title: "F", dueDate: "2020-01-01", completedAt: BASE, createdAt: BASE },
    { suffix: "7", title: "G", dueDate: null, completedAt: BASE, createdAt: BASE_2H },
  ];

  for (const r of rows) {
    await db.insert(userTasks).values({
      id: fixedId(r.suffix),
      userId,
      title: r.title,
      dueDate: r.dueDate,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    });
  }

  const list = await listUserTasks(db, userId);
  assert.deepEqual(
    list.map((t2) => t2.title),
    ["D", "E", "C", "B", "A", "F", "G"],
  );
});

// ---------- misc-05 AC8 (direct-service half), AC11, AC12: source/sourceKey ----------

test("AC8 (direct-service half): a hostile direct call to createUserTask with forged source/sourceKey properties is ignored — the exported type excludes them, so this requires a deliberate cast", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const hostileInput = {
    title: "Forged",
    notes: "",
    dueDate: null,
    transactionId: null,
    source: "card-due",
    sourceKey: "forged-key",
  } as unknown as CreateUserTask;

  const created = await createUserTask(db, userId, hostileInput);
  assert.equal(created.source, "user");
  assert.equal(created.sourceKey, null);
});

/** drizzle-orm wraps the underlying pg error as `DrizzleQueryError`, whose own
 * `.message` is just the query text — the Postgres constraint name lives on
 * `.cause.message`, which this checks instead of matching against the whole
 * error's `.message` (which would never contain it). */
const causeMatches = (pattern: RegExp) => (e: unknown) =>
  e instanceof Error && pattern.test(String((e as { cause?: unknown }).cause ?? e));

test("AC11: the check constraint rejects an invalid source value", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await assert.rejects(
    db.insert(userTasks).values({ userId, title: "Bad", source: "bogus" }),
    causeMatches(/user_tasks_source_check/),
  );
});

test("AC11: the partial unique index permits many null source_key rows per user but rejects a duplicate non-null (user_id, source_key)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await db.insert(userTasks).values({ userId, title: "A" });
  await db.insert(userTasks).values({ userId, title: "B" });
  const nullRows = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(nullRows.filter((r) => r.sourceKey === null).length, 2);

  const key = `acc-${randomUUID()}:2026-01-01`;
  await db.insert(userTasks).values({ userId, title: "C", source: "card-due", sourceKey: key });

  await assert.rejects(
    db.insert(userTasks).values({ userId, title: "D", source: "card-due", sourceKey: key }),
    causeMatches(/user_tasks_source_key_idx/),
  );
});

// FIX 3 (misc-05 iteration 2, after review-4): this test inserts a row *after*
// migration 0065 and observes the DEFAULT, which proves the DEFAULT mechanism,
// not migration backfill. Review-4 asked for it to instead query genuinely
// pre-existing rows (created before 0065 ran) and assert they migrated to
// source='user'/sourceKey=null. Checked the dev DB directly against migration
// 0065's actual apply time (`select * from drizzle.__drizzle_migrations` —
// 0065's row has `created_at = 1785606367204` = 2026-08-01T17:46:07.204Z):
// `select count(*) from user_tasks where created_at < '2026-08-01T17:46:07.204Z'`
// returns 0. In fact `select count(*) from user_tasks` returns 0 — this dev DB
// has no user_tasks rows at all, pre- or post-migration, so there is no
// genuine pre-migration data available here to assert backfill against. Per
// instruction, AC12 is left as-is (inspection-only, insert-then-observe-
// DEFAULT) rather than fabricating a fixture that would just re-prove the
// same DEFAULT under a "migration coverage" label.
test("AC12: a row inserted without specifying source/sourceKey defaults to source='user', sourceKey=null — the same DEFAULT mechanism the migration's ADD COLUMN backfilled every pre-existing row with", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const [row] = await db.insert(userTasks).values({ userId, title: "Legacy row" }).returning();
  assert.equal(row!.source, "user");
  assert.equal(row!.sourceKey, null);
});
