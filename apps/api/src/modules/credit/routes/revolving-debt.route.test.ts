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
import { creditRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { users } from "../../../db/core-schema.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { statementReconciliations } from "../../../db/shared/spines.ts";
import { cardDetails } from "../schema.ts";
import { HouseholdRevolvingDebtSchema } from "@compass/shared";

// House-style integration test for revolving-debt route.
// Requires a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them before running `npm run test -w apps/api`.
// These tests THROW at module load when env vars are absent (they do not skip).
// They are written but CANNOT be verified in a CI environment without DB/Redis.
// Reported as "written but unrun" per task 059 AC4b.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `revolving-debt.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
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
  await app.register(creditRoutes);
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
      email: `revolving-debt-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "revolving-debt.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  // FK-safe teardown. accounts.user_id, card_details.user_id, and
  // statement_reconciliations.user_id are all ON DELETE no action — child rows
  // must be removed before the user row. Deletion order:
  //   statementReconciliations before accounts (statementRecs.user_id → users ON DELETE no action)
  //   cardDetails before accounts (cardDetails.user_id → users ON DELETE no action)
  //   accounts before user (accounts.user_id → users ON DELETE no action)
  await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
  await app.db.delete(cardDetails).where(eq(cardDetails.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/**
 * Create a credit card account with card details and a statement reconciliation.
 * Returns the account id.
 *
 * This exercises both documented AC12 residual 500 risks:
 * (a) totalDuePaise uses a large-but-safe value (50_000 INR = 5_000_000 paise,
 *     well within Number.MAX_SAFE_INTEGER) to exercise the numeric conversion path.
 * (b) period uses a valid YYYY-MM string to satisfy the schema constraint.
 *     A malformed period in legacy data would cause the serializer to reject with 500.
 */
async function createCardWithStatement(userId: string): Promise<string> {
  // Insert credit card account
  const [acct] = await app.db
    .insert(accounts)
    .values({
      userId,
      name: "Test HDFC Regalia",
      type: "credit_card",
    })
    .returning({ id: accounts.id });
  const accountId = acct!.id;

  // Insert card details (required for getHouseholdRevolvingDebt inner join)
  await app.db.insert(cardDetails).values({
    accountId,
    userId,
    productName: "Regalia",
    cycleDay: 1,
    dueDay: 15,
    aprBps: 4200, // 42% p.a. — exercises estimateMonthlyCharge path
  });

  // Insert statement reconciliation row:
  // - period "2026-08" is valid YYYY-MM (exercises AC12b: unconstrained text column)
  // - totalDuePaise = 5_000_000 paise (50_000 INR, large-but-safe, exercises AC12a)
  // - minDuePaise non-null as required by the schema
  const currentPeriod = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  await app.db.insert(statementReconciliations).values({
    userId,
    accountId,
    period: currentPeriod,
    totalDuePaise: 5_000_000,
    minDuePaise: 250_000,
  });

  return accountId;
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("GET /api/credit/revolving-debt — 200 for a fresh user (no cards)", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/credit/revolving-debt",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const parsed = HouseholdRevolvingDebtSchema.safeParse(JSON.parse(res.body));
  assert.ok(parsed.success, `response body failed schema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(parsed.data!.hasRevolvingDebt, false, "fresh user has no revolving debt");
  assert.equal(parsed.data!.cards.length, 0, "fresh user has no cards");
});

test("GET /api/credit/revolving-debt — user with card and statement returns non-empty cards array", async (t) => {
  // FIX 3: exercises the documented AC12 risks with real DB data.
  // - Non-empty cards array proves the serializer handles real card data.
  // - large-but-safe totalDuePaise exercises the Number(bigintString) path.
  // - valid YYYY-MM period exercises the text-to-YYYY-MM schema path.
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, {});
  await createCardWithStatement(userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/credit/revolving-debt",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const parsed = HouseholdRevolvingDebtSchema.safeParse(JSON.parse(res.body));
  assert.ok(parsed.success, `response body failed schema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.ok(parsed.data!.cards.length > 0, "user with a card must have at least one card in response");
});

test("GET /api/credit/revolving-debt — unauthenticated returns 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/credit/revolving-debt" });
  assert.equal(res.statusCode, 401, `expected 401, got ${res.statusCode}`);
});

test("GET /api/credit/revolving-debt — cross-user isolation: user B cannot see user A cards", async (t) => {
  const userAId = await createUser();
  const userBId = await createUser();
  const sessionA = await createSession(app.redis, userAId, {});
  const sessionB = await createSession(app.redis, userBId, {});
  // Give user A a real credit card with statement data; user B has none.
  // If ownership filtering broke, user A's card would appear in user B's response.
  await createCardWithStatement(userAId);
  t.after(async () => {
    await destroySession(app.redis, sessionA);
    await destroySession(app.redis, sessionB);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const resA = await app.inject({
    method: "GET",
    url: "/api/credit/revolving-debt",
    cookies: sessionCookie(sessionA),
  });
  const resB = await app.inject({
    method: "GET",
    url: "/api/credit/revolving-debt",
    cookies: sessionCookie(sessionB),
  });
  assert.equal(resA.statusCode, 200, `user A: expected 200, got ${resA.statusCode}`);
  assert.equal(resB.statusCode, 200, `user B: expected 200, got ${resB.statusCode}`);

  const bodyA = HouseholdRevolvingDebtSchema.parse(JSON.parse(resA.body));
  const bodyB = HouseholdRevolvingDebtSchema.parse(JSON.parse(resB.body));

  // User A has one card; user B has none.
  assert.ok(bodyA.cards.length > 0, "user A must have at least one card");
  assert.equal(bodyB.cards.length, 0, "user B (empty user) must have 0 cards; user A data must not leak");

  // No account ID from user A's cards should appear in user B's cards
  const userACardIds = new Set(bodyA.cards.map((c) => c.accountId));
  for (const card of bodyB.cards) {
    assert.ok(
      !userACardIds.has(card.accountId),
      `user A card ${card.accountId} leaked into user B response`,
    );
  }
});
