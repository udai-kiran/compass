import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, emailIngestions, postings, transactions, users } from "../../../db/schema.ts";
import { cardDetails, statementReconciliations } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { createAccount, listAccounts } from "../../ledger/services/accounts.ts";
import { postTransaction, resolveSystemAccounts } from "../../ledger/services/post-entry.ts";
import { buildOpeningPostings } from "../../ledger/services/postings.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { getCardActivity } from "./cards.ts";
import { listReconciliations } from "./reconciliation-reads.ts";
import { absorbCarryover, recomputeReconciliation, type AbsorbCarryoverHooks } from "./reconciliation-writes.ts";

// ---------- DB-backed: listReconciliations / recomputeReconciliation ledger-due
// enrichment (P2/P3, tasks/cc-recon-01-statement-drift) ----------
//
// Real Postgres, following recurring.test.ts's harness: a throwaway user (and
// its accounts/transactions/statements) per test, cleaned up via t.after().

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "reconciliation-writes.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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
      email: `cards-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "reconciliation-writes.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createCardAccount(userId: string, openingBalancePaise = 0): Promise<string> {
  // Call the real createAccount so a nonzero openingBalancePaise seeds a real
  // is_opening transaction and its postings, matching what production does.
  // accounts.opening_balance_paise is frozen at 0 after PR-G1 (boot check enforces
  // this), so a raw db.insert with a nonzero column value would be invisible to every
  // postings-based reader (ledgerDuesAtDates, listAccounts, getCardActivity).
  const account = await createAccount(db, userId, {
    name: "Test card",
    type: "credit_card",
    openingBalancePaise,
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
  });
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
  // legacy transactions row, mirroring production. The readers converted by
  // PR-E now query postings; a fixture with no posting is invisible to them.
  const txn = await createTransaction(db, userId, { accountId, date, amountPaise });
  if (opts.deleted) {
    await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, txn.id));
  }
}

/** A minimal email_ingestions row so a reconciliation can carry a valid ingestionId. */
async function createIngestion(userId: string): Promise<string> {
  const [row] = await db
    .insert(emailIngestions)
    .values({ userId, messageId: `cards-test-${randomUUID()}`, raw: "" })
    .returning({ id: emailIngestions.id });
  return row!.id;
}

async function createReconciliation(
  userId: string,
  accountId: string,
  overrides: Partial<typeof statementReconciliations.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(statementReconciliations)
    .values({ userId, accountId, period: "2026-07", ...overrides })
    .returning({ id: statementReconciliations.id });
  return row!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(emailIngestions).where(eq(emailIngestions.userId, userId)); // cascades extracted_transactions
  await db.delete(accounts).where(eq(accounts.userId, userId)); // cascades statement_reconciliations
  await db.delete(users).where(eq(users.id, userId));
}

test("listReconciliations/recomputeReconciliation: Diners-shaped constituent rows (purchases, a payment, a refund) net the signed ledger due and drift", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  // Balance carried forward before this card was tracked in the app.
  const accountId = await createCardAccount(userId, -2000000);
  // createAccount dates the opening transaction at real wall-clock "today", which has now
  // drifted past the fixture's statement close (2026-07-20). Pin it to a date safely before
  // all fixture dates so date-range queries include it correctly.
  await db.execute(sql`
    UPDATE transactions SET date = '2020-01-01'
    WHERE account_id = ${accountId} AND is_opening = true
  `);
  const close = "2026-07-20";
  await createTxn(userId, accountId, "2026-07-02", -3000000); // purchase
  await createTxn(userId, accountId, "2026-07-10", 4559100); // BPPY payment
  await createTxn(userId, accountId, "2026-07-12", 50000); // refund
  await createTxn(userId, accountId, "2026-07-15", -2149575); // purchase
  const ingestionId = await createIngestion(userId);
  const id = await createReconciliation(userId, accountId, {
    statementDate: close,
    ingestionId,
    totalDuePaise: 7099600,
    lineCount: 16,
    lineDebitPaise: 6500000,
  });

  const [row] = await listReconciliations(db, userId, accountId);
  assert.strictEqual(row!.ledgerDuePaise, 2540475);
  assert.strictEqual(row!.dueDriftPaise, 4559125);

  const recomputed = await recomputeReconciliation(db, userId, accountId, id);
  assert.strictEqual(recomputed.ledgerDuePaise, 2540475);
  assert.strictEqual(recomputed.dueDriftPaise, 4559125);
});

test("listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded from the ledger due", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  const close = "2026-08-20";
  await createTxn(userId, accountId, "2026-08-01", -1000);
  await createTxn(userId, accountId, "2026-08-05", -5000000, { deleted: true });
  const ingestionId = await createIngestion(userId);
  const id = await createReconciliation(userId, accountId, { statementDate: close, ingestionId });

  const [row] = await listReconciliations(db, userId, accountId);
  assert.strictEqual(row!.ledgerDuePaise, 1000);

  const recomputed = await recomputeReconciliation(db, userId, accountId, id);
  assert.strictEqual(recomputed.ledgerDuePaise, 1000);
});

test("listReconciliations: a second card of the SAME user does not leak into the aggregate (account predicate)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const close = "2026-09-20";
  const accountA = await createCardAccount(userId);
  const accountB = await createCardAccount(userId);
  await createTxn(userId, accountA, "2026-09-01", -1000);
  await createTxn(userId, accountB, "2026-09-01", -9999999); // must not leak into A's aggregate
  await createReconciliation(userId, accountA, { statementDate: close });

  const [row] = await listReconciliations(db, userId, accountA);
  assert.strictEqual(row!.ledgerDuePaise, 1000);
});

test("listReconciliations: a second user's identical card does not leak (user predicate)", async (t) => {
  const userId = await createUser();
  const otherUserId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
    await cleanupUser(otherUserId);
  });
  const close = "2026-10-20";
  const accountId = await createCardAccount(userId);
  const otherAccountId = await createCardAccount(otherUserId);
  await createTxn(userId, accountId, "2026-10-01", -1000);
  await createTxn(otherUserId, otherAccountId, "2026-10-01", -9999999); // must not leak
  await createReconciliation(userId, accountId, { statementDate: close });

  const [row] = await listReconciliations(db, userId, accountId);
  assert.strictEqual(row!.ledgerDuePaise, 1000);
});

test("listReconciliations: boundary — close−1 counts, close and close+1 do not", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  const close = "2026-11-20";
  await createTxn(userId, accountId, "2026-11-19", -500); // day before close: counted
  await createTxn(userId, accountId, "2026-11-20", -999900000); // on close: excluded (next cycle)
  await createTxn(userId, accountId, "2026-11-21", -888800000); // after close: excluded
  await createReconciliation(userId, accountId, { statementDate: close });

  const [row] = await listReconciliations(db, userId, accountId);
  assert.strictEqual(row!.ledgerDuePaise, 500);
});

test("listReconciliations: statement_date null → both fields null; total_due_paise null with a date → ledgerDue computed, drift null", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  await createTxn(userId, accountId, "2026-12-01", -700);
  const noDateId = await createReconciliation(userId, accountId, {
    period: "2026-12",
    statementDate: null,
    totalDuePaise: 500000,
  });
  const noTotalId = await createReconciliation(userId, accountId, {
    period: "2027-01",
    statementDate: "2027-01-20",
    totalDuePaise: null,
  });

  const rows = await listReconciliations(db, userId, accountId);
  const noDateRow = rows.find((r) => r.id === noDateId)!;
  const noTotalRow = rows.find((r) => r.id === noTotalId)!;
  assert.strictEqual(noDateRow.ledgerDuePaise, null);
  assert.strictEqual(noDateRow.dueDriftPaise, null);
  assert.strictEqual(noTotalRow.ledgerDuePaise, 700);
  assert.strictEqual(noTotalRow.dueDriftPaise, null);
});

test("listReconciliations: an individually-safe opening balance plus an individually-safe transaction sum that together overflow Number.MAX_SAFE_INTEGER is refused (500), not silently truncated", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  // Both operands are safe integers on their own — the bug this guards
  // against is `openingBalancePaise + sum` overflowing only once combined
  // (review-5.md: reconciliation-reads.ts's ledgerDuesAtDates previously
  // checked only the raw `sum`).
  const openingBalancePaise = -(Number.MAX_SAFE_INTEGER - 1000);
  const accountId = await createCardAccount(userId, openingBalancePaise);
  const close = "2027-02-20";
  await createTxn(userId, accountId, "2027-02-01", -2000);
  await createReconciliation(userId, accountId, { period: "2027-02", statementDate: close });

  await assert.rejects(
    listReconciliations(db, userId, accountId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 500,
  );
});

test("recomputeReconciliation: the same opening-balance overflow is refused (500) via the recompute path", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const openingBalancePaise = -(Number.MAX_SAFE_INTEGER - 1000);
  const accountId = await createCardAccount(userId, openingBalancePaise);
  const close = "2027-03-20";
  await createTxn(userId, accountId, "2027-03-01", -2000);
  const ingestionId = await createIngestion(userId);
  const id = await createReconciliation(userId, accountId, { period: "2027-03", statementDate: close, ingestionId });

  await assert.rejects(
    recomputeReconciliation(db, userId, accountId, id),
    (e: unknown) => e instanceof HttpError && e.statusCode === 500,
  );
});

// ---------- absorbCarryover (tasks/cc-recon-02-carryover-seed) ----------

/**
 * Resolves after `release()` is called — the same gate shape used by
 * inbox.test.ts's real-contention tests, reused here so two-connection
 * tests can hold a transaction open exactly as long as the test needs.
 */
function makeGate(): { opened: Promise<void>; release: () => void } {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/**
 * A stub satisfying just the two ioredis methods `repairSnapshots`
 * (networth.ts) calls — `set` for its per-user lock acquisition, `eval` for
 * the lock's release — so these DB-backed tests don't need a real Redis
 * connection. Records every call so AC6 (post-commit repair triggered) can
 * be asserted directly, mirroring networth.test.ts's own `stubRedis`.
 */
function stubRedis() {
  const calls: Array<{ op: "set" | "eval"; key: string }> = [];
  const redis = {
    set: (key: string, ..._rest: unknown[]) => {
      calls.push({ op: "set", key });
      return Promise.resolve("OK");
    },
    eval: (_script: string, _numKeys: number, ...args: string[]) => {
      calls.push({ op: "eval", key: args[0] ?? "" });
      return Promise.resolve(1);
    },
  };
  return { redis, calls };
}

test("absorbCarryover: Diners numbers — opening_balance_paise becomes −4559125, returned dueDriftPaise is 0, and card activity's totalDuePaise matches the bank", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2028-01-20";
  // Before this card was tracked, ₹25,404.75 was already due at close.
  await createTxn(userId, accountId, "2028-01-05", -2540475);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 7099600,
  });
  await db.insert(cardDetails).values({ accountId, userId, cycleDay: 20 });

  const { redis } = stubRedis();
  const result = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);
  assert.equal(result.dueDriftPaise, 0);

  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  // accounts.opening_balance_paise is frozen at 0 after PR-G1; the effective balance lives
  // in the is_opening transaction's posting, which absorbCarryover creates/updates.
  assert.equal(row!.openingBalancePaise, 0, "opening_balance_paise column is frozen at 0 under PR-G1");
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  assert.equal((openingPostings.rows as Array<{ amount_paise: string }>).length, 1, "absorbCarryover created exactly one opening posting");
  assert.equal(Number((openingPostings.rows as Array<{ amount_paise: string }>)[0]!.amount_paise), -4559125);

  const activity = await getCardActivity(db, userId, accountId, "2028-01-25");
  assert.equal(activity.totalDuePaise, 7099600);
});

test("absorbCarryover: a second identical call 409s once drift has been absorbed, and changes nothing further", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2028-02-20";
  await createTxn(userId, accountId, "2028-02-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 300000,
  });

  const { redis } = stubRedis();
  const first = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);
  assert.equal(first.dueDriftPaise, 0);
  const [afterFirst] = await db.select().from(accounts).where(eq(accounts.id, accountId));

  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  const [afterSecond] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(afterSecond!.openingBalancePaise, afterFirst!.openingBalancePaise);
});

test("absorbCarryover: sequential absorbs of two different reconciliation rows on one card — the second sees the post-seed ledger due and 409s at zero drift", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const closeA = "2028-03-20";
  const closeB = "2028-04-20";
  await createTxn(userId, accountId, "2028-03-05", -100000); // before both statements
  const reconA = await createReconciliation(userId, accountId, {
    period: "2028-03",
    statementDate: closeA,
    totalDuePaise: 300000,
  });
  const reconB = await createReconciliation(userId, accountId, {
    period: "2028-04",
    statementDate: closeB,
    totalDuePaise: 300000,
  });

  const { redis } = stubRedis();
  const first = await absorbCarryover(db, redis as never, userId, accountId, reconA);
  assert.equal(first.dueDriftPaise, 0);

  // The same ledger shortfall this just seeded also fully accounts for
  // reconB's due — nothing left to carry forward a second time on this card.
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconB),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("absorbCarryover: absorbing one reconciliation shifts every other row's drift too (a global opening-balance change, not an isolated per-cycle one)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const closeA = "2028-05-20";
  const closeB = "2028-06-20";
  await createTxn(userId, accountId, "2028-05-05", -100000);
  await createTxn(userId, accountId, "2028-06-05", -50000);
  const reconA = await createReconciliation(userId, accountId, {
    period: "2028-05",
    statementDate: closeA,
    totalDuePaise: 300000,
  });
  const reconB = await createReconciliation(userId, accountId, {
    period: "2028-06",
    statementDate: closeB,
    totalDuePaise: 400000,
  });

  const before = await listReconciliations(db, userId, accountId);
  const beforeB = before.find((r) => r.id === reconB)!;
  assert.equal(beforeB.ledgerDuePaise, 150000); // -(0 + -100000 + -50000)
  assert.equal(beforeB.dueDriftPaise, 250000); // 400000 - 150000

  const { redis } = stubRedis();
  await absorbCarryover(db, redis as never, userId, accountId, reconA);

  const after = await listReconciliations(db, userId, accountId);
  const afterB = after.find((r) => r.id === reconB)!;
  assert.equal(afterB.ledgerDuePaise, 350000);
  assert.equal(afterB.dueDriftPaise, 50000);
});

test("absorbCarryover: a nonzero preexisting opening balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, -500000);
  const close = "2028-07-20";
  await createTxn(userId, accountId, "2028-07-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 900000,
  });

  const { redis } = stubRedis();
  const result = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);
  assert.equal(result.dueDriftPaise, 0);
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0, "opening_balance_paise column is frozen at 0 under PR-G1");
  // absorbCarryover updates the existing is_opening posting: -500000 (seeded by createAccount)
  // − drift(300000) = -800000.
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  assert.equal((openingPostings.rows as Array<{ amount_paise: string }>).length, 1, "exactly one opening posting after absorb");
  assert.equal(Number((openingPostings.rows as Array<{ amount_paise: string }>)[0]!.amount_paise), -800000); // -500000 − 300000
});

test("absorbCarryover: a negative-drift fixture 409s and changes nothing", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2028-08-20";
  await createTxn(userId, accountId, "2028-08-05", -500000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 100000, // less than the ledger's own 500000 due — a surplus, not a shortfall
  });

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0);
});

test("absorbCarryover: a null total_due_paise 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: "2028-09-20",
    totalDuePaise: null,
  });

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("absorbCarryover: a null statement_date 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: null,
    totalDuePaise: 500000,
  });

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("absorbCarryover: an archived card 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2028-10-20";
  await createTxn(userId, accountId, "2028-10-05", -500000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 900000,
  });
  await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, accountId));

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("absorbCarryover: a non-credit-card account 400s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const [a] = await db.insert(accounts).values({ userId, name: "Bank", type: "bank" }).returning({ id: accounts.id });
  const reconciliationId = await createReconciliation(userId, a!.id, {
    statementDate: "2028-11-20",
    totalDuePaise: 900000,
  });

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, a!.id, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("absorbCarryover: a foreign (nonexistent) account id 404s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, randomUUID(), randomUUID()),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("absorbCarryover: a reconciliation belonging to another account of the SAME user 404s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountA = await createCardAccount(userId, 0);
  const accountB = await createCardAccount(userId, 0);
  const reconciliationId = await createReconciliation(userId, accountB, {
    statementDate: "2028-12-20",
    totalDuePaise: 900000,
  });

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountA, reconciliationId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("absorbCarryover: only transactions strictly before statement_date count toward the drift", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-01-20";
  await createTxn(userId, accountId, "2029-01-19", -100000); // before: counts
  await createTxn(userId, accountId, "2029-01-20", -999999900); // on close: excluded
  await createTxn(userId, accountId, "2029-01-21", -888888800); // after: excluded
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 300000,
  });

  const { redis } = stubRedis();
  const result = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);
  assert.equal(result.dueDriftPaise, 0);
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0, "opening_balance_paise column is frozen at 0 under PR-G1");
  // ledgerDue(before) = -(0 + -100000) = 100000; drift = 300000 − 100000 = 200000;
  // nextOpeningPaise = 0 − 200000 = -200000.
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  assert.equal((openingPostings.rows as Array<{ amount_paise: string }>).length, 1, "exactly one opening posting inserted by absorbCarryover");
  assert.equal(Number((openingPostings.rows as Array<{ amount_paise: string }>)[0]!.amount_paise), -200000);
});

test("absorbCarryover: listAccounts reflects the new opening balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  // Use past dates so listAccounts's `date <= current_date` filter includes all seeded
  // postings. Future-dated postings are intentionally excluded from the account-list balance
  // (they have not settled yet), so a meaningful assertion requires past dates.
  const close = "2026-07-20";
  await createTxn(userId, accountId, "2026-07-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 300000,
  });

  const { redis } = stubRedis();
  await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);

  const list = await listAccounts(db, userId);
  const found = list.find((a) => a.id === accountId)!;
  // After absorb: opening posting -200000 (dated "2026-07-04", dayBefore the earliest
  // non-opening transaction "2026-07-05") + regular transaction posting -100000 = -300000.
  // Both dates are before today so listAccounts includes both; accounts.opening_balance_paise
  // is frozen at 0, so balancePaise is the correct PR-G1 observable.
  assert.equal(found.balancePaise, -300000);
});

test("absorbCarryover: post-commit, a best-effort net-worth snapshot repair is triggered for this user (AC6)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-03-20";
  await createTxn(userId, accountId, "2029-03-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 300000,
  });
  const { redis, calls } = stubRedis();

  await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);

  // repairSnapshots (networth.ts) takes its per-user repair lock via
  // `redis.set("nw:repair:<userId>", …, "NX")` — its presence here is the
  // "fire-and-forget repair was triggered" assertion.
  assert.ok(
    calls.some((c) => c.op === "set" && c.key === `nw:repair:${userId}`),
    `expected a net-worth repair lock attempt for user ${userId}, got: ${JSON.stringify(calls)}`,
  );
});

// ---------- P6a: the serializable + retry concurrency contract ----------

test("absorbCarryover: a concurrent advisory lock (an opening-balance edit in progress via updateAccount's new protocol) blocks absorb until it commits — the final state matches a serial order", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-04-20";
  await createTxn(userId, accountId, "2029-04-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 250000,
  });

  const started = makeGate();
  const release = makeGate();

  // Connection A: acquires the same account advisory lock that the updated updateAccount
  // uses, holds it open, then commits an opening transaction before releasing — while a
  // concurrent absorbCarryover is blocked at pg_advisory_lock waiting for that same lock.
  // The opening transaction is inserted via the pool (a separate connection) so it commits
  // before the advisory lock is released; absorbCarryover's fresh SERIALIZABLE snapshot
  // therefore includes it.
  const aTxPromise = (async () => {
    const clientA = await pool.connect();
    try {
      await clientA.query(
        "SELECT pg_advisory_lock(hashtextextended($1, 0))",
        [accountId],
      );
      started.release();
      await release.opened;
      // Mutate opening balance through the production path — same mechanism createAccount
      // and absorbCarryover use — so postings-based readers (ledgerDuesAtDates) see it.
      await db.transaction(async (tx) => {
        const [openingTxn] = await tx
          .insert(transactions)
          .values({
            userId,
            accountId,
            date: new Date().toISOString().slice(0, 10),
            amountPaise: -50000,
            merchant: "Opening balance",
            isOpening: true,
          })
          .returning({ id: transactions.id });
        const sys = await resolveSystemAccounts(tx, userId);
        await postTransaction(
          tx,
          openingTxn!.id,
          userId,
          buildOpeningPostings({ accountId, amountPaise: -50000, systemOpeningAccountId: sys.opening }),
        );
      });
      // Release advisory lock. The opening transaction above committed on the pool, so
      // absorbCarryover's SERIALIZABLE snapshot (taken after lock acquisition) includes it.
      const unlockResult = await clientA.query(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
        [accountId],
      );
      assert.equal(
        (unlockResult.rows as Array<{ unlocked: boolean }>)[0]?.unlocked,
        true,
        "advisory unlock must report success",
      );
    } finally {
      clientA.release();
    }
  })();
  await started.opened;

  const { redis } = stubRedis();
  const absorbPromise = absorbCarryover(db, redis as never, userId, accountId, reconciliationId);
  let absorbSettled = false;
  void absorbPromise.then(
    () => {
      absorbSettled = true;
    },
    () => {
      absorbSettled = true;
    },
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(absorbSettled, false, "absorb should still be blocked on A's held advisory lock");

  release.release();
  await aTxPromise;

  const result = await absorbPromise;
  // Serial order A → absorb: A's opening=-50000 commits first, so absorb's
  // drift is computed against THAT value, not the pre-A one. ledgerDue =
  // -(-50000 + -100000) = 150000; drift = 250000-150000=100000;
  // opening' = -50000-100000 = -150000.
  assert.equal(result.dueDriftPaise, 0);
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0, "opening_balance_paise column is frozen at 0 under PR-G1");
  // Serial order A → absorb: A seeded opening -50000, then absorb updated it by -100000 drift.
  // nextOpeningPaise = -50000 − 100000 = -150000.
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  assert.equal((openingPostings.rows as Array<{ amount_paise: string }>).length, 1, "exactly one opening posting after serial A → absorb");
  assert.equal(Number((openingPostings.rows as Array<{ amount_paise: string }>)[0]!.amount_paise), -150000);
});

// NOTE on this pair of tests — a deviation from TASK.md P6a's literal wording,
// evidence-based and reported in the delegation iteration log:
//
// P6a's four-step recipe describes connection B "insert[ing] a qualifying
// pre-statement-date ledger transaction on the card" inside the hook. That
// literal construction was tried first and reproducibly DEADLOCKS: inserting
// a `transactions` row fires its FK-enforcement trigger against
// `accounts.id`, which takes an implicit `FOR KEY SHARE` row lock on the
// referenced account row — and that conflicts with the `FOR UPDATE` lock
// absorb's connection A already holds on that exact row (acquired in step 1
// of P1, before the hook ever runs). B's insert then blocks waiting on A's
// transaction id to finish, while A (the hook's caller) is simultaneously
// waiting on B's promise to resolve before it can proceed to commit — a
// real, unconditional deadlock, confirmed via `pg_locks`
// (`locktype: transactionid, mode: ShareLock, granted: false` on B, blocked
// on A's still-open xid) and reproduced twice.
//
// This test instead has B UPDATE a pre-existing pre-statement-date
// transaction's `amount_paise` AND both legs of its posting family.
// After PR-E, the aggregate `ledgerDuesAtDates` reads from `postings`,
// not `transactions` — so it is the POSTING update that creates the
// A rw-> B anti-dependency (A read the posting amounts B will overwrite).
// The `transactions` update is kept only so the legacy row stays
// consistent with its postings; it is NOT what triggers 40001. Both
// posting legs are updated together via the CASE expression to keep the
// family zero-sum (matching `buildOrdinaryPostings`'s balanced pair).
// The deadlock-avoidance property still holds: no FK column
// (`account_id`, `transaction_id`) appears in any SET list, so Postgres
// performs no FK re-check and takes no `FOR KEY SHARE` lock on the
// `accounts` row that connection A holds `FOR UPDATE`.
// `rebuildPostingsForTransaction` must NOT be used here: it deletes and
// re-inserts postings, and those INSERTs would perform FK checks and
// reintroduce the deadlock. Do not "simplify" by dropping the postings
// UPDATE — that silently makes these tests vacuous (no anti-dependency,
// no 40001, no retry), which is exactly the regression PR-E introduced
// and that this change repaired.
test("absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-05-20";
  const seed = await createTransaction(db, userId, { accountId, date: "2029-05-05", amountPaise: -100000 });
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 500000,
  });

  let hookCalls = 0;
  const hooks: AbsorbCarryoverHooks = {
    afterAggregate: async () => {
      hookCalls += 1;
      if (hookCalls > 1) return; // second attempt: inert, per the recipe's step 4
      // Connection B: its own serializable transaction. FIRST reads the
      // account row (the reverse edge — B reads what A will later write),
      // THEN updates the transaction's amount_paise AND both posting legs
      // (the postings update is the anti-dependency: A's earlier postings
      // aggregate read is now stale against B's overwrite) and commits.
      await db.transaction(
        async (txB) => {
          await txB
            .select()
            .from(accounts)
            .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
          await txB
            .update(transactions)
            .set({ amountPaise: -150000 })
            .where(eq(transactions.id, seed.id));
          const updatedPostings = await txB
            .update(postings)
            .set({ amountPaise: sql`(CASE WHEN ${postings.accountId} = ${accountId} THEN ${-150000} ELSE ${150000} END)::bigint` })
            .where(eq(postings.transactionId, seed.id))
            .returning();
          assert.equal(updatedPostings.length, 2, "exactly two posting rows updated (card leg + counter-leg), keeping the family zero-sum");
        },
        { isolationLevel: "serializable" },
      );
    },
  };

  const { redis } = stubRedis();
  const result = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId, hooks);

  assert.equal(hookCalls, 2, "the retry must have happened — the hook fires again on the second attempt");
  assert.equal(result.dueDriftPaise, 0);
  // On retry: fresh ledger has B's overwritten -150000 posting, so
  // ledgerDuePaise = 150000, drift = 500000 − 150000 = 350000,
  // nextOpeningPaise = 0 − 350000 = -350000 (no prior opening before the retry).
  // The stale first-attempt read (-100000) was never committed.
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0, "opening_balance_paise column is frozen at 0 under PR-G1");
  const openingPostings = await db.execute(sql`
    select p.amount_paise from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.is_opening = true and t.deleted_at is null
  `);
  assert.equal((openingPostings.rows as Array<{ amount_paise: string }>).length, 1, "exactly one opening posting after SSI retry on fresh ledger");
  assert.equal(Number((openingPostings.rows as Array<{ amount_paise: string }>)[0]!.amount_paise), -350000);
});

test("absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-06-20";
  const seed = await createTransaction(db, userId, { accountId, date: "2029-06-05", amountPaise: -100000 });
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 500000,
  });

  let hookCalls = 0;
  const hooks: AbsorbCarryoverHooks = {
    afterAggregate: async () => {
      hookCalls += 1;
      // Reproduce the identical cycle on every attempt, not just the first —
      // see the deviation note above the previous test for why this updates
      // a pre-existing row rather than inserting a new one.
      await db.transaction(
        async (txB) => {
          await txB
            .select()
            .from(accounts)
            .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
          const newAmount = -100000 - hookCalls * 1000;
          await txB
            .update(transactions)
            .set({ amountPaise: newAmount })
            .where(eq(transactions.id, seed.id));
          const updatedPostings = await txB
            .update(postings)
            .set({ amountPaise: sql`(CASE WHEN ${postings.accountId} = ${accountId} THEN ${newAmount} ELSE ${-newAmount} END)::bigint` })
            .where(eq(postings.transactionId, seed.id))
            .returning();
          assert.equal(updatedPostings.length, 2, "exactly two posting rows updated (card leg + counter-leg), keeping the family zero-sum");
        },
        { isolationLevel: "serializable" },
      );
    },
  };

  const { redis } = stubRedis();
  await assert.rejects(
    absorbCarryover(db, redis as never, userId, accountId, reconciliationId, hooks),
    (e: unknown) => {
      const pg = pgError(e);
      return pg !== null && pg.code === "40001";
    },
  );
  assert.equal(hookCalls, 2, "exactly two attempts: the initial call plus withSerializableRetry's single retry");

  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, 0, "no committed change from either failed attempt");
});
