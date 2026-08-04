import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, users } from "../../../db/schema.ts";
import { cardDetails } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { earnedRewardPoints, getCardEarnRate } from "./rewards.ts";

// ---------- earnedRewardPoints (tasks/008-migrate-credit — new, test-first) ----------
//
// Pure calculator: no DB. `points = floor(spendPaise * earnRatePer100 / 10_000)`.

test("earnedRewardPoints: zero spend earns zero points regardless of rate", () => {
  assert.equal(earnedRewardPoints(0, 5), 0);
});

test("earnedRewardPoints: zero rate earns zero points regardless of spend", () => {
  assert.equal(earnedRewardPoints(500000, 0), 0);
});

test("earnedRewardPoints: exactly ₹100 spend at 1 point/₹100 earns exactly 1 point", () => {
  assert.equal(earnedRewardPoints(10_000, 1), 1);
});

test("earnedRewardPoints: spend below ₹100 earns zero points (floors down, no partial point)", () => {
  assert.equal(earnedRewardPoints(9_999, 1), 0);
});

test("earnedRewardPoints: multiple complete ₹100 units earn one point per unit", () => {
  // ₹500 at 2 points/₹100 -> 5 units * 2 = 10 points.
  assert.equal(earnedRewardPoints(50_000, 2), 10);
});

test("earnedRewardPoints: a remainder above a complete unit floors to the completed units only", () => {
  // ₹150 at 1 point/₹100 -> 1.5 units -> floors to 1 point.
  assert.equal(earnedRewardPoints(15_000, 1), 1);
});

test("earnedRewardPoints: rejects negative spendPaise", () => {
  assert.throws(
    () => earnedRewardPoints(-1, 1),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("earnedRewardPoints: rejects negative earnRatePer100", () => {
  assert.throws(
    () => earnedRewardPoints(10_000, -1),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("earnedRewardPoints: rejects non-integer inputs", () => {
  assert.throws(
    () => earnedRewardPoints(10_000.5, 1),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  assert.throws(
    () => earnedRewardPoints(10_000, 1.5),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("earnedRewardPoints: rejects an individual input that itself exceeds Number.MAX_SAFE_INTEGER", () => {
  assert.throws(
    () => earnedRewardPoints(Number.MAX_SAFE_INTEGER + 2, 1),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  assert.throws(
    () => earnedRewardPoints(10_000, Number.MAX_SAFE_INTEGER + 2),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("earnedRewardPoints: rejects when both inputs are individually safe integers but their PRODUCT is not", () => {
  // Each operand alone is well within Number.MAX_SAFE_INTEGER (2^53 - 1 ≈
  // 9.007e15), but a large, realistic spend times a large, realistic rate
  // multiply past it — this is the case a single "large-spend" sanity check
  // cannot catch, since it specifically requires the PRODUCT, not either
  // input alone, to cross the boundary.
  const spendPaise = 200_000_000_000; // ₹2,00,00,00,000 — individually safe
  const earnRatePer100 = 100_000_000; // individually safe
  assert.ok(Number.isSafeInteger(spendPaise));
  assert.ok(Number.isSafeInteger(earnRatePer100));
  assert.ok(!Number.isSafeInteger(spendPaise * earnRatePer100), "fixture sanity: the product must overflow");
  assert.throws(
    () => earnedRewardPoints(spendPaise, earnRatePer100),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

// ---------- getCardEarnRate (DB-backed lookup) ----------

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "rewards.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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
  // isDemo: true — these tests exercise only getCardEarnRate (unrelated to
  // card-due materialization), and a non-demo card_details row here would
  // race against card-due-tasks.test.ts's global "zero pre-existing non-demo
  // card_details rows" precondition guard when node:test runs multiple test
  // files concurrently against the same shared dev Postgres (confirmed by
  // direct reproduction during this task's implementation — see
  // implementation-1.md). Marking these users as demo excludes their rows
  // from that unrelated file's count entirely, with no effect on
  // getCardEarnRate/ownedCardAccount, neither of which reads isDemo.
  const [u] = await db
    .insert(users)
    .values({
      email: `rewards-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "rewards.test.ts user",
      isDemo: true,
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createCardAccount(userId: string): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: "Test card", type: "credit_card" })
    .returning({ id: accounts.id });
  return a!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.userId, userId)); // cascades card_details
  await db.delete(users).where(eq(users.id, userId));
}

test("getCardEarnRate: returns the configured earn_rate_per_100 when a card_details row exists", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  await db.insert(cardDetails).values({ accountId, userId, earnRatePer100: 4 });

  const rate = await getCardEarnRate(db, userId, accountId);
  assert.equal(rate, 4);
});

test("getCardEarnRate: returns null (not 0) when no card_details row exists at all", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  // No card_details row inserted for this account.

  const rate = await getCardEarnRate(db, userId, accountId);
  assert.equal(rate, null);
});

test("getCardEarnRate: a genuinely-stored rate of 0 is distinguished from 'no card_details row' (both are falsy, only one is null)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createCardAccount(userId);
  await db.insert(cardDetails).values({ accountId, userId, earnRatePer100: 0 });

  const rate = await getCardEarnRate(db, userId, accountId);
  assert.equal(rate, 0);
  assert.notEqual(rate, null);
});

test("getCardEarnRate: a nonexistent account 404s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await assert.rejects(
    getCardEarnRate(db, userId, randomUUID()),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("getCardEarnRate: another user's card 404s (ownership enforced)", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountB = await createCardAccount(userB);
  await db.insert(cardDetails).values({ accountId: accountB, userId: userB, earnRatePer100: 3 });

  await assert.rejects(
    getCardEarnRate(db, userA, accountB),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("getCardEarnRate: a non-credit-card account 400s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const [a] = await db.insert(accounts).values({ userId, name: "Bank", type: "bank" }).returning({ id: accounts.id });

  await assert.rejects(
    getCardEarnRate(db, userId, a!.id),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});
