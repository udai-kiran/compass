import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../../../config.ts";
import { createPool } from "../../../infra/db.ts";
import { createRedis } from "../../../infra/redis.ts";
import { createDb } from "../../../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../../../plugins/auth.ts";
import { setupSecurity } from "../../../plugins/security.ts";
import { automationRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { users } from "../../../db/core-schema.ts";
import { aiSettings, aiEvents } from "../schema.ts";

// A Fastify injection test exercising the real HTTP layer (automationRoutes ->
// both AI route groups, auth hook, and demo-mode 403). Follows the
// buildTestApp() convention from projection-settings.route.test.ts and
// planning.route.test.ts: deliberately NOT built on buildApp() from app.ts
// (that also calls startJobs(), which registers BullMQ schedulers/queues
// against the shared dev Redis and never closes its "ingestor" queue
// connection, hanging `node --test`). This harness wires up only what these
// routes need — Postgres, Redis, the auth/security plugins, and the full
// automationRoutes plugin.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `automation.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
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
  await app.register(automationRoutes);
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
      email: `automation-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "automation.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(aiEvents).where(eq(aiEvents.userId, userId));
  await app.db.delete(aiSettings).where(eq(aiSettings.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("a demo session's PUT /api/ai/settings is rejected 403, and no ai_settings row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Precondition: no ai_settings row exists for this user.
  const before = await app.db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId));
  assert.equal(before.length, 0, "precondition: fresh user has no ai_settings row");

  const res = await app.inject({
    method: "PUT",
    url: "/api/ai/settings",
    cookies: sessionCookie(sessionId),
    payload: { provider: "none", baseUrl: "", model: "" },
  });
  assert.equal(res.statusCode, 403, "expected 403 for demo session on PUT /api/ai/settings");

  // After: no ai_settings row was written.
  const after = await app.db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId));
  assert.equal(after.length, 0, "a rejected demo request must not have written an ai_settings row");
});

test("a demo session's POST /api/ai/categorize is rejected 403, and no ai_events row is written", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  // Precondition: no ai_events row exists for this user.
  const before = await app.db
    .select()
    .from(aiEvents)
    .where(eq(aiEvents.userId, userId));
  assert.equal(before.length, 0, "precondition: fresh user has no ai_events rows");

  const res = await app.inject({
    method: "POST",
    url: "/api/ai/categorize",
    cookies: sessionCookie(sessionId),
    payload: { transactionIds: [] },
  });
  assert.equal(res.statusCode, 403, "expected 403 for demo session on POST /api/ai/categorize");

  // After: no ai_events row was created.
  const after = await app.db
    .select()
    .from(aiEvents)
    .where(eq(aiEvents.userId, userId));
  assert.equal(after.length, 0, "a rejected demo request must not have written an ai_events row");
});