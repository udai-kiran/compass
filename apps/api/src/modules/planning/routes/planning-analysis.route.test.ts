import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity } from "../../../plugins/security.ts";
import { planningRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { users } from "../../../db/core-schema.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { transactions, postings } from "../../../db/shared/ledger.ts";
import { statementReconciliations } from "../../../db/shared/spines.ts";
import { DataCompletenessReportSchema, IncomeSurplusResultSchema } from "@compass/shared";

// House-style integration test for planning-analysis routes.
// Requires a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them before running `npm run test -w apps/api`.
// These tests THROW at module load when env vars are absent (they do not skip).
// They are written but CANNOT be verified in a CI environment without DB/Redis.
// Reported as "written but unrun" per task 059 AC4b.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `planning-analysis.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
        "boot) — export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  await setupAuth(app);
  await setupSecurity(app);
  await app.register(planningRoutes);
  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });
  return app;
}

const app = await buildTestApp();
after(async () => {
  await app.close();
});

async function createUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `planning-analysis-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "planning-analysis.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  // FK-safe teardown. accounts.user_id and transactions.user_id are ON DELETE no action —
  // child rows must be removed before the user row. Postings cascade automatically from
  // transactions (postings.transaction_id → transactions ON DELETE cascade), so deleting
  // transactions is sufficient to clear postings.
  await app.db.delete(transactions).where(eq(transactions.userId, userId));
  await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/**
 * Insert a bank account for the given user and return its id.
 * Used to make data-completeness return a non-empty accounts array.
 */
async function createBankAccount(userId: string): Promise<string> {
  const [acct] = await app.db
    .insert(accounts)
    .values({
      userId,
      name: "Test Savings Account",
      type: "bank",
    })
    .returning({ id: accounts.id });
  return acct!.id;
}

/**
 * Insert a transaction with a positive posting on a bank account plus the
 * required counter posting on a system income account, so that
 * getIncomeSurplus records genuine non-zero income for userId in the current
 * calendar month. Returns the amount inserted (100_000 paise = 1 000 INR).
 *
 * The hasCategoryDimension() guard requires at least one posting whose account
 * has system_kind IN ('expenses','income'). The counter posting on the 'income'
 * system account satisfies that guard. The income query sums postings on
 * real accounts (system_kind IS NULL, type NOT IN liabilities, amount_paise > 0)
 * — that is the bank account posting.
 */
async function createIncomeTransaction(userId: string): Promise<{ amountPaise: number }> {
  const AMOUNT_PAISE = 100_000; // 1 000 INR

  // Real bank account (system_kind = null — counted by the income query)
  const [bankAcct] = await app.db
    .insert(accounts)
    .values({ userId, name: "Income Test Bank", type: "bank" })
    .returning({ id: accounts.id });

  // System income account (satisfies hasCategoryDimension)
  const [incomeAcct] = await app.db
    .insert(accounts)
    .values({ userId, name: "Income System", type: "system", systemKind: "income" })
    .returning({ id: accounts.id });

  // Use current month so the date falls inside the default 12-month window
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

  const [tx] = await app.db
    .insert(transactions)
    .values({ userId, date: dateStr, merchant: "Income Test" })
    .returning({ id: transactions.id });

  // Real posting: positive amount on the bank account → counted as income
  await app.db.insert(postings).values({
    transactionId: tx!.id,
    accountId: bankAcct!.id,
    amountPaise: AMOUNT_PAISE,
  });

  // Counter posting on the income system account → satisfies hasCategoryDimension
  await app.db.insert(postings).values({
    transactionId: tx!.id,
    accountId: incomeAcct!.id,
    amountPaise: -AMOUNT_PAISE,
  });

  return { amountPaise: AMOUNT_PAISE };
}

/**
 * Insert a statement_reconciliations row exercising both documented 500 risks:
 * (a) totalDuePaise uses a large-but-safe value to exercise Number.MAX_SAFE_INTEGER path
 * (b) period is a valid YYYY-MM string to verify the schema constraint is satisfied
 *
 * RESIDUAL RISK (AC12b): if period were a malformed string (not YYYY-MM), the
 * HouseholdRevolvingDebtSchema.cards[].latestStatement.period validator would reject
 * the serialized response with a 500. This row uses a valid period; a future DB
 * with malformed data would still expose that risk.
 */
async function createStatementReconciliation(
  userId: string,
  accountId: string,
): Promise<void> {
  // Large-but-safe monetary value: 50_000 INR = 5_000_000 paise (well within
  // Number.MAX_SAFE_INTEGER of ~9 quadrillion paise). Exercises the numeric
  // conversion path without triggering the .safe() rejection risk.
  await app.db.insert(statementReconciliations).values({
    userId,
    accountId,
    period: "2026-07", // valid YYYY-MM
    totalDuePaise: 5_000_000,
    minDuePaise: 250_000,
  });
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("GET /api/planning/income-surplus — 200 for a fresh user (empty history)", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const parsed = IncomeSurplusResultSchema.safeParse(JSON.parse(res.body));
  assert.ok(parsed.success, `response body failed schema: ${JSON.stringify(parsed.error?.issues)}`);
});

test("GET /api/planning/income-surplus — unauthenticated returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/planning/income-surplus" });
  assert.equal(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
});

test("GET /api/planning/income-surplus — cross-user isolation: user B cannot see user A data", async (t) => {
  const userAId = await createUser();
  const userBId = await createUser();
  const sessionA = await createSession(app.redis, userAId, {});
  const sessionB = await createSession(app.redis, userBId, {});
  // Give user A a real income transaction so at least one month has incomePaise > 0.
  // historyMonths is always 12 (the full requested window) regardless of data volume —
  // the real isolation check is that no month in user B's response has incomePaise > 0.
  // If the ownership filter were deleted, user A's income would bleed into B's months.
  const { amountPaise } = await createIncomeTransaction(userAId);
  t.after(async () => {
    await destroySession(app.redis, sessionA);
    await destroySession(app.redis, sessionB);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const resA = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus",
    cookies: sessionCookie(sessionA),
  });
  const resB = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus",
    cookies: sessionCookie(sessionB),
  });
  assert.equal(resA.statusCode, 200, `user A: expected 200, got ${resA.statusCode}`);
  assert.equal(resB.statusCode, 200, `user B: expected 200, got ${resB.statusCode}`);

  const bodyA = IncomeSurplusResultSchema.parse(JSON.parse(resA.body));
  const bodyB = IncomeSurplusResultSchema.parse(JSON.parse(resB.body));

  // User A must have real income data: at least one month with incomePaise matching
  // the inserted amount (100 000 paise). historyMonths is 12 (the full requested window),
  // not a count of months that have data.
  assert.equal(bodyA.historyMonths, 12, "historyMonths reflects the full 12-month requested window, not data volume");
  const userAIncomingMonth = bodyA.months.find((m) => m.incomePaise === amountPaise);
  assert.ok(
    userAIncomingMonth !== undefined,
    `user A must have a month with incomePaise=${amountPaise}; got months=${JSON.stringify(bodyA.months)}`,
  );

  // User B has no ledger data. historyMonths is still 12 (the requested window size,
  // not data volume). The real isolation assertion: no month in user B's response may
  // have incomePaise > 0.
  assert.equal(bodyB.historyMonths, 12, "historyMonths reflects the full 12-month window even for an empty user");
  const leakedMonth = bodyB.months.find((m) => m.incomePaise > 0);
  assert.equal(
    leakedMonth,
    undefined,
    `user A income leaked into user B response: ${JSON.stringify(leakedMonth)}`,
  );
});

test("GET /api/planning/data-completeness — 200 for a fresh user", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const parsed = DataCompletenessReportSchema.safeParse(JSON.parse(res.body));
  assert.ok(parsed.success, `response body failed schema: ${JSON.stringify(parsed.error?.issues)}`);
});

test("GET /api/planning/data-completeness — user with account: returns non-empty accounts array, period constraint not triggered", async (t) => {
  // FIX 3: exercises the documented AC12b risk path:
  // statementReconciliations.period is unconstrained text — a malformed value
  // would cause the YYYY-MM schema validator to reject and 500. This row uses
  // a valid period, proving the happy path serializes correctly. An integration
  // CI environment would be needed to close the risk entirely.
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  const accountId = await createBankAccount(userId);
  await createStatementReconciliation(userId, accountId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const parsed = DataCompletenessReportSchema.safeParse(JSON.parse(res.body));
  assert.ok(parsed.success, `response body failed schema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.ok(
    parsed.data!.accounts.length > 0,
    "user with an account must have at least one account in data-completeness response",
  );
});

test("GET /api/planning/data-completeness — unauthenticated returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/planning/data-completeness" });
  assert.equal(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
});

test("GET /api/planning/data-completeness — cross-user isolation: user B sees none of user A accounts", async (t) => {
  const userAId = await createUser();
  const userBId = await createUser();
  const sessionA = await createSession(app.redis, userAId, {});
  const sessionB = await createSession(app.redis, userBId, {});
  // Give user A a real bank account
  await createBankAccount(userAId);
  t.after(async () => {
    await destroySession(app.redis, sessionA);
    await destroySession(app.redis, sessionB);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const resA = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness",
    cookies: sessionCookie(sessionA),
  });
  const resB = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness",
    cookies: sessionCookie(sessionB),
  });
  assert.equal(resA.statusCode, 200, `user A: expected 200, got ${resA.statusCode}`);
  assert.equal(resB.statusCode, 200, `user B: expected 200, got ${resB.statusCode}`);

  const bodyA = DataCompletenessReportSchema.parse(JSON.parse(resA.body));
  const bodyB = DataCompletenessReportSchema.parse(JSON.parse(resB.body));

  // User A has one account; user B has none. If ownership filtering broke,
  // user A's account would appear in user B's response.
  assert.ok(bodyA.accounts.length > 0, "user A must have at least one account in their report");
  assert.equal(bodyB.accounts.length, 0, "user B (empty user) must see 0 accounts; user A data must not leak");
  // No account ID from user A's list should appear in user B's list
  const userAAccountIds = new Set(bodyA.accounts.map((a) => a.accountId));
  for (const acct of bodyB.accounts) {
    assert.ok(
      !userAAccountIds.has(acct.accountId),
      `user A account ${acct.accountId} leaked into user B response`,
    );
  }
});

test("GET /api/planning/data-completeness — ?today= is silently ignored: route has no querystring schema", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // The data-completeness route defines NO querystring schema at all, so query
  // params are not processed by the validator. The handler calls
  // getDataCompletenessReport(db, userId) without the today argument; the
  // service defaults today = new Date(). The returned asOf must NOT be "2020-01-01".
  const res = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness?today=2020-01-01",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(
    res.statusCode,
    200,
    `expected 200 (today= silently ignored), got ${res.statusCode}: ${res.body}`,
  );
  const body = DataCompletenessReportSchema.parse(JSON.parse(res.body));
  // asOf must be today's server date, NOT the supplied query param value
  assert.notEqual(
    body.asOf,
    "2020-01-01",
    "asOf must not be affected by ?today= query param — route has no querystring schema",
  );
});
