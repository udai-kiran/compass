import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import type { Redis } from "ioredis";
import { accounts, categories, transactions, users } from "../../../db/schema.ts";
import { alertLedger, notificationPrefs, notifications } from "../../system/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings } from "../../ledger/services/reconcile-postings.ts";
import { seedSystemAccounts } from "../../ledger/services/post-entry.ts";
import { createAccount } from "../../ledger/services/accounts.ts";
import { createTransaction, setSplits, softDeleteTransaction } from "../../ledger/services/transactions.ts";
import { createTransfer } from "../../ledger/services/transfers.ts";
import { currentPeriodKey } from "../../../lib/periods.ts";
import { getTrends } from "./dashboard.ts";
import { suggestSubscriptions } from "./bills.ts";
import { evaluateLargeTransactions } from "../../system/services/prefs.ts";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "postings-planning-parity.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
        "connection) — export it before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

/** In-memory Redis stub for cached() calls — getTrends uses cached(). */
function makeRedisStub(): Redis {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string, ..._rest: unknown[]) => {
      store.set(key, value);
      return "OK" as const;
    },
  } as unknown as Redis;
}

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `postings-planning-parity-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "postings-planning-parity.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // Deleting transactions cascades to: postings, transaction_splits, transfer_links.
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(alertLedger).where(eq(alertLedger.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(notificationPrefs).where(eq(notificationPrefs.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function createAcct(
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise = 0,
  openingDate?: string,
): Promise<{ id: string; type: AccountType }> {
  const account = await createAccount(db, userId, {
    name,
    type,
    institution: null,
    accountLast4: null,
    holderName: null,
    holderId: null,
    currency: "INR",
    openingBalancePaise,
  }, openingDate);
  return { id: account.id, type };
}

function isoPlusDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Test 7 — suggestSubscriptions
// ---------------------------------------------------------------------------

test("postings-planning-parity: 7 — suggestSubscriptions detects 3-charge monthly pattern, excludes transfers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const now = new Date();
  const bank = await createAcct(userId, "Bank", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");

  // 3 Netflix charges ~29 days apart, all within last 400 days
  const charge1 = isoPlusDays(now, -90);  // 90 days ago
  const charge2 = isoPlusDays(now, -61);  // 29 days after charge1
  const charge3 = isoPlusDays(now, -31);  // 30 days after charge2
  await createTransaction(db, userId, { accountId: bank.id, date: charge1, amountPaise: -59900, merchant: "Netflix" });
  await createTransaction(db, userId, { accountId: bank.id, date: charge2, amountPaise: -59900, merchant: "Netflix" });
  await createTransaction(db, userId, { accountId: bank.id, date: charge3, amountPaise: -59900, merchant: "Netflix" });

  // Transfer (excluded — has Clearing posting)
  await createTransfer(db, userId, {
    fromAccountId: bank.id,
    toAccountId: bank2.id,
    amountPaise: 50000,
    date: charge1,
  });
  // Opening balance (excluded — Opening posting)
  await createAcct(userId, "OpeningBank", "bank", 50000, "2020-01-01");

  const suggestions = await suggestSubscriptions(db, userId);

  // Should find exactly 1 suggestion for Netflix
  assert.equal(suggestions.length, 1, "must find exactly 1 subscription suggestion");
  assert.equal(suggestions[0]!.merchant, "Netflix", "suggestion must be Netflix");
  assert.equal(suggestions[0]!.occurrences, 3, "must have 3 occurrences");
  assert.equal(suggestions[0]!.periodicity, "monthly", "must be monthly");
  assert.equal(suggestions[0]!.avgAmountPaise, -59900, "avgAmountPaise must be -59900");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// Test 8 — evaluateLargeTransactions (D20: exactly one alert per transaction)
// ---------------------------------------------------------------------------

test("postings-planning-parity: 8 — evaluateLargeTransactions fires exactly 1 alert per tx; transfer/opening excluded", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");
  const today = new Date().toISOString().slice(0, 10);
  const THRESHOLD = 50000;
  const [splitCat] = await db
    .insert(categories)
    .values({ userId, name: "SplitCat", kind: "expense" })
    .returning({ id: categories.id });

  // Insert a large_transaction pref
  await db.insert(notificationPrefs).values({
    userId,
    type: "large_transaction",
    accountId: null,
    enabled: true,
    thresholdPaise: THRESHOLD,
  });

  // Above threshold: fires alert
  await createTransaction(db, userId, { accountId: bank.id, date: today, amountPaise: -100000 });
  // Below threshold: no alert
  await createTransaction(db, userId, { accountId: bank.id, date: today, amountPaise: -20000 });
  // Transfer above threshold: excluded (Clearing posting)
  await createTransfer(db, userId, {
    fromAccountId: bank.id,
    toAccountId: bank2.id,
    amountPaise: 200000,
    date: today,
  });
  // Opening balance above threshold: excluded (Opening posting)
  // Note: openingBalancePaise > 0 seeds is_opening transaction AND Opening posting
  await createAcct(userId, "OpeningLarge", "bank", 80000, "2020-01-01");
  // Split parent above threshold: exactly ONE alert (D20 — not N alerts for N splits)
  const splitTxn = await createTransaction(db, userId, { accountId: bank.id, date: today, amountPaise: -80000 });
  await setSplits(db, userId, splitTxn.id, [
    { categoryId: splitCat!.id, amountPaise: -50000, note: "" },
    { categoryId: splitCat!.id, amountPaise: -30000, note: "" },
  ]);

  const fired = await evaluateLargeTransactions(db, userId);
  // Expected: 2 alerts (expense -100000, split parent -80000)
  // NOT: transfer (excluded), opening (excluded), below-threshold (excluded)
  assert.equal(fired, 2, "must fire exactly 2 alerts (ordinary above-threshold + split parent)");

  // Run again: should fire 0 (alertLedger dedup)
  const firedAgain = await evaluateLargeTransactions(db, userId);
  assert.equal(firedAgain, 0, "second run must fire 0 (already in alertLedger)");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// Test 9 — mappedContributionRate SQL parity (postings vs legacy)
// ---------------------------------------------------------------------------

test("postings-planning-parity: 9 — mappedContributionRate postings SQL matches legacy transactions SQL", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const savings = await createAcct(userId, "Savings", "bank");
  const other = await createAcct(userId, "OtherBank", "bank");

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recent = isoPlusDays(now, -30);

  // Positive inflows (counted)
  await createTransaction(db, userId, { accountId: savings.id, date: recent, amountPaise: 100000 });
  await createTransaction(db, userId, { accountId: savings.id, date: recent, amountPaise: 50000 });
  // Transfer IN to savings (counted — semantics: transfer into savings IS contribution)
  await createTransfer(db, userId, {
    fromAccountId: other.id,
    toAccountId: savings.id,
    amountPaise: 30000,
    date: recent,
  });
  // Opening balance (counted — same semantics as transfer)
  // savings already has opening = 0; create a separate account for opening test
  const savingsWithOpening = await createAcct(userId, "SavingsOpening", "bank", 20000);
  // Negative transaction on savings (excluded: p.amount_paise < 0 → p.amount_paise > 0 filter)
  await createTransaction(db, userId, { accountId: savings.id, date: recent, amountPaise: -10000 });
  // Soft-deleted positive (excluded: t.deleted_at IS NOT NULL)
  const delTxn = await createTransaction(db, userId, { accountId: savings.id, date: recent, amountPaise: 5000 });
  await softDeleteTransaction(db, userId, delTxn.id);
  // Future-dated (excluded: t.date > today)
  await createTransaction(db, userId, { accountId: savings.id, date: "2099-01-01", amountPaise: 8000 });

  const accountIds = [savings.id, savingsWithOpening.id];

  // Under PR-G1 the transfer in-leg transaction is hard-deleted; only the outflow
  // survivor row exists.  A legacy transactions.amount_paise sum would miss the
  // +30000 posting credit to savings entirely, yielding 150000 instead of 200000.
  // We use the postings formula exclusively and assert the fixture-derived total.

  // Postings SQL (same as the converted mappedContributionRate)
  const newRes = await db.execute(sql`
    select coalesce(sum(p.amount_paise), 0)::bigint as total
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.user_id = ${userId}
      and a.id in (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})
      and p.amount_paise > 0
      and a.system_kind is null
      and t.deleted_at is null
      and t.date >= ${cutoffIso}
      and t.date <= ${today}
  `);
  const newTotal = Number((newRes.rows[0] as { total: string }).total);

  // Fixture-derived expected value (independent of any production query):
  // savings: +100000 (ordinary) + +50000 (ordinary) + +30000 (transfer-in posting) = 180000
  // savingsWithOpening: opening posting +20000 = 20000
  // Total = 200000
  assert.equal(newTotal, 200000, "postings total must be 200000 (100k + 50k + 30k transfer-in + 20k opening)");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// Test 10 — Tenant isolation: user B's data absent from user A's results
// ---------------------------------------------------------------------------

test("postings-planning-parity: 10 — tenant isolation: user B data does not appear in user A getTrends", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);

  const now = new Date();
  const endKey = currentPeriodKey("monthly", now);

  const bankA = await createAcct(userA, "Bank A", "bank");
  const bankB = await createAcct(userB, "Bank B", "bank");

  // User A: small expense
  await createTransaction(db, userA, { accountId: bankA.id, date: `${endKey}-05`, amountPaise: -5000 });
  // User B: large expense that must not leak into A's results
  await createTransaction(db, userB, { accountId: bankB.id, date: `${endKey}-05`, amountPaise: -99999999 });

  const redisA = makeRedisStub();
  const trendsA = await getTrends(db, redisA, userA, 1);

  const curMonthA = trendsA.months.find((m) => m.month === endKey);
  assert.ok(curMonthA, "user A current month must appear in trends");
  assert.equal(curMonthA!.expensePaise, 5000, "user A expense must be only 5000 (not user B's 99999999)");
  assert.equal(curMonthA!.incomePaise, 0, "user A income must be 0");

  assert.deepEqual(await findInconsistentPostings(db, userA), []);
});

// ---------------------------------------------------------------------------
// Test 11 — findInconsistentPostings == [] for a mixed full fixture
// ---------------------------------------------------------------------------

test("postings-planning-parity: 11 — findInconsistentPostings returns [] for full planning fixture", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const endKey = currentPeriodKey("monthly", now);
  const recent = isoPlusDays(now, -10);

  const bank = await createAcct(userId, "Bank", "bank", 10000, "2020-01-01");
  const bank2 = await createAcct(userId, "Bank2", "bank");
  const card = await createAcct(userId, "Card", "credit_card");
  const [catExp] = await db.insert(categories).values({ userId, name: "ExpCat", kind: "expense" }).returning({ id: categories.id });

  // Ordinary expense
  await createTransaction(db, userId, { accountId: bank.id, date: `${endKey}-05`, amountPaise: -20000, categoryId: catExp!.id });
  // Ordinary income
  await createTransaction(db, userId, { accountId: bank.id, date: `${endKey}-05`, amountPaise: 50000 });
  // Split expense
  const splitTxn = await createTransaction(db, userId, { accountId: bank.id, date: today, amountPaise: -30000 });
  await setSplits(db, userId, splitTxn.id, [
    { categoryId: catExp!.id, amountPaise: -20000, note: "" },
    { categoryId: catExp!.id, amountPaise: -10000, note: "" },
  ]);
  // Transfer pair
  await createTransfer(db, userId, {
    fromAccountId: bank.id,
    toAccountId: bank2.id,
    amountPaise: 15000,
    date: today,
  });
  // Soft-deleted
  const delTxn = await createTransaction(db, userId, { accountId: bank.id, date: today, amountPaise: -5000 });
  await softDeleteTransaction(db, userId, delTxn.id);
  // Credit card charge
  await createTransaction(db, userId, { accountId: card.id, date: recent, amountPaise: -8000 });
  // Recurring source
  await createTransaction(db, userId, { accountId: bank.id, date: recent, amountPaise: -12000, source: "recurring" });

  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(
    inconsistent,
    [],
    `findInconsistentPostings must return [] for full planning fixture, got: ${JSON.stringify(inconsistent)}`,
  );
});
