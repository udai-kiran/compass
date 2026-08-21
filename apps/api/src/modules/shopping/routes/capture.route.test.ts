/**
 * Integration test for the shopping capture route — demo-session rejection (AC6).
 *
 * DB-gated: requires DATABASE_URL, REDIS_URL, SESSION_SECRET to be set.
 * Mirrors the demo-403 pattern from lists.route.test.ts / catalog.route.test.ts.
 *
 * Registers the REAL auth hook and the REAL shopping routes.  Demo sessions are
 * rejected at the auth chokepoint in plugins/auth.ts (MUTATING_METHODS check)
 * before the route handler runs — parseListText is never called, so no AI
 * provider mock is needed.
 */

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
import { shoppingRoutes } from "../plugin.ts";
import { createSession, destroySession } from "../../../modules/system/services/session.ts";
import { users } from "../../../db/schema.ts";

// DB-gated: fail fast if env vars are missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `capture.route.test.ts needs ${name} set — export it (see apps/api/.env) before running \`npm run test -w apps/api\`.`,
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
  await app.register(shoppingRoutes, { prefix: "/api/shopping" });
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

async function createTestUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `capture-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "capture.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(users).where(eq(users.id, userId));
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("demo session rejected on POST /api/shopping/parse-text → 403 (AC6)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/parse-text",
    cookies: sessionCookie(sessionId),
    payload: { text: "milk, eggs, bread" },
  });
  assert.equal(res.statusCode, 403, `Expected 403 but got ${res.statusCode}: ${res.body}`);
});
