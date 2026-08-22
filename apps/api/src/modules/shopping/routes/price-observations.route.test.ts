/**
 * DB-backed integration tests for price-observation routes (task 10.1).
 *
 * Exercises the real HTTP layer against a real Postgres + Redis connection.
 * DB-gated: requires DATABASE_URL, REDIS_URL, SESSION_SECRET to be set.
 *
 * Tests:
 *  - POST /observations creates observation; GET returns it with isStale: false (AC2)
 *  - GET returns isStale: true when observedAt > 7 days ago (AC3)
 *  - Cross-user priceSourceId or catalogItemId → 404 (AC4)
 *  - DELETE /observations/:id removes the observation
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
import { catalogItems, priceObservations, priceSources } from "../schema.ts";

// DB-gated: fail fast if env vars are missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `price-observations.route.test.ts needs ${name} set — export it before running \`npm run test -w apps/api\`.`,
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
      email: `price-obs-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "price-observations.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // Delete in FK-safe order (observations before sources/catalog items before user).
  await app.db.delete(priceObservations).where(eq(priceObservations.userId, userId));
  await app.db.delete(priceSources).where(eq(priceSources.userId, userId));
  await app.db.delete(catalogItems).where(eq(catalogItems.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

/** Create a catalog item for the user (via HTTP). */
async function createCatalogItem(cookies: Record<string, string>, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: name },
  });
  assert.equal(res.statusCode, 200, `Create catalog item failed: ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

/** Create a price source for the user (via HTTP — GET /sources seeds, then POST). */
async function createPriceSource(cookies: Record<string, string>, name: string): Promise<string> {
  // Seed platforms first.
  await app.inject({ method: "GET", url: "/api/shopping/sources", cookies });
  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/sources",
    cookies,
    payload: { name, kind: "local_store" },
  });
  assert.equal(res.statusCode, 200, `Create price source failed: ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("unauthenticated request → 401", async () => {
  const fakeId = randomUUID();
  const res = await app.inject({
    method: "GET",
    url: `/api/shopping/observations?catalogItemId=${fakeId}`,
  });
  assert.equal(res.statusCode, 401);
});

test("POST /observations creates observation; GET returns it with isStale: false (AC2)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const itemId = await createCatalogItem(cookies, "Test Item");
  const sourceId = await createPriceSource(cookies, `TestSource-${randomUUID()}`);

  // POST /observations — create.
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies,
    payload: {
      catalogItemId: itemId,
      priceSourceId: sourceId,
      pricePaise: 14900,
    },
  });
  assert.equal(createRes.statusCode, 200, `Create observation failed: ${createRes.body}`);
  const created = JSON.parse(createRes.body);
  assert.equal(created.pricePaise, 14900);
  assert.equal(created.catalogItemId, itemId);
  assert.equal(created.priceSourceId, sourceId);

  // GET /observations?catalogItemId= — list returns the observation.
  const listRes = await app.inject({
    method: "GET",
    url: `/api/shopping/observations?catalogItemId=${itemId}`,
    cookies,
  });
  assert.equal(listRes.statusCode, 200, `List observations failed: ${listRes.body}`);
  const listBody = JSON.parse(listRes.body) as { observations: Array<{ id: string; isStale: boolean; sourceName: string }> };
  assert.ok(Array.isArray(listBody.observations));
  assert.ok(listBody.observations.some((o) => o.id === created.id), "Created observation must appear in list");

  const obs = listBody.observations.find((o) => o.id === created.id)!;
  assert.equal(obs.isStale, false, "Observation just created must NOT be stale");
  assert.ok(obs.sourceName, "sourceName must be present");
});

test("GET returns isStale: true when observedAt > 7 days ago (AC3)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const itemId = await createCatalogItem(cookies, "Stale Test Item");
  const sourceId = await createPriceSource(cookies, `StaleSource-${randomUUID()}`);

  // Create observation with observedAt 8 days ago.
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies,
    payload: {
      catalogItemId: itemId,
      priceSourceId: sourceId,
      pricePaise: 5000,
      observedAt: eightDaysAgo,
    },
  });
  assert.equal(createRes.statusCode, 200, `Create stale observation failed: ${createRes.body}`);
  const created = JSON.parse(createRes.body);

  // GET list — should return isStale: true.
  const listRes = await app.inject({
    method: "GET",
    url: `/api/shopping/observations?catalogItemId=${itemId}`,
    cookies,
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = JSON.parse(listRes.body) as { observations: Array<{ id: string; isStale: boolean }> };
  const obs = listBody.observations.find((o) => o.id === created.id);
  assert.ok(obs, "Observation must appear in list");
  assert.equal(obs!.isStale, true, "Observation 8 days old must be stale");
});

test("DELETE /observations/:id removes the observation", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const itemId = await createCatalogItem(cookies, "Delete Test Item");
  const sourceId = await createPriceSource(cookies, `DeleteSource-${randomUUID()}`);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies,
    payload: { catalogItemId: itemId, priceSourceId: sourceId, pricePaise: 9900 },
  });
  const created = JSON.parse(createRes.body);

  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/observations/${created.id}`,
    cookies,
  });
  assert.equal(delRes.statusCode, 204, `DELETE failed: ${delRes.body}`);

  // Verify it's gone from the list.
  const listRes = await app.inject({
    method: "GET",
    url: `/api/shopping/observations?catalogItemId=${itemId}`,
    cookies,
  });
  const listBody = JSON.parse(listRes.body) as { observations: Array<{ id: string }> };
  assert.ok(!listBody.observations.some((o) => o.id === created.id), "Deleted observation must not appear");
});

test("cross-user priceSourceId → 404 on POST /observations (AC4)", async (t) => {
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
  const u1SourceId = await createPriceSource(cookies1, `U1Source-${randomUUID()}`);

  // User2 creates a catalog item.
  const u2ItemId = await createCatalogItem(cookies2, "U2 Item");

  // User2 tries to POST with User1's sourceId → 404.
  const crossRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies: cookies2,
    payload: {
      catalogItemId: u2ItemId,
      priceSourceId: u1SourceId, // cross-user!
      pricePaise: 14900,
    },
  });
  assert.equal(crossRes.statusCode, 404, `Expected 404 for cross-user priceSourceId, got ${crossRes.statusCode}: ${crossRes.body}`);
});

test("cross-user catalogItemId → 404 on POST /observations (AC4)", async (t) => {
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

  // User1 creates a catalog item.
  const u1ItemId = await createCatalogItem(cookies1, "U1 Catalog Item");

  // User2 creates a source.
  const u2SourceId = await createPriceSource(cookies2, `U2Source-${randomUUID()}`);

  // User2 tries to POST with User1's catalogItemId → 404.
  const crossRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies: cookies2,
    payload: {
      catalogItemId: u1ItemId, // cross-user!
      priceSourceId: u2SourceId,
      pricePaise: 14900,
    },
  });
  assert.equal(crossRes.statusCode, 404, `Expected 404 for cross-user catalogItemId, got ${crossRes.statusCode}: ${crossRes.body}`);
});

test("cross-user observation DELETE → 404", async (t) => {
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

  // User1 creates catalog item + source + observation.
  const u1ItemId = await createCatalogItem(cookies1, "U1 Obs Item");
  const u1SourceId = await createPriceSource(cookies1, `U1ObsSource-${randomUUID()}`);
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/observations",
    cookies: cookies1,
    payload: { catalogItemId: u1ItemId, priceSourceId: u1SourceId, pricePaise: 19900 },
  });
  const u1Obs = JSON.parse(createRes.body);

  // User2 tries to DELETE User1's observation → 404.
  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/observations/${u1Obs.id}`,
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

  async function assertDemo403(method: "POST" | "DELETE", url: string, payload?: object): Promise<void> {
    const res = await (app.inject({ method, url, cookies, payload }) as Promise<{ statusCode: number; body: string }>);
    assert.equal(res.statusCode, 403, `Expected 403 for demo on ${method} ${url}, got ${res.statusCode}: ${res.body}`);
  }

  await assertDemo403("POST", "/api/shopping/observations", {
    catalogItemId: fakeId,
    priceSourceId: fakeId,
    pricePaise: 100,
  });
  await assertDemo403("DELETE", `/api/shopping/observations/${fakeId}`);
});
