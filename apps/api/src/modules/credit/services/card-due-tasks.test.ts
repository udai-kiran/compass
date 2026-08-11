import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { formatINR, UpdateUserTaskSchema } from "@compass/shared";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, alertLedger, transactions, userTasks, users } from "../../../db/schema.ts";
import { cardDetails, cardIssuerSettings } from "../schema.ts";
import { cardCycle, lastOccurrence, nextOccurrence } from "./cycle-math.ts";
import { listCardHolders } from "./cards.ts";
import { materializeCardDueTasks, truncateTaskTitle } from "./card-due-tasks.ts";
import { createAccount } from "../../ledger/services/accounts.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";

// DB-backed: this repo has no DB-mocking infrastructure (see emis.test.ts's
// identical DB-backed section). Export DATABASE_URL before running
// `npm run test -w apps/api`.
//
// IMPORTANT: materializeCardDueTasks(db) is a *global* batch job with no
// per-user scoping by design (mirrors evaluateCardDueReminders /
// materializeDue). Run against this repo's shared dev Postgres, it would
// also process any other non-demo user's genuinely-due card in that database
// — not a correctness bug, just an unsandboxable real side effect. The
// preflight guard below refuses to run rather than risk materializing a real
// user's card as a side effect of this test file, and every assertion below
// is additionally scoped to each test's own throwaway userId/accountId.

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "card-due-tasks.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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

before(async () => {
  const rows = await db.execute(sql`
    select count(*)::int as count
    from card_details cd
    join users u on u.id = cd.user_id
    where u.is_demo = false
  `);
  const count = Number((rows.rows[0] as { count: number }).count);
  if (count > 0) {
    throw new Error(
      `card-due-tasks.test.ts calls the real, global materializeCardDueTasks(db) against this ` +
        `repo's shared dev Postgres (no test-DB isolation exists). Found ${count} pre-existing ` +
        `non-demo card_details row(s) — refusing to run, since a due card among them would be ` +
        `materialized as a real user_tasks row. Clear or archive unrelated credit-card accounts ` +
        `from this database before running this test file.`,
    );
  }
});

/**
 * The fixed reference date used by every AC1-AC15 fixture below. `today` is
 * now an explicit parameter of `materializeCardDueTasks` (mirroring
 * `listCardHolders(db, userId, today?)`), so this is a literal, not the wall
 * clock — the previous `new Date().toISOString()` meant the whole suite threw
 * whenever the real calendar date happened to fall within 10-20 days of the
 * 29th/30th/31st (see `findCycleDay`/`findDueDay` below, which only search
 * `cycleDay`/`dueDay` 1-28 — the same domain the product itself enforces via
 * `CardDetailsSchema`'s `.min(1).max(28)`, so a fixture "due date" can never
 * legitimately land on the 29th-31st; only `today` itself can).
 *
 * `2026-06-01` — deliberately the 1st of the month, not just "some safe day".
 * Found by trial: the "AC15 ... 4-day statement-generation lag" fixture below
 * calls `findCycleDayWithRecentNaiveClose(today)`, which always returns the
 * *smallest* cycleDay whose naive close sits 0-3 days before `today` — i.e.
 * `today`'s own day-of-month minus up to 3 (clamped at 1) — and that cycleDay
 * then gets lag-suppressed a further month back. For `findDueDay(lag-close,
 * today)` (that fixture's own "due exactly today") to have any solution at
 * all, the suppressed close's day-of-month must be >= today's day-of-month,
 * which algebraically only holds when `today`'s own day is 1 (so the search
 * has no smaller same-month candidate to prefer and returns cycleDay=1
 * itself). This is a pre-existing constraint of that one fixture's own
 * search-helper interaction, not something FIX1 introduces or is asked to
 * redesign — flagging it here because `today = 2026-06-22` (an otherwise
 * "safe", non-29-31 choice) reproducibly threw
 * `no dueDay 1..28 gives due=2026-06-22 for close=2026-05-19` on that one
 * test until this was narrowed to the 1st.
 *
 * Every other `shiftIso` offset this file uses (-20 down to +6) stays within
 * the 1-28 domain from `2026-06-01` too (verified: -20 -> day 12, -15 -> day
 * 17, -10 -> day 22, +6 -> day 7, all in the previous/current month with no
 * unsafe wrap). The dedicated "FIX1 proof" tests further below independently
 * pin `today` itself to the 29th/30th/31st and a month-end rollover, proving
 * the wall-clock removal without requiring this shared default to also
 * survive those days.
 */
function todayIso(): string {
  return "2026-06-01";
}

/** An ISO date shifted by whole days — local to these tests (mirrors cards.test.ts's shiftIso). */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Find a cycleDay (1-28) whose `cardCycle(ref, cycleDay).close` is exactly
 * `targetClose` — by calling the real, exported `cardCycle` itself (never
 * re-derived by hand), so the fixture can never disagree with production
 * arithmetic.
 */
function findCycleDay(ref: string, targetClose: string): number {
  for (let day = 1; day <= 28; day++) {
    if (cardCycle(ref, day).close === targetClose) return day;
  }
  throw new Error(`no cycleDay 1..28 gives close=${targetClose} for ref=${ref}`);
}

/** Find a cycleDay (1-28) whose naive `lastOccurrence(today, day)` is within `maxDaysSince` days of today — i.e. inside the 4-day statement-generation lag. */
function findCycleDayWithRecentNaiveClose(today: string, maxDaysSince = 3): number {
  for (let day = 1; day <= 28; day++) {
    const naive = lastOccurrence(today, day);
    const daysSince = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${naive}T00:00:00Z`)) / 86_400_000;
    if (daysSince >= 0 && daysSince <= maxDaysSince) return day;
  }
  throw new Error(`no cycleDay 1..28 gives a naive close within ${maxDaysSince} days of ${today}`);
}

/** Find a dueDay (1-28) whose `nextOccurrence(close, day)` is exactly `targetDue` — same rationale as findCycleDay. */
function findDueDay(close: string, targetDue: string): number {
  for (let day = 1; day <= 28; day++) {
    if (nextOccurrence(close, day) === targetDue) return day;
  }
  throw new Error(`no dueDay 1..28 gives due=${targetDue} for close=${close}`);
}

async function createUser(isDemo = false): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `card-due-tasks-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "card-due-tasks.test.ts user",
      isDemo,
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createCardAccount(
  userId: string,
  name: string,
  openingBalancePaise = 0,
  institution?: string,
  openingDate?: string,
): Promise<string> {
  // Use the real createAccount so system accounts are seeded and a postings-based
  // opening transaction is written when openingBalancePaise !== 0.  A raw
  // db.insert(accounts) would bypass postings and make the balance invisible to
  // any reader that was converted to query postings (e.g. listCardHolders).
  const account = await createAccount(db, userId, {
    name,
    type: "credit_card",
    institution: institution ?? null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  }, openingDate);
  return account.id;
}

async function createTxn(
  userId: string,
  accountId: string,
  date: string,
  amountPaise: number,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  // Use createTransaction so the dual-write posting is created alongside the
  // legacy transactions row, mirroring production. The readers that were
  // converted by PR-E now query postings, so a fixture with no posting would
  // be invisible to those readers.
  const txn = await createTransaction(db, userId, { accountId, date, amountPaise });
  if (opts.deleted) {
    await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, txn.id));
  }
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(userTasks).where(eq(userTasks.userId, userId));
  await db.delete(alertLedger).where(eq(alertLedger.userId, userId));
  await db.delete(cardIssuerSettings).where(eq(cardIssuerSettings.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId)); // cascades card_details
  await db.delete(users).where(eq(users.id, userId));
}

/** The `listCardHolders` view of one specific card, or null if it isn't listed at all (e.g. archived). */
async function getCard(userId: string, today: string, accountId: string) {
  const holders = await listCardHolders(db, userId, today);
  for (const h of holders) {
    const found = h.cards.find((c) => c.accountId === accountId);
    if (found) return { holder: h, card: found };
  }
  return null;
}

// ---------- AC1 ----------

test("AC1: an eligible card materialises exactly one task with the correct title/dueDate/source/sourceKey and provenance-labelled notes", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10); // safely past the 4-day statement-generation lag
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today); // due exactly today
  const accountId = await createCardAccount(userId, "Test Card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -543210);

  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 1);

  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 1);
  const task = tasks[0]!;
  assert.equal(task.title, "Pay Test Card bill");
  assert.equal(task.dueDate, today);
  assert.equal(task.source, "card-due");
  assert.equal(task.sourceKey, `${accountId}:${today}`);
  assert.equal(
    task.notes,
    `${formatINR(543210)} due (ledger-derived) for the statement ending ${shiftIso(close, -1)}.`,
  );

  const ledgerRows = await db
    .select()
    .from(alertLedger)
    .where(and(eq(alertLedger.userId, userId), eq(alertLedger.kind, "card-due-task")));
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0]!.refKey, `${accountId}:${today}`);
});

// ---------- AC2 ----------

test("AC2: running the materialization pass twice creates exactly one task (idempotent via the alert_ledger claim)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Idempotent card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -100000);

  await materializeCardDueTasks(db, today);
  await materializeCardDueTasks(db, today);

  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 1);
});

// ---------- AC3 ----------

test("AC3: deleting a materialised task and re-running the pass does not recreate it (alert_ledger is the tombstone)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Deletable card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -100000);

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  await db.delete(userTasks).where(eq(userTasks.id, task!.id));

  await materializeCardDueTasks(db, today);

  const tasksAfter = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasksAfter.length, 0);
  const ledgerRows = await db
    .select()
    .from(alertLedger)
    .where(and(eq(alertLedger.userId, userId), eq(alertLedger.kind, "card-due-task")));
  assert.equal(ledgerRows.length, 1, "the claim itself is untouched by the user deleting the task");
});

// ---------- AC4 ----------

test("AC4: dueDate === null (no card_details row) materialises nothing", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  await createCardAccount(userId, "No details card");

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 0);
});

test("AC4: amountDuePaise <= 0 (no billed spend) materialises nothing", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Zero balance card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  // no transactions -> amountDuePaise === 0

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 0);
});

test("AC4: a due date outside the remind window (already past due) materialises nothing", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -20);
  const cycleDay = findCycleDay(today, close);
  const pastDue = shiftIso(close, 5); // well before today -> today > card.dueDate
  const dueDay = findDueDay(close, pastDue);
  const accountId = await createCardAccount(userId, "Past due card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -100000);

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 0);
});

// ---------- AC5 ----------

test("AC5: a demo user and a non-demo user in the same pass — the demo user materialises nothing, and excluding it does not abort the non-demo user", async (t) => {
  const demoUserId = await createUser(true);
  const realUserId = await createUser(false);
  t.after(async () => {
    await cleanupUser(demoUserId);
    await cleanupUser(realUserId);
  });
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);

  const demoAccountId = await createCardAccount(demoUserId, "Demo card");
  await db.insert(cardDetails).values({ accountId: demoAccountId, userId: demoUserId, cycleDay, dueDay });
  await createTxn(demoUserId, demoAccountId, shiftIso(close, -3), -100000);

  const realAccountId = await createCardAccount(realUserId, "Real card");
  await db.insert(cardDetails).values({ accountId: realAccountId, userId: realUserId, cycleDay, dueDay });
  await createTxn(realUserId, realAccountId, shiftIso(close, -3), -100000);

  await materializeCardDueTasks(db, today);

  const demoTasks = await db.select().from(userTasks).where(eq(userTasks.userId, demoUserId));
  assert.equal(demoTasks.length, 0, "demo users are excluded before materialising anything");

  const realTasks = await db.select().from(userTasks).where(eq(userTasks.userId, realUserId));
  assert.equal(realTasks.length, 1, "the non-demo user is processed in the same pass, unaffected by the demo exclusion");
});

// ---------- AC6 ----------

test("AC6: a forced insert failure rolls back the alert_ledger claim; removing the conflict and re-running creates both rows", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Conflict card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -250000);
  const sourceKey = `${accountId}:${today}`;

  // Step 1: pre-create a task carrying the target sourceKey but with NO
  // matching alert_ledger row — bypassing the service directly so the
  // partial unique index (user_id, source_key) forces the materialiser's own
  // insert to fail.
  await db.insert(userTasks).values({
    userId,
    title: "Pre-existing conflicting task",
    source: "card-due",
    sourceKey,
  });

  // Step 2: run materialisation. The per-user catch is expected to catch the
  // unique-violation thrown by the userTasks insert.
  await materializeCardDueTasks(db, today);

  // Step 3: assert the ledger claim rolled back with the failed insert — no
  // card-due-task ledger row exists for this key.
  const ledgerAfterFailure = await db
    .select()
    .from(alertLedger)
    .where(
      and(
        eq(alertLedger.userId, userId),
        eq(alertLedger.kind, "card-due-task"),
        eq(alertLedger.refKey, sourceKey),
      ),
    );
  assert.equal(ledgerAfterFailure.length, 0);

  // Step 4: only the pre-existing conflicting task exists — the
  // materialiser's own insert never landed.
  const tasksAfterFailure = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasksAfterFailure.length, 1);
  assert.equal(tasksAfterFailure[0]!.title, "Pre-existing conflicting task");

  // Step 5: remove the deliberate conflict.
  await db.delete(userTasks).where(eq(userTasks.userId, userId));

  // Step 6: re-run.
  await materializeCardDueTasks(db, today);

  // Step 7: assert both the ledger claim and the task now exist.
  const ledgerAfterRetry = await db
    .select()
    .from(alertLedger)
    .where(
      and(
        eq(alertLedger.userId, userId),
        eq(alertLedger.kind, "card-due-task"),
        eq(alertLedger.refKey, sourceKey),
      ),
    );
  assert.equal(ledgerAfterRetry.length, 1);
  const tasksAfterRetry = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasksAfterRetry.length, 1);
  assert.equal(tasksAfterRetry[0]!.title, "Pay Conflict card bill");
  assert.equal(tasksAfterRetry[0]!.sourceKey, sourceKey);
});

// ---------- FIX2/AC13 (rev 5): per-card isolation, tightened from per-user ----------
//
// review-4's blocking finding was that rev 4 had per-card try/catch as a
// design claim with no test proving it. This poisons user A's FIRST of two
// eligible cards exactly as AC6 does (a pre-existing task carrying the
// card's sourceKey but no matching alert_ledger row, forcing the
// materialiser's own insert to fail on unique-violation), then asserts the
// blast radius stops at that one card: A's second card still materialises,
// and user B — entirely unrelated — is unaffected.

test("FIX2/AC13: poisoning user A's first card does not suppress A's second card, and user B is entirely unaffected", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);

  // User A, card 1: poisoned — a pre-existing task claims this card's
  // sourceKey with no matching alert_ledger row, so the materialiser's own
  // claim+insert transaction for this card fails on the unique index.
  const aCard1 = await createCardAccount(userA, "A Card 1 (poisoned)");
  await db.insert(cardDetails).values({ accountId: aCard1, userId: userA, cycleDay, dueDay });
  await createTxn(userA, aCard1, shiftIso(close, -3), -100000);
  const aCard1Key = `${aCard1}:${today}`;
  await db.insert(userTasks).values({
    userId: userA,
    title: "Pre-existing conflicting task for A's first card",
    source: "card-due",
    sourceKey: aCard1Key,
  });

  // User A, card 2: otherwise eligible and untouched.
  const aCard2 = await createCardAccount(userA, "A Card 2");
  await db.insert(cardDetails).values({ accountId: aCard2, userId: userA, cycleDay, dueDay });
  await createTxn(userA, aCard2, shiftIso(close, -3), -200000);

  // Pin processing order: aCard1 must be processed before aCard2 so the test
  // genuinely proves per-CARD continuation (not just per-user). listCardHolders
  // orders by sortOrder ASC, then createdAt ASC.
  await db.update(accounts).set({ sortOrder: 0 }).where(eq(accounts.id, aCard1));
  await db.update(accounts).set({ sortOrder: 1 }).where(eq(accounts.id, aCard2));

  // User B: two eligible cards, entirely unrelated to user A.
  const bCard1 = await createCardAccount(userB, "B Card 1");
  await db.insert(cardDetails).values({ accountId: bCard1, userId: userB, cycleDay, dueDay });
  await createTxn(userB, bCard1, shiftIso(close, -3), -300000);
  const bCard2 = await createCardAccount(userB, "B Card 2");
  await db.insert(cardDetails).values({ accountId: bCard2, userId: userB, cycleDay, dueDay });
  await createTxn(userB, bCard2, shiftIso(close, -3), -400000);

  // One pass. Must return normally despite the poisoned card.
  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 3, "A's second card + both of B's cards must still materialise in this one pass");

  // A's first (poisoned) card: no committed ledger claim for its key.
  const aCard1Ledger = await db
    .select()
    .from(alertLedger)
    .where(
      and(
        eq(alertLedger.userId, userA),
        eq(alertLedger.kind, "card-due-task"),
        eq(alertLedger.refKey, aCard1Key),
      ),
    );
  assert.equal(aCard1Ledger.length, 0, "A's poisoned first card must have no committed ledger claim");

  // A's second card materialised normally alongside the untouched conflicting task.
  const aTasks = await db.select().from(userTasks).where(eq(userTasks.userId, userA));
  assert.equal(aTasks.length, 2, "the pre-existing conflicting task, plus exactly one new task for A's second card");
  assert.ok(
    aTasks.some((r) => r.sourceKey === `${aCard2}:${today}`),
    "A's second card must materialise normally despite the first card's failure",
  );

  // User B is entirely unaffected.
  const bTasks = await db.select().from(userTasks).where(eq(userTasks.userId, userB));
  assert.equal(bTasks.length, 2, "user B's cards are entirely unaffected by user A's poisoned card");
  assert.ok(bTasks.some((r) => r.sourceKey === `${bCard1}:${today}`));
  assert.ok(bTasks.some((r) => r.sourceKey === `${bCard2}:${today}`));
});

// ---------- AC7: cross-user isolation ----------

test("AC7(a): card_details.user_id disagreeing with its account owner processes the card for neither user", async (t) => {
  const owner = await createUser();
  const impostor = await createUser();
  t.after(async () => {
    await cleanupUser(owner);
    await cleanupUser(impostor);
  });
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(owner, "Mismatched card");
  // card_details.user_id points at `impostor`, not the account's real owner.
  await db.insert(cardDetails).values({ accountId, userId: impostor, cycleDay, dueDay });
  await createTxn(owner, accountId, shiftIso(close, -3), -100000);

  await materializeCardDueTasks(db, today);

  const ownerTasks = await db.select().from(userTasks).where(eq(userTasks.userId, owner));
  const impostorTasks = await db.select().from(userTasks).where(eq(userTasks.userId, impostor));
  assert.equal(
    ownerTasks.length,
    0,
    "the account owner has no card_details row keyed to them, so listCardHolders never attaches a cycle to it",
  );
  assert.equal(
    impostorTasks.length,
    0,
    "the impostor does not own the account, so listCardHolders(impostor) never lists it as one of their cards",
  );
});

test("AC7(b): an alert_ledger row under user A whose ref_key embeds user B's account id does not suppress user B's legitimate task", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountB = await createCardAccount(userB, "B's card");
  await db.insert(cardDetails).values({ accountId: accountB, userId: userB, cycleDay, dueDay });
  await createTxn(userB, accountB, shiftIso(close, -3), -100000);
  const sourceKey = `${accountB}:${today}`;

  // A forged claim under user A, naming B's account+due-date in ref_key.
  await db.insert(alertLedger).values({ userId: userA, kind: "card-due-task", refKey: sourceKey });

  await materializeCardDueTasks(db, today);

  const tasksB = await db.select().from(userTasks).where(eq(userTasks.userId, userB));
  assert.equal(tasksB.length, 1);
  assert.equal(tasksB[0]!.sourceKey, sourceKey);
});

test("AC7(c): a forged card-due task under user A naming user B's account in sourceKey does not suppress, modify, or collide with user B's task", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountB = await createCardAccount(userB, "B's card");
  await db.insert(cardDetails).values({ accountId: accountB, userId: userB, cycleDay, dueDay });
  await createTxn(userB, accountB, shiftIso(close, -3), -100000);
  const sourceKey = `${accountB}:${today}`;

  await db.insert(userTasks).values({
    userId: userA,
    title: "Forged task naming B's account",
    source: "card-due",
    sourceKey,
  });

  await materializeCardDueTasks(db, today);

  const tasksA = await db.select().from(userTasks).where(eq(userTasks.userId, userA));
  assert.equal(tasksA.length, 1);
  assert.equal(tasksA[0]!.title, "Forged task naming B's account", "user A's forged row is untouched");

  const tasksB = await db.select().from(userTasks).where(eq(userTasks.userId, userB));
  assert.equal(tasksB.length, 1);
  assert.equal(tasksB[0]!.sourceKey, sourceKey);
});

test("AC7(d): identical source_key text under two different users is permitted for both, independently", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const sharedKey = `${randomUUID()}:2026-01-01`;

  const [taskA] = await db
    .insert(userTasks)
    .values({ userId: userA, title: "A", source: "card-due", sourceKey: sharedKey })
    .returning();
  const [taskB] = await db
    .insert(userTasks)
    .values({ userId: userB, title: "B", source: "card-due", sourceKey: sharedKey })
    .returning();

  assert.equal(taskA!.sourceKey, sharedKey);
  assert.equal(taskB!.sourceKey, sharedKey);

  // Deleting one must not touch the other.
  await db.delete(userTasks).where(eq(userTasks.id, taskA!.id));
  const remaining = await db.select().from(userTasks).where(eq(userTasks.userId, userB));
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]!.id, taskB!.id);
});

// ---------- AC9: insert-only property ----------

test("AC9: after a dueDay change, the pre-existing card-due task is byte-for-byte unchanged and a second task exists for the new key", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Config drift card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -80000);

  await materializeCardDueTasks(db, today);
  const [firstTask] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(firstTask);
  const firstSnapshot = { ...firstTask };

  // Simulate a mid-window dueDay edit — the due date (and thus sourceKey) shifts.
  const newDueDate = shiftIso(today, 2);
  const newDueDay = findDueDay(close, newDueDate);
  await db.update(cardDetails).set({ dueDay: newDueDay }).where(eq(cardDetails.accountId, accountId));

  await materializeCardDueTasks(db, today);

  const tasksAfter = await db
    .select()
    .from(userTasks)
    .where(eq(userTasks.userId, userId))
    .orderBy(userTasks.createdAt);
  assert.equal(tasksAfter.length, 2, "a second task must exist for the new key, and the old one must not be deleted");
  const stillFirst = tasksAfter.find((r) => r.id === firstTask!.id);
  assert.ok(stillFirst, "the original task row must still exist (never deleted)");
  assert.deepEqual(stillFirst, firstSnapshot, "the original task row must be byte-for-byte unchanged (never updated)");
  const second = tasksAfter.find((r) => r.id !== firstTask!.id);
  assert.ok(second);
  assert.equal(second!.dueDate, newDueDate);
  assert.equal(second!.sourceKey, `${accountId}:${newDueDate}`);
});

// ---------- AC10: UTF-16-safe title truncation ----------

test("AC10: truncateTaskTitle is UTF-16-safe — ASCII, an astral character landing exactly on the boundary, and an emoji sequence", () => {
  assert.equal(truncateTaskTitle("Pay Test Card bill"), "Pay Test Card bill");

  const exact200 = "a".repeat(200);
  assert.equal(truncateTaskTitle(exact200), exact200);

  const ascii201 = "a".repeat(201);
  assert.equal(truncateTaskTitle(ascii201), "a".repeat(200));

  // An astral character (a surrogate pair, 2 UTF-16 code units) whose pair
  // straddles the 200-unit cut — a bare slice(0, 200) would leave a lone high
  // surrogate at index 199; it must be dropped instead.
  const astral = "\u{1F600}"; // 😀
  const landsOnBoundary = "a".repeat(199) + astral + "b".repeat(10);
  const truncatedAstral = truncateTaskTitle(landsOnBoundary);
  assert.equal(truncatedAstral, "a".repeat(199));
  assert.equal(truncatedAstral.length, 199);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(truncatedAstral), false);

  // Emoji sequence nowhere near the cut boundary: must survive intact, and the
  // cut itself (deep in plain ASCII) must still land cleanly.
  const withEmojiEarly = "🎉".repeat(5) + "c".repeat(250);
  const truncatedEmoji = truncateTaskTitle(withEmojiEarly);
  assert.equal(truncatedEmoji.length, 200);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(truncatedEmoji), false);
});

test("AC10: a title truncated from a long account name still validates against UpdateUserTaskSchema, and the persisted row matches truncateTaskTitle's output", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const longName = "Very Long Card Name ".repeat(15); // 300 chars — pushes "Pay <name> bill" past 200
  const accountId = await createCardAccount(userId, longName);
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -10000);

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.ok(task!.title.length <= 200);
  assert.equal(task!.title, truncateTaskTitle(`Pay ${longName} bill`));
  const parsed = UpdateUserTaskSchema.parse({ title: task!.title });
  assert.equal(parsed.title, task!.title);
});

// ---------- AC15: reuses listCardHolders rather than reimplementing its arithmetic ----------

test("AC15: reuses listCardHolders' 4-day statement-generation lag", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const cycleDay = findCycleDayWithRecentNaiveClose(today);
  const cycle = cardCycle(today, cycleDay); // the real, lag-adjusted cycle
  const naiveClose = lastOccurrence(today, cycleDay);
  assert.notEqual(cycle.close, naiveClose, "fixture sanity: the naive close must actually be lag-suppressed");
  const dueDay = findDueDay(cycle.close, today);
  const accountId = await createCardAccount(userId, "Gen-lag card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(cycle.close, -3), -60000); // billed in the real (lagged) cycle
  await createTxn(userId, accountId, naiveClose, -9999999); // after the real close -> unbilled, must not count

  const found = await getCard(userId, today, accountId);
  assert.ok(found);
  assert.equal(
    found!.card.amountDuePaise,
    60000,
    "the recent, not-yet-generated cycle's spend must not count toward what's due",
  );

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(
    task!.notes,
    `${formatINR(60000)} due (ledger-derived) for the statement ending ${found!.card.statementEnd}.`,
  );
  assert.equal(task!.dueDate, found!.card.dueDate);
});

test("AC15: reuses listCardHolders' handling of a non-zero opening balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Opening balance card", -300000, undefined, "2020-01-01");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -50000);

  const found = await getCard(userId, today, accountId);
  assert.ok(found);
  assert.equal(found!.card.amountDuePaise, 350000);

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(
    task!.notes,
    `${formatINR(found!.card.amountDuePaise)} due (ledger-derived) for the statement ending ${found!.card.statementEnd}.`,
  );
});

test("AC15: reuses listCardHolders' exclusion of soft-deleted transactions", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Soft-delete card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -50000);
  await createTxn(userId, accountId, shiftIso(close, -2), -9999999, { deleted: true }); // must not count

  const found = await getCard(userId, today, accountId);
  assert.ok(found);
  assert.equal(found!.card.amountDuePaise, 50000);

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(
    task!.notes,
    `${formatINR(50000)} due (ledger-derived) for the statement ending ${found!.card.statementEnd}.`,
  );
});

test("AC15: reuses listCardHolders' close-day exclusivity — a transaction dated on the close day bills next cycle, not this one", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Close-day card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -50000); // this cycle
  await createTxn(userId, accountId, close, -9999999); // dated exactly on close -> next cycle

  const found = await getCard(userId, today, accountId);
  assert.ok(found);
  assert.equal(found!.card.amountDuePaise, 50000);

  await materializeCardDueTasks(db, today);
  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(
    task!.notes,
    `${formatINR(50000)} due (ledger-derived) for the statement ending ${found!.card.statementEnd}.`,
  );
});

test("AC15: reuses listCardHolders' archived-account exclusion — an archived card is never materialised", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueDay = findDueDay(close, today);
  const accountId = await createCardAccount(userId, "Archived card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -50000);
  await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, accountId));

  const found = await getCard(userId, today, accountId);
  assert.equal(found, null, "an archived card must not appear in listCardHolders at all");

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 0);
});

test("AC15: reuses listCardHolders' default remindDays=3 when no issuer settings row exists", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const dueIn3 = shiftIso(today, 3);
  const dueDay = findDueDay(close, dueIn3);
  const accountId = await createCardAccount(userId, "Default remind card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -70000);
  // no cardIssuerSettings row -> holder.settings is null -> remindDays defaults to 3

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.dueDate, dueIn3);
});

test("AC15: reuses listCardHolders' remindDays boundary — due date exactly remindDays away is included, one day further is not", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = todayIso();
  const close = shiftIso(today, -10);
  const cycleDay = findCycleDay(today, close);
  const institution = `Test Bank ${randomUUID()}`;
  await db.insert(cardIssuerSettings).values({ userId, institution, remindDays: 5 });

  // Card A: due in exactly 5 days -> remindFrom === today -> included (inclusive lower boundary).
  const dueIn5 = shiftIso(today, 5);
  const dueDayA = findDueDay(close, dueIn5);
  const accountA = await createCardAccount(userId, "Card A", 0, institution);
  await db.insert(cardDetails).values({ accountId: accountA, userId, cycleDay, dueDay: dueDayA });
  await createTxn(userId, accountA, shiftIso(close, -3), -10000);

  // Card B: due in 6 days -> remindFrom is tomorrow -> not yet in the window.
  const dueIn6 = shiftIso(today, 6);
  const dueDayB = findDueDay(close, dueIn6);
  const accountB = await createCardAccount(userId, "Card B", 0, institution);
  await db.insert(cardDetails).values({ accountId: accountB, userId, cycleDay, dueDay: dueDayB });
  await createTxn(userId, accountB, shiftIso(close, -3), -10000);

  await materializeCardDueTasks(db, today);
  const tasks = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.dueDate, dueIn5);
});

// ---------- FIX1/AC17 (rev 5): materializeCardDueTasks does not depend on the wall clock ----------
//
// Before this fix, `materializeCardDueTasks(db)` read `new Date()` itself, and
// this file's fixtures were built from the same real wall clock. A card's own
// `dueDate`/statement `close` can never land on the 29th-31st — `cycleDay`/
// `dueDay` are capped at 1-28 by the product itself (`CardDetailsSchema`'s
// `.min(1).max(28)`, mirrored by `findCycleDay`/`findDueDay`'s 1-28 search
// above) — so the one date in this whole system genuinely free to fall on any
// day at all is `today`. Whenever the real calendar date (or a derived target
// close/due built from it) landed on the 29th-31st, those finders threw.
//
// Each fixture below pins `today` explicitly via the new optional parameter
// and sets the card's due date to exactly `remindDays` after `today` — the
// eligibility window's far boundary (`remindFrom === today`) — which for a
// `today` this close to month-end rolls over into the next month (and, in the
// last case, the next year) at a low, in-domain day-of-month. This proves the
// eligibility arithmetic (plain ISO string comparison plus native `Date`
// month/year rollover in `card-due-tasks.ts`) is correct across that boundary,
// without requiring the day-restricted test helpers to reach an impossible
// 29-31 target.

test("FIX1 proof: today pinned to the 29th (2026-01-29) does not throw and materialises correctly", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = "2026-01-29";
  const close = shiftIso(today, -10); // 2026-01-19
  const cycleDay = findCycleDay(today, close);
  const dueDate = shiftIso(today, 3); // 2026-02-01 — default remindDays=3, rolls into February
  const dueDay = findDueDay(close, dueDate);
  const accountId = await createCardAccount(userId, "29th pin card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -123400);

  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 1, "expected a task to be created when today is pinned to the 29th");

  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(task!.dueDate, dueDate);
  assert.equal(task!.sourceKey, `${accountId}:${dueDate}`);
});

test("FIX1 proof: today pinned to the 30th (2026-01-30) does not throw and materialises correctly", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = "2026-01-30";
  const close = shiftIso(today, -10); // 2026-01-20
  const cycleDay = findCycleDay(today, close);
  const dueDate = shiftIso(today, 3); // 2026-02-02
  const dueDay = findDueDay(close, dueDate);
  const accountId = await createCardAccount(userId, "30th pin card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -123400);

  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 1, "expected a task to be created when today is pinned to the 30th");

  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(task!.dueDate, dueDate);
  assert.equal(task!.sourceKey, `${accountId}:${dueDate}`);
});

test("FIX1 proof: today pinned to the 31st (2026-01-31) does not throw and materialises correctly", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = "2026-01-31";
  const close = shiftIso(today, -10); // 2026-01-21
  const cycleDay = findCycleDay(today, close);
  const dueDate = shiftIso(today, 3); // 2026-02-03
  const dueDay = findDueDay(close, dueDate);
  const accountId = await createCardAccount(userId, "31st pin card");
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -123400);

  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 1, "expected a task to be created when today is pinned to the 31st");

  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(task!.dueDate, dueDate);
  assert.equal(task!.sourceKey, `${accountId}:${dueDate}`);
});

test("FIX1 proof: a month-end -> month-start (year) rollover — today pinned to 2025-12-31, due date 2026-01-01", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const today = "2025-12-31";
  const close = shiftIso(today, -10); // 2025-12-21
  const cycleDay = findCycleDay(today, close);
  const remindDays = 1;
  const institution = `FIX1 rollover bank ${randomUUID()}`;
  await db.insert(cardIssuerSettings).values({ userId, institution, remindDays });
  const dueDate = shiftIso(today, remindDays); // 2026-01-01 — crosses both month and year
  const dueDay = findDueDay(close, dueDate);
  const accountId = await createCardAccount(userId, "Year-rollover card", 0, institution);
  await db.insert(cardDetails).values({ accountId, userId, cycleDay, dueDay });
  await createTxn(userId, accountId, shiftIso(close, -3), -123400);

  const created = await materializeCardDueTasks(db, today);
  assert.ok(created >= 1, "expected a task to be created across the year boundary");

  const [task] = await db.select().from(userTasks).where(eq(userTasks.userId, userId));
  assert.ok(task);
  assert.equal(task!.dueDate, dueDate);
  assert.equal(task!.sourceKey, `${accountId}:${dueDate}`);
});
