import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb } from "../db/index.ts";
import { createPool } from "../infra/db.ts";
import {
  accounts,
  cardDetails,
  emailIngestions,
  statementReconciliations,
  transactions,
  users,
} from "../db/schema.ts";
import { HttpError, pgError } from "../lib/errors.ts";
import { listAccounts } from "./accounts.ts";
import {
  absorbCarryover,
  activityWindow,
  cardCycle,
  dueDrift,
  driftPresentation,
  getCardActivity,
  isBilledIn,
  lastOccurrence,
  listReconciliations,
  nextOccurrence,
  recomputeReconciliation,
  splitByCycle,
  summarizeStatementLines,
  type AbsorbCarryoverHooks,
} from "./cards.ts";

/** Statement-generation lag in cards.ts — a cycle is only billed this long after it closes. */
const GEN_LAG_DAYS = 4;

/** An ISO date shifted by whole days — local to the tests. */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("cardCycle: a cycle starts on the previous close day and ends the day before the next", () => {
  assert.deepEqual(cardCycle("2026-07-26", 20), {
    start: "2026-06-20",
    end: "2026-07-19",
    close: "2026-07-20",
  });
});

test("isBilledIn: a charge dated on the cycle's first day is billed by that statement", () => {
  const cycle = cardCycle("2026-07-26", 20);
  // This is the regression — HDFC's 20 Jul statement bills 20 Jun, and treating
  // the window as exclusive dropped ₹34,134 + ₹529 of real charges.
  assert.strictEqual(isBilledIn("2026-06-20", cycle), true);
});

test("isBilledIn: a charge dated on the close day bills on the next statement, not this one", () => {
  const cycle = cardCycle("2026-07-26", 20);
  assert.strictEqual(isBilledIn("2026-07-20", cycle), false);
  assert.strictEqual(isBilledIn("2026-07-19", cycle), true);
});

test("cardCycle: consecutive cycles bill every date exactly once", () => {
  // Exactly one statement bills each date: no overlap and no gap. Sweep several
  // cycle days and a window of dates that crosses both a month and a year end.
  for (const cycleDay of [1, 5, 20, 28]) {
    for (const ref of ["2026-07-26", "2026-01-10", "2026-03-05"]) {
      const cur = cardCycle(ref, cycleDay);
      // Ask from just past the generation lag, so the cycle closing on cur.start
      // has actually been issued: asking on cur.start - 1 would (correctly) report
      // the cycle before it, since that statement doesn't exist yet.
      const prev = cardCycle(shiftIso(cur.start, GEN_LAG_DAYS), cycleDay);
      assert.strictEqual(prev.close, cur.start, `${ref}/${cycleDay}: cycles must abut`);
      for (const d of [prev.start, prev.end, cur.start, cur.end]) {
        const billed = Number(isBilledIn(d, prev)) + Number(isBilledIn(d, cur));
        assert.strictEqual(billed, 1, `${d} (ref ${ref}, day ${cycleDay}) billed ${billed} times`);
      }
    }
  }
});

test("cardCycle: a cycle that closed only days ago is not billed yet", () => {
  assert.deepEqual(cardCycle("2026-07-22", 20), {
    start: "2026-05-20",
    end: "2026-06-19",
    close: "2026-06-20",
  });
});

test("cardCycle: crosses a year boundary", () => {
  assert.deepEqual(cardCycle("2026-01-10", 1), {
    start: "2025-12-01",
    end: "2025-12-31",
    close: "2026-01-01",
  });
});

test("lastOccurrence / nextOccurrence: the close day itself is the boundary", () => {
  assert.strictEqual(lastOccurrence("2026-07-20", 20), "2026-07-20");
  assert.strictEqual(nextOccurrence("2026-07-20", 20), "2026-08-20");
  assert.strictEqual(nextOccurrence("2026-07-20", 7), "2026-08-07");
});

test("summarizeStatementLines: a line tied to a live ledger transaction counts as cleared", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 52900, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 3413400, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 3466300 }, lines);
  assert.strictEqual(stats.matchedCount, 1);
  assert.strictEqual(stats.unmatchedCount, 1);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 3466300);
  assert.strictEqual(stats.matchedPaise, 52900);
  assert.deepEqual(stats.matchedTxnIds, ["t1"]);
});

test("summarizeStatementLines: every line linked leaves nothing to review", () => {
  // This is the state card 2862 should reach once its accepted lines are
  // re-checked — the extractor stored 0/16 because it matched against an empty ledger.
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 200000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 3, lineDebitPaise: 600000 }, lines);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 600000);
  assert.strictEqual(stats.matchedPaise, stats.lineDebitPaise);
});

test("summarizeStatementLines: a cleared refund does not shrink the spend delta", () => {
  const lines = [
    { direction: "credit" as const, amountPaise: 4559100, ledgerTxnId: "t9" },
    { direction: "debit" as const, amountPaise: 519900, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 519900 }, lines);
  assert.strictEqual(stats.lineDebitPaise, 519900);
  assert.strictEqual(stats.matchedCount, 1);
  // The credit must NOT count as cleared spend.
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: the issuer's own totals survive a recompute that sees no lines", () => {
  // Card 3623's live state: the extractor skipped both lines as dedupe hits, so
  // recounting from surviving rows would wipe what the issuer actually billed.
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 14900 }, []);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 14900);
  assert.strictEqual(stats.matchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 2);
  assert.deepEqual(stats.matchedTxnIds, []);
});

test("summarizeStatementLines: a partly-deduplicated statement keeps the issuer's line count", () => {
  // Card 0515's live shape: the issuer billed 4 lines, but only 3 survived (the
  // fourth was never stored because its spend was already captured from an alert).
  // It reads as unmatched — conservative, never a false all-clear.
  const lines = [
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 417115, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 4, lineDebitPaise: 1173657 }, lines);
  assert.strictEqual(stats.lineCount, 4);
  assert.strictEqual(stats.lineDebitPaise, 1173657);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: more links than the issuer listed never yields a negative backlog", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t2" },
  ];
  const stats = summarizeStatementLines({ lineCount: 1, lineDebitPaise: 100000 }, lines);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedCount, 2);
});

test("activityWindow: the listed window starts on the cycle's first billed day", () => {
  const cycle = cardCycle("2026-07-26", 20);
  const w = activityWindow(cycle, "2026-07-26");
  // Inclusive: the SQL that loads rows must not exclude the start day, or the
  // billed split never sees the charges dated on it.
  assert.strictEqual(w.fromInclusive, "2026-06-20");
  assert.strictEqual(w.fromInclusive, cycle.start);
  assert.strictEqual(w.billedBefore, "2026-07-20");
  assert.strictEqual(w.billedBefore, cycle.close);
});

test("activityWindow: with no cycle configured, today's spend still counts as billed", () => {
  const w = activityWindow(null, "2026-07-26");
  assert.strictEqual(w.billedBefore, "2026-07-27");
  assert.strictEqual(w.fromInclusive, "2026-06-11");
});

test("splitByCycle: every row bills exactly once, and the start day bills now", () => {
  const cycle = cardCycle("2026-07-26", 20);
  const rows = [
    { date: "2026-06-19" }, // previous cycle
    { date: "2026-06-20" }, // start day — the regression
    { date: "2026-07-19" }, // last billed day
    { date: "2026-07-20" }, // close day — bills next cycle
    { date: "2026-07-25" },
  ];
  const { billed, unbilled } = splitByCycle(rows, cycle);
  assert.deepEqual(
    billed.map((r) => r.date),
    ["2026-06-20", "2026-07-19"],
  );
  assert.deepEqual(
    unbilled.map((r) => r.date),
    ["2026-06-19", "2026-07-20", "2026-07-25"],
  );
  // No row is lost or double-counted.
  assert.strictEqual(billed.length + unbilled.length, rows.length);
});

test("splitByCycle: with no cycle nothing is billed yet", () => {
  const rows = [{ date: "2026-07-01" }, { date: "2026-07-26" }];
  const { billed, unbilled } = splitByCycle(rows, null);
  assert.deepEqual(billed, []);
  assert.strictEqual(unbilled.length, 2);
});

// ---------- dueDrift / driftPresentation (P1, tasks/cc-recon-01-statement-drift) ----------

test("dueDrift: null unless both totalDuePaise and ledgerDuePaise are known", () => {
  assert.strictEqual(dueDrift(null, null), null);
  assert.strictEqual(dueDrift(null, 100000), null);
  assert.strictEqual(dueDrift(100000, null), null);
});

test("dueDrift: totalDue − ledgerDue, positive/negative/zero", () => {
  assert.strictEqual(dueDrift(100000, 40000), 60000);
  assert.strictEqual(dueDrift(40000, 100000), -60000);
  assert.strictEqual(dueDrift(100000, 100000), 0);
});

test("driftPresentation: null drift or null ledgerDue → none", () => {
  assert.deepEqual(driftPresentation(null, 100000), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
  assert.deepEqual(driftPresentation(60000, null), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: positive drift with a nonnegative ledger due is a shortfall — carries the hint, suppresses the badge", () => {
  assert.deepEqual(driftPresentation(60000, 40000), {
    kind: "shortfall",
    carryForwardHint: true,
    suppressCleared: true,
  });
});

test("driftPresentation: a negative ledger due is `credit`, evaluated BEFORE the drift sign — never a shortfall", () => {
  // totalDue 0, ledgerDue −₹1,000 → dueDrift is +100000 (a plain subtraction would
  // call this a shortfall), but the ledger holds a credit balance, not a gap.
  assert.deepEqual(driftPresentation(100000, -100000), {
    kind: "credit",
    carryForwardHint: false,
    suppressCleared: false,
  });
  // Even a "negative" drift alongside a negative ledger due stays `credit`.
  assert.deepEqual(driftPresentation(-30000, -100000), {
    kind: "credit",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: negative drift with a nonnegative ledger due is a surplus — no hint, badge kept", () => {
  assert.deepEqual(driftPresentation(-60000, 40000), {
    kind: "surplus",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: zero drift is none", () => {
  assert.deepEqual(driftPresentation(0, 40000), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

// ---------- DB-backed: listReconciliations / recomputeReconciliation ledger-due
// enrichment (P2/P3, tasks/cc-recon-01-statement-drift) ----------
//
// Real Postgres, following recurring.test.ts's harness: a throwaway user (and
// its accounts/transactions/statements) per test, cleaned up via t.after().

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "cards.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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
      displayName: "cards.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createCardAccount(userId: string, openingBalancePaise = 0): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: "Test card", type: "credit_card", openingBalancePaise })
    .returning({ id: accounts.id });
  return a!.id;
}

async function createTxn(
  userId: string,
  accountId: string,
  date: string,
  amountPaise: number,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  await db.insert(transactions).values({
    userId,
    accountId,
    date,
    amountPaise,
    deletedAt: opts.deleted ? new Date() : null,
  });
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
  // (review-5.md: cards.ts previously checked only the raw `sum`).
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
  assert.equal(row!.openingBalancePaise, -4559125);

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
  assert.equal(row!.openingBalancePaise, -800000); // -500000 - 300000
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
  // ledgerDue(before) = -(0 + -100000) = 100000; drift = 300000-100000=200000
  assert.equal(row!.openingBalancePaise, -200000);
});

test("absorbCarryover: listAccounts reflects the new opening balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-02-20";
  await createTxn(userId, accountId, "2029-02-05", -100000);
  const reconciliationId = await createReconciliation(userId, accountId, {
    statementDate: close,
    totalDuePaise: 300000,
  });

  const { redis } = stubRedis();
  await absorbCarryover(db, redis as never, userId, accountId, reconciliationId);

  const list = await listAccounts(db, userId);
  const found = list.find((a) => a.id === accountId)!;
  assert.equal(found.openingBalancePaise, -200000);
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

test("absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order", async (t) => {
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

  // Connection A: locks the account row the same way updateAccount does
  // before its own opening-balance edit, holds it open, then commits a
  // change — while a concurrent absorb is blocked waiting for that same lock.
  const aTxPromise = db.transaction(async (tx) => {
    await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .for("update");
    started.release();
    await release.opened;
    await tx
      .update(accounts)
      .set({ openingBalancePaise: -50000 })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  });
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
  assert.equal(absorbSettled, false, "absorb should still be blocked on A's held account-row lock");

  release.release();
  await aTxPromise;

  const result = await absorbPromise;
  // Serial order A → absorb: A's opening=-50000 commits first, so absorb's
  // drift is computed against THAT value, not the pre-A one. ledgerDue =
  // -(-50000 + -100000) = 150000; drift = 250000-150000=100000;
  // opening' = -50000-100000 = -150000.
  assert.equal(result.dueDriftPaise, 0);
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, -150000);
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
// transaction's `amount_paise` (never touching `account_id`, so no FK
// re-check and no lock on the `accounts` row is taken). This still
// constructs the same two-edge cycle the recipe calls for: A's earlier
// ledger aggregate read the row's OLD amount (A rw-> B, since B later
// overwrites what A read), and B reads the account row A will write (B rw->
// A, the reverse edge) before committing — the same dependency shape, via a
// write absorb's own aggregate query is equally blind to until it re-reads.
test("absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-05-20";
  const [seed] = await db
    .insert(transactions)
    .values({ userId, accountId, date: "2029-05-05", amountPaise: -100000 })
    .returning({ id: transactions.id });
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
      // THEN overwrites the pre-existing pre-statement-date ledger row's
      // amount (the write A's earlier aggregate read is now stale against)
      // and commits.
      await db.transaction(
        async (txB) => {
          await txB
            .select()
            .from(accounts)
            .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
          await txB
            .update(transactions)
            .set({ amountPaise: -150000 })
            .where(eq(transactions.id, seed!.id));
        },
        { isolationLevel: "serializable" },
      );
    },
  };

  const { redis } = stubRedis();
  const result = await absorbCarryover(db, redis as never, userId, accountId, reconciliationId, hooks);

  assert.equal(hookCalls, 2, "the retry must have happened — the hook fires again on the second attempt");
  assert.equal(result.dueDriftPaise, 0);
  // opening' = −totalDue − Σ(post-conflict ledger before statement_date), from
  // the FRESH state (B's overwritten −150000), never the stale aggregate
  // absorb's first attempt read (−100000).
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  assert.equal(row!.openingBalancePaise, -350000); // -500000 - -150000
});

test("absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId, 0);
  const close = "2029-06-20";
  const [seed] = await db
    .insert(transactions)
    .values({ userId, accountId, date: "2029-06-05", amountPaise: -100000 })
    .returning({ id: transactions.id });
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
          await txB
            .update(transactions)
            .set({ amountPaise: -100000 - hookCalls * 1000 })
            .where(eq(transactions.id, seed!.id));
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
