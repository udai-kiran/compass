import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { reconcileUserPostings, findInconsistentPostings } from "./reconcile-postings.ts";
import { seedSystemAccounts } from "./post-entry.ts";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "reconcile-postings.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
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
  // Deleting transactions cascades to: postings, transaction_splits, transfer_links.
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("idempotency: second reconcile has repaired=0", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // reconcileUserPostings seeds system accounts internally, but calling it
  // explicitly here is harmless (idempotent) and documents the intent.
  await seedSystemAccounts(db, userId);

  const [account] = await db
    .insert(accounts)
    .values({ userId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });

  await db.insert(transactions).values({
    userId,
    accountId: account!.id,
    date: "2026-01-01",
    amountPaise: -5000,
    merchant: "Cafe",
  });

  const first = await reconcileUserPostings(db, userId);
  assert.equal(first.failures.length, 0, "first reconcile must have no failures");
  assert.ok(first.repaired > 0, `first reconcile must repair at least one txn, got ${first.repaired}`);

  const second = await reconcileUserPostings(db, userId);
  assert.equal(second.failures.length, 0, "second reconcile must have no failures");
  assert.equal(second.repaired, 0, "second reconcile must have repaired=0 (idempotent)");
});

test("soft-deleted txns receive postings", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await seedSystemAccounts(db, userId);

  const [account] = await db
    .insert(accounts)
    .values({ userId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });

  // Insert a soft-deleted transaction (deletedAt set).
  await db.insert(transactions).values({
    userId,
    accountId: account!.id,
    date: "2026-01-02",
    amountPaise: -7000,
    merchant: "Old expense",
    deletedAt: new Date(),
  });

  const result = await reconcileUserPostings(db, userId);
  assert.equal(result.failures.length, 0, "reconcile must have no failures");
  assert.ok(result.repaired > 0, "soft-deleted txn must receive postings on first reconcile");

  // After reconcile, no inconsistencies must remain (including for the soft-deleted row).
  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(inconsistent, [], "findInconsistentPostings must return [] after reconcile");
});

test("tenant-scope: reconcile user A does not touch user B", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });

  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);

  const [accA] = await db
    .insert(accounts)
    .values({ userId: userA, name: "Bank A", type: "bank" })
    .returning({ id: accounts.id });
  const [accB] = await db
    .insert(accounts)
    .values({ userId: userB, name: "Bank B", type: "bank" })
    .returning({ id: accounts.id });

  await db.insert(transactions).values({
    userId: userA,
    accountId: accA!.id,
    date: "2026-01-01",
    amountPaise: -1000,
    merchant: "A expense",
  });
  await db.insert(transactions).values({
    userId: userB,
    accountId: accB!.id,
    date: "2026-01-01",
    amountPaise: -2000,
    merchant: "B expense",
  });

  // Reconcile only user A — user B's postings must remain empty.
  const result = await reconcileUserPostings(db, userA);
  assert.equal(result.failures.length, 0, "reconcile of user A must have no failures");

  const [bPostingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(eq(transactions.userId, userB));
  assert.equal(
    Number(bPostingCount!.count),
    0,
    "user B must have no postings after reconciling only user A",
  );
});

test("duplicate/extra posting pruned", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await seedSystemAccounts(db, userId);

  const [account] = await db
    .insert(accounts)
    .values({ userId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });

  const [txn] = await db
    .insert(transactions)
    .values({
      userId,
      accountId: account!.id,
      date: "2026-01-03",
      amountPaise: -3000,
      merchant: "Coffee",
    })
    .returning({ id: transactions.id });

  // First reconcile: generates the correct 2-posting set.
  const first = await reconcileUserPostings(db, userId);
  assert.equal(first.failures.length, 0, "first reconcile must have no failures");
  assert.ok(first.repaired > 0, "first reconcile must generate postings");

  // Manually inject one extra (rogue) posting — breaks the stored multiset.
  await db.insert(postings).values({
    transactionId: txn!.id,
    accountId: account!.id,
    amountPaise: 999,
    categoryId: null,
    necessity: null,
    note: "rogue posting",
  });

  // Second reconcile: stored ≠ computed → replacePostings → repaired=1.
  const second = await reconcileUserPostings(db, userId);
  assert.equal(second.failures.length, 0, "second reconcile must have no failures");
  assert.equal(second.repaired, 1, "second reconcile must report repaired=1 (extra posting pruned)");

  // After the second reconcile, no inconsistencies must remain.
  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(inconsistent, [], "findInconsistentPostings must return [] after pruning extra posting");
});

test("NB1: failed shape does not inflate repaired", async (t) => {
  // NOTE: This test validates that a per-row failure (thrown during draft computation
  // or replacePostings) does not inflate `repaired`. It cannot exercise the narrower
  // scenario where replacePostings succeeds but the transaction commit itself rejects
  // (which would require DB-level commit mocking). The code fix (returning didRepair
  // from the tx callback, incrementing only after await resolves) is proven correct by
  // inspection; this test guards the general property.

  // DEVIATION NOTE: The brief asks for a split-sum mismatch to trigger PostingShapeError.
  // However, the schema has a deferred constraint trigger (check_split_sum) that prevents
  // committing splits whose sum does not match the transaction amount — even non-superusers
  // cannot bypass it. As a result, no split-sum mismatch can be created in the DB.
  //
  // This test exercises the SAME INVARIANT ("failures don't inflate repaired") via a
  // different mechanism: a category's userId is temporarily re-assigned to a second user so
  // that the second reconcile's replacePostings call fails with HttpError(404) from
  // assertOwnedCategory. The per-row transaction rolls back, the transaction appears in
  // failures, and repaired stays 0 — identical behavior to the PostingShapeError case.

  const userId = await createUser();
  const otherUserId = await createUser(); // used as the "fake owner" for the category
  let catId: string | null = null;
  t.after(async () => {
    // Restore category ownership before cleanup so cleanupUser(userId) can delete it.
    if (catId) {
      await db.update(categories).set({ userId }).where(eq(categories.id, catId));
    }
    await cleanupUser(userId);
    await cleanupUser(otherUserId);
  });

  await seedSystemAccounts(db, userId);

  const [account] = await db
    .insert(accounts)
    .values({ userId, name: "Test bank", type: "bank" })
    .returning({ id: accounts.id });

  // Create a category owned by userId — its ownership will be temporarily transferred to
  // otherUserId to trigger a per-row reconcile failure.
  const [cat] = await db
    .insert(categories)
    .values({ userId, name: "Misc", kind: "expense" })
    .returning({ id: categories.id });
  catId = cat!.id;

  // Create a transaction with the category so the computed draft carries catId.
  const [txn] = await db
    .insert(transactions)
    .values({
      userId,
      accountId: account!.id,
      date: "2026-01-04",
      amountPaise: -5000,
      merchant: "Coffee",
      categoryId: catId,
    })
    .returning({ id: transactions.id });

  // First reconcile: generates correct postings (repaired = 1).
  const first = await reconcileUserPostings(db, userId);
  assert.equal(first.failures.length, 0, "first reconcile must succeed");
  assert.ok(first.repaired > 0, "first reconcile must generate postings");

  // Insert a rogue posting to force drift — ensures postingsMultisetEqual returns false
  // on the second reconcile so replacePostings IS called (and will subsequently fail).
  await db.insert(postings).values({
    transactionId: txn!.id,
    accountId: account!.id,
    amountPaise: 1,
    categoryId: null,
    necessity: null,
    note: "rogue",
  });

  // Transfer the category to otherUserId so assertOwnedCategory(userId, catId) throws
  // HttpError(404) inside the per-row db.transaction callback.
  await db.update(categories).set({ userId: otherUserId }).where(eq(categories.id, catId));

  // Second reconcile: drift detected → replacePostings called → assertOwnedCategory fails →
  // per-row tx rolls back → failures=[{txn.id}] AND repaired stays 0 (NB1 invariant).
  const result = await reconcileUserPostings(db, userId);

  // Restore category ownership before assertions so the t.after() cleanup skips the restore.
  await db.update(categories).set({ userId }).where(eq(categories.id, catId));
  catId = null;

  assert.equal(result.repaired, 0, "NB1: repaired must not count a failed per-row transaction");
  assert.equal(result.failures.length, 1, "there must be exactly 1 failure entry");
  assert.ok(
    result.failures.some((f) => f.transactionId === txn!.id),
    "the failing transaction must appear in failures",
  );
});
