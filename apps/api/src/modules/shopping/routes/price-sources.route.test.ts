/**
 * DB-backed integration tests for price-source routes (task 10.1).
 *
 * Exercises the real HTTP layer against a real Postgres + Redis connection.
 * DB-gated: requires DATABASE_URL, REDIS_URL, SESSION_SECRET to be set.
 *
 * Tests:
 *  - GET /sources seeds platforms and returns them (AC1)
 *  - POST /sources creates a source
 *  - PUT /sources/:id updates a source
 *  - DELETE /sources/:id soft-deletes (sets isActive=false)
 *  - Duplicate name → 409 (AC5)
 *  - Cross-user access → 404 (AC4)
 *  - Demo session rejected on mutations → 403
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
import { priceSources } from "../schema.ts";

// DB-gated: fail fast if env vars are missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `price-sources.route.test.ts needs ${name} set — export it before running \`npm run test -w apps/api\`.`,
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
      email: `price-sources-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "price-sources.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(priceSources).where(eq(priceSources.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("unauthenticated request → 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/shopping/sources" });
  assert.equal(res.statusCode, 401);
});

test("GET /sources seeds 11 platforms for new user (AC1)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const res = await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });
  assert.equal(res.statusCode, 200, `GET /sources failed: ${res.body}`);
  const sources = JSON.parse(res.body) as Array<{ name: string; kind: string }>;
  assert.ok(Array.isArray(sources), "Response must be an array");
  assert.equal(sources.length, 11, `Expected 11 platform seeds, got ${sources.length}`);
  assert.ok(sources.some((s) => s.name === "Blinkit"), "Blinkit must be in seeds");
  assert.ok(sources.some((s) => s.name === "Local Kirana"), "Local Kirana must be in seeds");

  // Second call is idempotent — still exactly 11.
  const res2 = await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });
  const sources2 = JSON.parse(res2.body) as Array<unknown>;
  assert.equal(sources2.length, 11, "Second GET must still return 11 (idempotent)");
});

test("POST /sources creates a source; GET lists it", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Seed so cleanup works smoothly.
  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name: "My Local Store", kind: "local_store", url: null, isActive: true },
  });
  assert.equal(createRes.statusCode, 200, `Create failed: ${createRes.body}`);
  const created = JSON.parse(createRes.body);
  assert.equal(created.name, "My Local Store");
  assert.equal(created.kind, "local_store");
  assert.equal(created.isActive, true);
  assert.ok(created.id, "Must have an id");

  // GET lists it.
  const listRes = await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });
  assert.equal(listRes.statusCode, 200);
  const list = JSON.parse(listRes.body) as Array<{ id: string }>;
  assert.ok(list.some((s) => s.id === created.id), "Newly created source must appear in list");
});

test("PUT /sources/:id updates a source", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name: "Test Store", kind: "local_store", url: null, isActive: true },
  });
  const created = JSON.parse(createRes.body);

  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/sources/${created.id}`,
    cookies,
    payload: {
      name: "Test Store Renamed",
      kind: "ecommerce",
      url: "https://example.com",
      isActive: false,
    },
  });
  assert.equal(putRes.statusCode, 200, `PUT failed: ${putRes.body}`);
  const updated = JSON.parse(putRes.body);
  assert.equal(updated.name, "Test Store Renamed");
  assert.equal(updated.kind, "ecommerce");
  assert.equal(updated.isActive, false);
});

test("DELETE /sources/:id soft-deletes (sets isActive=false), returns 204", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name: "To Delete Store", kind: "local_store", url: null, isActive: true },
  });
  const created = JSON.parse(createRes.body);

  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/sources/${created.id}`,
    cookies,
  });
  assert.equal(delRes.statusCode, 204, `DELETE failed: ${delRes.body}`);

  // Verify in DB that isActive=false (soft delete).
  const row = await app.db.query.priceSources.findFirst({
    where: eq(priceSources.id, created.id),
    columns: { id: true, isActive: true },
  });
  assert.ok(row, "Row must still exist (soft delete)");
  assert.equal(row!.isActive, false, "isActive must be false after soft delete");
});

test("duplicate source name → 409 (AC5)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });

  const name = `UniqueStore-${randomUUID()}`;

  // First create → 200.
  const first = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name, kind: "local_store" },
  });
  assert.equal(first.statusCode, 200, `First create failed: ${first.body}`);

  // Second create with same name → 409.
  const dup = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name, kind: "ecommerce" },
  });
  assert.equal(dup.statusCode, 409, `Expected 409 for duplicate name, got ${dup.statusCode}: ${dup.body}`);
});

test("cross-user: PUT/DELETE on another user's source → 404", async (t) => {
  const userId1 = await createTestUser();
  const userId2 = await createTestUser();
  const sessionId1 = await createSession(app.redis, userId1);
  const sessionId2 = await createSession(app.redis, userId2);
  t.after(async () => {
    await destroySession(app.redis, sessionId1);
    await destroySession(app.redis, sessionId2);
    await cleanupUser(userId1);
    await cleanupUser(userId2);
  });

  const cookies1 = sessionCookie(sessionId1);
  const cookies2 = sessionCookie(sessionId2);

  // User1 creates a source.
  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies: cookies1 });
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies: cookies1,
    payload: { name: "User1 Source", kind: "local_store" },
  });
  const u1Source = JSON.parse(createRes.body);

  // User2 tries to PUT → 404.
  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/sources/${u1Source.id}`,
    cookies: cookies2,
    payload: { name: "Hijacked", kind: "ecommerce", url: null, isActive: false },
  });
  assert.equal(putRes.statusCode, 404, `Expected 404 for cross-user PUT, got ${putRes.statusCode}`);

  // User2 tries to DELETE → 404.
  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/sources/${u1Source.id}`,
    cookies: cookies2,
  });
  assert.equal(delRes.statusCode, 404, `Expected 404 for cross-user DELETE, got ${delRes.statusCode}`);
});

test("demo session rejected on mutations → 403", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);
  const fakeId = randomUUID();

  async function assertDemo403(method: "POST" | "PUT" | "DELETE", url: string, payload?: object): Promise<void> {
    const res = await (app.inject({ method, url, cookies, payload }) as Promise<{ statusCode: number; body: string }>);
    assert.equal(res.statusCode, 403, `Expected 403 for demo on ${method} ${url}, got ${res.statusCode}: ${res.body}`);
  }

  await assertDemo403("POST", "/api/shopping/sources", { name: "x", kind: "local_store" });
  await assertDemo403("PUT", `/api/shopping/sources/${fakeId}`, {
    name: "x",
    kind: "local_store",
    url: null,
    isActive: true,
  });
  await assertDemo403("DELETE", `/api/shopping/sources/${fakeId}`);
});
