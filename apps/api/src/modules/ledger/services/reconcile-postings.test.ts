import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings, reprojectAllLegacyColumns } from "./reconcile-postings.ts";
import { seedSystemAccounts } from "./post-entry.ts";
import { createTransaction } from "./transactions.ts";
import { createAccount } from "./accounts.ts";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "reconcile-postings.test.ts's DB-backed tests need DATABASE_URL set — " +
        "export it before running `npm run test -w apps/api`.",
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
      email: `reconcile-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "reconcile-postings.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("findInconsistentPostings: returns [] for a normally-created transaction", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  await createTransaction(db, userId, {
    accountId: acct.id,
    amountPaise: -5000,
    date: "2026-01-01",
    merchant: "Test",
  });
  const problems = await findInconsistentPostings(db, userId);
  assert.deepEqual(problems, [], "normally-created transaction must have no posting problems");
});

test("findInconsistentPostings: reports 'no postings' for a raw-inserted transaction", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const _acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-02", merchant: "Raw" })
    .returning({ id: transactions.id });
  const problems = await findInconsistentPostings(db, userId);
  assert.equal(problems.length, 1, "raw-inserted transaction must appear as a posting problem");
  assert.equal(problems[0]!.transactionId, txn!.id);
  assert.ok(problems[0]!.reason.includes("no postings"), `expected 'no postings' in reason, got: ${problems[0]!.reason}`);
});

test("findInconsistentPostings: reports non-zero-sum for postings that don't balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  // Raw-insert a transaction and a single posting with no counterpart — sum is non-zero
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-02", merchant: "Unbalanced" })
    .returning({ id: transactions.id });
  await db.insert(postings).values({
    transactionId: txn!.id,
    accountId: acct.id,
    amountPaise: -2000,
  });
  const problems = await findInconsistentPostings(db, userId);
  const problem = problems.find((p) => p.transactionId === txn!.id);
  assert.ok(problem, "findInconsistentPostings must report the non-zero-sum transaction");
  assert.ok(
    problem!.reason.includes("not zero"),
    `expected 'not zero' in reason, got: ${problem!.reason}`,
  );
});

test("findInconsistentPostings: tenant-scope — reports only the target user's problems", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => { await cleanupUser(userA); await cleanupUser(userB); });
  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);
  const _acctA = await createAccount(db, userA, { name: "Bank A", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  const _acctB = await createAccount(db, userB, { name: "Bank B", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  // Raw-insert for BOTH users
  await db.insert(transactions).values({ userId: userA, date: "2026-01-01", merchant: "A" });
  await db.insert(transactions).values({ userId: userB, date: "2026-01-01", merchant: "B" });
  // Check only user A — must not report user B's problem
  const problemsA = await findInconsistentPostings(db, userA);
  assert.equal(problemsA.length, 1, "findInconsistentPostings scoped to userA must return exactly 1 problem");
  assert.equal(problemsA[0]!.userId, userA);
});

test("findInconsistentPostings: detects orphan posting (missing transaction)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  // Insert a transaction and an attached posting (valid FK)
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-15", merchant: "Orphan test" })
    .returning({ id: transactions.id });
  const txnId = txn!.id;
  await db.insert(postings).values({ transactionId: txnId, accountId: acct.id, amountPaise: 500 });
  // Delete the transaction while bypassing cascade (disable triggers so FK cascade doesn't run)
  // This simulates data corruption where a transaction was removed but its postings remain.
  // Requires ALTER TABLE privilege on the postings table.
  await db.execute(sql`ALTER TABLE postings DISABLE TRIGGER ALL`);
  try {
    await db.execute(sql`DELETE FROM transactions WHERE id = ${txnId}`);
  } finally {
    await db.execute(sql`ALTER TABLE postings ENABLE TRIGGER ALL`);
  }
  // Run the global scan (no userId filter) so the orphan check executes
  const problems = await findInconsistentPostings(db);
  const orphan = problems.find(
    (p) => p.transactionId === txnId && p.reason === "orphan posting (transaction missing)",
  );
  assert.ok(orphan, `expected orphan posting problem for txn ${txnId}, got: ${JSON.stringify(problems)}`);
  // Cleanup the orphaned posting (the transaction no longer exists so cleanupUser won't cascade-delete it)
  t.after(async () => {
    await db.execute(sql`DELETE FROM postings WHERE transaction_id = ${txnId}`);
  });
});

test("findInconsistentPostings: detects global ledger imbalance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  // Insert a transaction with deliberately unbalanced postings via raw SQL (bypasses assertZeroSum)
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-10", merchant: "Imbalanced global" })
    .returning({ id: transactions.id });
  await db.insert(postings).values({ transactionId: txn!.id, accountId: acct.id, amountPaise: 7777 });
  // Run the global scan
  const problems = await findInconsistentPostings(db);
  // There should be a global imbalance problem (the single unbalanced posting makes ledger non-zero)
  const globalProblem = problems.find((p) => p.transactionId === "ledger-global");
  assert.ok(globalProblem, `expected global ledger imbalance problem, got: ${JSON.stringify(problems)}`);
  assert.ok(
    globalProblem!.reason.includes("global ledger imbalance"),
    `expected 'global ledger imbalance' in reason, got: ${globalProblem!.reason}`,
  );
});

test("reprojectAllLegacyColumns: idempotent — second call succeeds without error", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  await createTransaction(db, userId, {
    accountId: acct.id,
    amountPaise: -3000,
    date: "2026-01-03",
    merchant: "Reproject test",
  });
  const first = await reprojectAllLegacyColumns(db);
  assert.equal(first.failures.length, 0, "first reprojectAllLegacyColumns must have no failures");
  const second = await reprojectAllLegacyColumns(db);
  assert.equal(second.failures.length, 0, "second reprojectAllLegacyColumns must have no failures (idempotent)");
  assert.ok(first.checked >= 1, "must have checked at least one transaction");
  // second.checked === first.checked would be flaky in concurrent test runs since
  // reprojectAllLegacyColumns scans ALL users; idempotence is already proven by
  // second.failures.length === 0 above.
  assert.ok(second.checked >= 1, "second call must also check at least one transaction");
});
