import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity } from "../../../plugins/security.ts";
import { planningRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { users } from "../../../db/core-schema.ts";
import { budgets, goals } from "../schema.ts";

// A Fastify injection test exercising the real HTTP layer (planningRoutes ->
// all 8 route groups, auth hook, and demo-mode 403). Follows the
// buildTestApp() convention from projection-settings.route.test.ts and
// networth.route.test.ts: deliberately NOT built on buildApp() from app.ts
// (that also calls startJobs(), which registers BullMQ schedulers/queues
// against the shared dev Redis and never closes its "ingestor" queue
// connection, hanging `node --test`). This harness wires up only what these
// routes need — Postgres, Redis, the auth/security plugins, and the full
// planningRoutes plugin.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `planning.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
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
      email: `planning-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "planning.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(goals).where(eq(goals.userId, userId));
  await app.db.delete(budgets).where(eq(budgets.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("a demo session's PUT /api/budgets/monthly/2024-01 is rejected 403, and no budgets row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Precondition: no budget exists for this user, period and key.
  const before = await app.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.period, "monthly"), eq(budgets.periodKey, "2024-01")));
  assert.equal(before.length, 0, "precondition: fresh user has no budget for monthly/2024-01");

  const res = await app.inject({
    method: "PUT",
    url: "/api/budgets/monthly/2024-01",
    cookies: sessionCookie(sessionId),
    payload: { lines: [] },
  });
  assert.equal(res.statusCode, 403, "expected 403 for demo session on PUT /api/budgets/monthly/2024-01");

  // After: no budget row was written.
  const after = await app.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.period, "monthly"), eq(budgets.periodKey, "2024-01")));
  assert.equal(after.length, 0, "a rejected demo request must not have written a budget row");
});

test("a demo session's POST /api/goals is rejected 403, and no goals row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Precondition: no goal exists for this user.
  const before = await app.db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId));
  assert.equal(before.length, 0, "precondition: fresh user has no goals");

  const res = await app.inject({
    method: "POST",
    url: "/api/goals",
    cookies: sessionCookie(sessionId),
    payload: { name: "Test Goal", targetPaise: 100000, targetMonths: 12, type: "generic" },
  });
  assert.equal(res.statusCode, 403, "expected 403 for demo session on POST /api/goals");

  // After: no goal row was created.
  const after = await app.db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId));
  assert.equal(after.length, 0, "a rejected demo request must not have written a goal row");
});