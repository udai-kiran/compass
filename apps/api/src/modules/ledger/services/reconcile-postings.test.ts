import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings } from "./reconcile-postings.ts";
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
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
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
  const _acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
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
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
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
  const _acctA = await createAccount(db, userA, { name: "Bank A", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
  const _acctB = await createAccount(db, userB, { name: "Bank B", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
  // Raw-insert for BOTH users
  await db.insert(transactions).values({ userId: userA, date: "2026-01-01", merchant: "A" });
  await db.insert(transactions).values({ userId: userB, date: "2026-01-01", merchant: "B" });
  // Check only user A — must not report user B's problem
  const problemsA = await findInconsistentPostings(db, userA);
  assert.equal(problemsA.length, 1, "findInconsistentPostings scoped to userA must return exactly 1 problem");
  assert.equal(problemsA[0]!.userId, userA);
});

test("findInconsistentPostings: detects orphan posting (missing transaction)", async (t) => {
  // Creating an orphan posting requires suppressing the FK cascade via
  // `SET LOCAL session_replication_role`, which PostgreSQL restricts to superusers
  // (or a role granted SET on it). CI's `compass` role in the postgres:18 container
  // is superuser, so coverage holds there; on a least-privileged local app role we
  // skip rather than fail with a permission error that looks like a real defect.
  const suRows = await db.execute(sql`select current_setting('is_superuser') as is_superuser`);
  if (String((suRows.rows[0] as { is_superuser: string }).is_superuser) !== "on") {
    t.skip("requires a superuser DB role (session_replication_role) to forge an orphan posting");
    return;
  }
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
  // Insert a transaction and an attached posting (valid FK)
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date: "2026-01-15", merchant: "Orphan test" })
    .returning({ id: transactions.id });
  const txnId = txn!.id;
  await db.insert(postings).values({ transactionId: txnId, accountId: acct.id, amountPaise: 500 });
  // Delete the transaction while suppressing the ON DELETE CASCADE that would
  // otherwise remove its posting, so an orphan posting exists for the scan to find.
  //
  // `SET LOCAL session_replication_role = replica` suppresses internal RI/cascade
  // triggers for THIS TRANSACTION's session only, and Postgres reverts it at
  // commit. Do NOT use `ALTER TABLE ... DISABLE TRIGGER ALL`: that is cluster-wide
  // and persistent, so — because `node --test` runs test files concurrently against
  // one shared database — it would strip the cascade from every OTHER test deleting
  // a transaction at that moment, orphaning their postings and breaking their
  // cleanup with a postings_account_id_accounts_id_fk violation.
  //
  // Requires a superuser role (true for the CI Postgres container).
  await db.transaction(async (trx) => {
    await trx.execute(sql`SET LOCAL session_replication_role = replica`);
    await trx.execute(sql`DELETE FROM transactions WHERE id = ${txnId}`);
  });
  // Run the global scan (no userId filter) so the orphan check executes.
  // The orphan posting MUST be deleted before any after-hook runs: its transaction
  // is gone, so nothing cascades it away, and the leftover row would both block
  // this test's `cleanupUser` (`delete from accounts` → FK violation) and poison
  // subsequent runs against the same database. A `t.after` is NOT sufficient —
  // node:test runs after-hooks in registration order, and `cleanupUser` is
  // registered at the top of this test, so it would run first.
  try {
    const problems = await findInconsistentPostings(db);
    const orphan = problems.find(
      (p) => p.transactionId === txnId && p.reason === "orphan posting (transaction missing)",
    );
    assert.ok(orphan, `expected orphan posting problem for txn ${txnId}, got: ${JSON.stringify(problems)}`);
  } finally {
    await db.execute(sql`DELETE FROM postings WHERE transaction_id = ${txnId}`);
  }
});

test("findInconsistentPostings: detects global ledger imbalance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, holderId: null, currency: "INR", openingBalancePaise: 0 });
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
