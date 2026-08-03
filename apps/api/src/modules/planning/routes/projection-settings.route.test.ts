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
import { planningRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../services/session.ts";
import { users } from "../../../db/core-schema.ts";

// A Fastify injection test exercising the real HTTP layer (planningRoutes ->
// projectionSettingsRoutes, the auth hook, and demo-mode). Follows the
// buildTestApp() convention established by routes/user-tasks.route.test.ts:
// deliberately NOT built on buildApp() from app.ts (that also calls
// startJobs(), which registers BullMQ schedulers/queues against the shared
// dev Redis and never closes its "ingestor" queue connection, hanging
// `node --test`). This harness wires up only what these routes need —
// Postgres, Redis, the auth/security plugins, and planningRoutes itself.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `projection-settings.route.test.ts needs ${name} set (a real Postgres/Redis-backed app ` +
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
      email: `projection-settings-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "projection-settings.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(users).where(eq(users.id, userId));
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

test("an unauthenticated request to GET /api/projection-settings is rejected", async () => {
  const res = await app.inject({ method: "GET", url: "/api/projection-settings" });
  assert.equal(res.statusCode, 401);
});

test("a demo session's PUT /api/projection-settings is rejected 403, with no database effect", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "PUT",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
    payload: { equityReturnBps: 700 },
  });
  assert.equal(res.statusCode, 403);
});

test("an authenticated GET/PUT round-trip works", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const getDefault = await app.inject({
    method: "GET",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(getDefault.statusCode, 200);
  assert.equal((getDefault.json() as { equityReturnBps: number }).equityReturnBps, 1200);

  const put = await app.inject({
    method: "PUT",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
    payload: { equityReturnBps: 1000 },
  });
  assert.equal(put.statusCode, 200);
  assert.equal((put.json() as { equityReturnBps: number }).equityReturnBps, 1000);

  const getAfter = await app.inject({
    method: "GET",
    url: "/api/projection-settings",
    cookies: sessionCookie(sessionId),
  });
  assert.equal(getAfter.statusCode, 200);
  assert.equal((getAfter.json() as { equityReturnBps: number }).equityReturnBps, 1000);
});
