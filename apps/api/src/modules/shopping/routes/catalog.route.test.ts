/**
 * Integration tests for catalog routes + canonicalize (task 9.3).
 *
 * Exercises the real HTTP layer (Fastify + Zod + the real auth hook), against a
 * real Postgres + Redis connection. DB-gated: requires DATABASE_URL, REDIS_URL,
 * SESSION_SECRET to be set.
 *
 * Modelled on lists.route.test.ts.
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
import { users, categories } from "../../../db/schema.ts";
import { catalogItems } from "../schema.ts";

// DB-gated: fail fast if env vars are missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `catalog.route.test.ts needs ${name} set — export it (see apps/api/.env) before running \`npm run test -w apps/api\`.`,
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

// ── Test-user lifecycle ───────────────────────────────────────────────────────

async function createTestUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `catalog-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "catalog.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(categories).where(eq(categories.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("unauthenticated request → 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/shopping/catalog" });
  assert.equal(res.statusCode, 401);
});

test("catalog CRUD round-trip: create → list → get → update → delete", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // POST /catalog — create.
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Atta" },
  });
  assert.equal(createRes.statusCode, 200, `Create failed: ${createRes.body}`);
  const item = JSON.parse(createRes.body);
  assert.equal(item.canonicalName, "Atta");
  assert.equal(item.brand, null);
  assert.equal(item.categoryId, null);
  assert.equal(item.packQuantityBase, null);
  assert.equal(item.unit, null);
  const itemId: string = item.id;

  // GET /catalog — list includes the new item.
  const listRes = await app.inject({ method: "GET", url: "/api/shopping/catalog", cookies });
  assert.equal(listRes.statusCode, 200);
  const list = JSON.parse(listRes.body) as Array<{ id: string }>;
  assert.ok(Array.isArray(list));
  assert.ok(list.some((i) => i.id === itemId));

  // GET /catalog/:id — get the item.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/catalog/${itemId}`, cookies });
  assert.equal(getRes.statusCode, 200);
  const got = JSON.parse(getRes.body);
  assert.equal(got.id, itemId);
  assert.equal(got.canonicalName, "Atta");

  // PUT /catalog/:id — full replace with all fields.
  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/catalog/${itemId}`,
    cookies,
    payload: {
      canonicalName: "Whole Wheat Atta",
      brand: "Aashirvaad",
      categoryId: null,
      packQuantityBase: 5000,
      unit: "g",
    },
  });
  assert.equal(putRes.statusCode, 200, `Update failed: ${putRes.body}`);
  const updated = JSON.parse(putRes.body);
  assert.equal(updated.canonicalName, "Whole Wheat Atta");
  assert.equal(updated.brand, "Aashirvaad");
  assert.equal(updated.packQuantityBase, 5000);
  assert.equal(updated.unit, "g");

  // DELETE /catalog/:id — delete the item.
  const delRes = await app.inject({ method: "DELETE", url: `/api/shopping/catalog/${itemId}`, cookies });
  assert.equal(delRes.statusCode, 200);
  assert.equal(JSON.parse(delRes.body).ok, true);

  // GET /catalog/:id after delete → 404.
  const getAfterDel = await app.inject({ method: "GET", url: `/api/shopping/catalog/${itemId}`, cookies });
  assert.equal(getAfterDel.statusCode, 404);
});

test("PUT /catalog/:id omitting a field → 400 (PUT-strict)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Rice" },
  });
  const created = JSON.parse(createRes.body);

  // Omit `brand` → 400.
  const badRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/catalog/${created.id}`,
    cookies,
    payload: {
      canonicalName: "Rice",
      categoryId: null,
      packQuantityBase: null,
      unit: null,
      // brand omitted
    },
  });
  assert.equal(badRes.statusCode, 400, `Expected 400 for missing brand, got ${badRes.statusCode}`);
});

test("duplicate canonicalName → 409 on create AND update", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Create "Milk".
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Milk" },
  });
  assert.equal(createRes.statusCode, 200, `First create failed: ${createRes.body}`);

  // Create "Milk" again → 409.
  const dupCreate = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Milk" },
  });
  assert.equal(dupCreate.statusCode, 409, `Expected 409 for duplicate name, got ${dupCreate.statusCode}: ${dupCreate.body}`);

  // Create "Eggs" and try to rename it to "Milk" → 409.
  const eggs = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Eggs" },
  });
  assert.equal(eggs.statusCode, 200);
  const eggsItem = JSON.parse(eggs.body);

  const dupUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/catalog/${eggsItem.id}`,
    cookies,
    payload: {
      canonicalName: "Milk", // conflict
      brand: null,
      categoryId: null,
      packQuantityBase: null,
      unit: null,
    },
  });
  assert.equal(dupUpdate.statusCode, 409, `Expected 409 for duplicate name on update, got ${dupUpdate.statusCode}: ${dupUpdate.body}`);
});

test("catalog IDOR: cross-owner /:id → 404", async (t) => {
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
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies: cookies1,
    payload: { canonicalName: "User1-item" },
  });
  const u1Item = JSON.parse(createRes.body);

  // User2 tries to GET/PUT/DELETE it → 404.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/catalog/${u1Item.id}`, cookies: cookies2 });
  assert.equal(getRes.statusCode, 404);

  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/catalog/${u1Item.id}`,
    cookies: cookies2,
    payload: { canonicalName: "Hijacked", brand: null, categoryId: null, packQuantityBase: null, unit: null },
  });
  assert.equal(putRes.statusCode, 404);

  const delRes = await app.inject({ method: "DELETE", url: `/api/shopping/catalog/${u1Item.id}`, cookies: cookies2 });
  assert.equal(delRes.statusCode, 404);
});

test("categoryId ownership: cross-owner or missing categoryId → 404 on create AND update; null allowed", async (t) => {
  const userId1 = await createTestUser();
  const userId2 = await createTestUser();
  const sessionId1 = await createSession(app.redis, userId1);
  t.after(async () => {
    await destroySession(app.redis, sessionId1);
    await cleanupUser(userId1);
    await cleanupUser(userId2);
  });

  const cookies1 = sessionCookie(sessionId1);

  // Create a category owned by userId2 directly in DB.
  const [cat2] = await app.db
    .insert(categories)
    .values({ userId: userId2, name: "User2-Cat", kind: "expense" as const })
    .returning({ id: categories.id });

  // Create with user2's categoryId → 404.
  const crossCreate = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies: cookies1,
    payload: { canonicalName: "TestItem", categoryId: cat2!.id },
  });
  assert.equal(crossCreate.statusCode, 404, `Expected 404 for cross-owner categoryId on create, got ${crossCreate.statusCode}`);

  // Create with nonexistent categoryId → 404.
  const fakeId = randomUUID();
  const nonexistentCreate = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies: cookies1,
    payload: { canonicalName: "TestItem2", categoryId: fakeId },
  });
  assert.equal(nonexistentCreate.statusCode, 404, `Expected 404 for nonexistent categoryId on create`);

  // Create with null categoryId → 200.
  const nullCreate = await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies: cookies1,
    payload: { canonicalName: "NullCat", categoryId: null },
  });
  assert.equal(nullCreate.statusCode, 200, `Expected 200 for null categoryId: ${nullCreate.body}`);
  const createdItem = JSON.parse(nullCreate.body);

  // Update with cross-owner categoryId → 404.
  const crossUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/catalog/${createdItem.id}`,
    cookies: cookies1,
    payload: {
      canonicalName: "NullCat",
      brand: null,
      categoryId: cat2!.id,
      packQuantityBase: null,
      unit: null,
    },
  });
  assert.equal(crossUpdate.statusCode, 404, `Expected 404 for cross-owner categoryId on update`);
});

test("GET /catalog/match: unique → matched, ambiguous (Atta+atta) → ambiguous, none → none", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Seed "Rice" (only one → unique).
  await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Rice" },
  });

  // Seed BOTH "Atta" and "atta" — case-sensitive unique index allows both.
  await app.db.insert(catalogItems).values([
    { userId, canonicalName: "Atta" },
    { userId, canonicalName: "atta" },
  ]);

  // Capture catalog_items count before match calls — AC4: GET /catalog/match must never create rows.
  const matchCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  // Unique match: "rice" → matched (case-insensitive).
  const matchRice = await app.inject({
    method: "GET",
    url: "/api/shopping/catalog/match?q=rice",
    cookies,
  });
  assert.equal(matchRice.statusCode, 200, matchRice.body);
  const riceResult = JSON.parse(matchRice.body);
  assert.equal(riceResult.status, "matched", `Expected matched, got ${JSON.stringify(riceResult)}`);
  assert.ok(riceResult.catalogItemId, "matched result must have catalogItemId");
  // AC4: GET /catalog/match must not create catalog_items rows.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    matchCountBefore,
    "GET /catalog/match must not create catalog_items rows (matched case)",
  );

  // Ambiguous: "atta" matches both "Atta" and "atta" → ambiguous.
  const matchAtta = await app.inject({
    method: "GET",
    url: "/api/shopping/catalog/match?q=atta",
    cookies,
  });
  assert.equal(matchAtta.statusCode, 200, matchAtta.body);
  const attaResult = JSON.parse(matchAtta.body);
  assert.equal(attaResult.status, "ambiguous", `Expected ambiguous, got ${JSON.stringify(attaResult)}`);
  assert.ok(Array.isArray(attaResult.candidateIds) && attaResult.candidateIds.length >= 2);
  // AC4: GET /catalog/match must not create catalog_items rows.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    matchCountBefore,
    "GET /catalog/match must not create catalog_items rows (ambiguous case)",
  );

  // No match: "unknown item" → none.
  const matchNone = await app.inject({
    method: "GET",
    url: `/api/shopping/catalog/match?q=${encodeURIComponent("unknown item")}`,
    cookies,
  });
  assert.equal(matchNone.statusCode, 200, matchNone.body);
  assert.equal(JSON.parse(matchNone.body).status, "none");
  // AC4: GET /catalog/match must not create catalog_items rows.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    matchCountBefore,
    "GET /catalog/match must not create catalog_items rows (none case)",
  );

  // GET /catalog/match is NOT shadowed by /:id — status 200, not 400 (uuid validation fail).
  // If "match" were parsed as :id it would fail uuid validation.
  const shadowCheck = await app.inject({ method: "GET", url: "/api/shopping/catalog/match", cookies });
  assert.equal(shadowCheck.statusCode, 200, `GET /catalog/match was shadowed by /:id (got ${shadowCheck.statusCode}: ${shadowCheck.body})`);
});

test("canonicalizeItem: unique match auto-links and bumps item+list updatedAt; ambiguous/none → no write", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Create a list and add a raw-text item.
  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Canonicalize test" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Basmati Rice" },
  });
  const item = (JSON.parse(addRes.body) as { items: Array<{ id: string; updatedAt: string }> }).items[0]!;
  const beforeItemUpdatedAt = item.updatedAt;

  // Record list updatedAt before canonicalize.
  const listBefore = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  const beforeListUpdatedAt = listBefore.updatedAt;

  // Capture catalog_items count before none — POST .../canonicalize must never create rows (AC4).
  const noneCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  // No catalog entry yet → none.
  const noneRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items/${item.id}/canonicalize`,
    cookies,
  });
  assert.equal(noneRes.statusCode, 200, noneRes.body);
  const noneResult = JSON.parse(noneRes.body);
  assert.equal(noneResult.match.status, "none");
  assert.equal(noneResult.item.catalogItemId, null, "item unchanged on none");
  assert.equal(noneResult.item.updatedAt, beforeItemUpdatedAt, "item updatedAt unchanged on none");
  // List updatedAt must be unchanged on none.
  const listAfterNone = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  assert.equal(listAfterNone.updatedAt, beforeListUpdatedAt, "list updatedAt unchanged on none");
  // AC4: count must not change.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    noneCountBefore,
    "POST .../canonicalize must not create catalog_items rows (none case)",
  );

  // Create a catalog entry "Basmati Rice" and try again → matched.
  await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "Basmati Rice" },
  });

  // Small sleep to ensure timestamps differ.
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  // Capture catalog_items count before matched canonicalize (AC4).
  const matchedCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  const matchRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items/${item.id}/canonicalize`,
    cookies,
  });
  assert.equal(matchRes.statusCode, 200, matchRes.body);
  const matchResult = JSON.parse(matchRes.body);
  assert.equal(matchResult.match.status, "matched");
  assert.ok(matchResult.item.catalogItemId, "catalogItemId must be set after match");
  // item.updatedAt must have bumped.
  assert.notEqual(matchResult.item.updatedAt, beforeItemUpdatedAt, "item updatedAt must bump on match");

  // List updatedAt must also have bumped.
  const listAfter = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  assert.notEqual(listAfter.updatedAt, beforeListUpdatedAt, "list updatedAt must bump on match");
  // AC4: count must not change on matched canonicalize.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    matchedCountBefore,
    "POST .../canonicalize must not create catalog_items rows (matched case)",
  );

  // Now seed ambiguous entries: add "basmati rice" (different case).
  await app.db.insert(catalogItems).values({ userId, canonicalName: "basmati rice" });

  // Add a second list item with rawText matching both entries.
  const addRes2 = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Basmati Rice" },
  });
  const item2 = (JSON.parse(addRes2.body) as { items: Array<{ id: string; catalogItemId: string | null; updatedAt: string }> })
    .items.at(-1)!;
  const beforeItem2UpdatedAt = item2.updatedAt;

  // Re-capture list updatedAt AFTER addRes2 (which legitimately bumps it) and
  // BEFORE the ambiguous canonicalize, so the assertion proves that canonicalize
  // itself does not bump the list.
  const listBeforeAmbig = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };

  // Capture catalog_items count before ambiguous canonicalize (AC4).
  const ambigCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  const ambigRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items/${item2.id}/canonicalize`,
    cookies,
  });
  assert.equal(ambigRes.statusCode, 200, ambigRes.body);
  const ambigResult = JSON.parse(ambigRes.body);
  assert.equal(ambigResult.match.status, "ambiguous");
  assert.equal(ambigResult.item.catalogItemId, null, "catalogItemId must NOT be set on ambiguous");
  // item2 updatedAt must be unchanged on ambiguous.
  assert.equal(ambigResult.item.updatedAt, beforeItem2UpdatedAt, "item2 updatedAt unchanged on ambiguous");
  // List updatedAt must be unchanged on ambiguous (still equal to the pre-ambiguous value).
  const listAfterAmbig = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  assert.equal(listAfterAmbig.updatedAt, listBeforeAmbig.updatedAt, "list updatedAt unchanged on ambiguous");
  // AC4: count must not change on ambiguous canonicalize.
  assert.equal(
    (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
    ambigCountBefore,
    "POST .../canonicalize must not create catalog_items rows (ambiguous case)",
  );
});

test("canonicalizeItem: IDOR — wrong listId → 404", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const list1Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "List 1" },
  });
  const list1 = JSON.parse(list1Res.body);

  const list2Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "List 2" },
  });
  const list2 = JSON.parse(list2Res.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list2.id}/items`,
    cookies,
    payload: { rawText: "Item in list2" },
  });
  const item = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!;

  // Use list1's URL to canonicalize list2's item → 404.
  const res = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list1.id}/items/${item.id}/canonicalize`,
    cookies,
  });
  assert.equal(res.statusCode, 404, `Expected 404 for cross-list canonicalize, got ${res.statusCode}`);
});

test("stale-match race: item lock serializes concurrent updateItem rawText change", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Set up: list + item with rawText "TargetItem", catalog entry "TargetItem".
  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Stale-match race list" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "TargetItem" },
  });
  const item = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!;

  await app.inject({
    method: "POST",
    url: "/api/shopping/catalog",
    cookies,
    payload: { canonicalName: "TargetItem" },
  });

  /**
   * Prove the item-row FOR UPDATE lock serializes a concurrent updateItem:
   * 1. Connection A holds the item row lock inside a tx.
   * 2. canonicalizeItem (connection B) blocks on the same lock.
   * 3. After 200ms, connection A changes rawText to "ChangedItem" and commits.
   * 4. canonicalizeItem sees rawText="ChangedItem" → no match → status:"none".
   *    (Proves it reads rawText under the item lock, not before acquiring it.)
   */
  const pgPool = app.pg as unknown as {
    connect(): Promise<{
      query(sql: string, params?: unknown[]): Promise<unknown>;
      release(): void;
    }>;
  };
  const lockConn = await pgPool.connect();

  try {
    await lockConn.query("BEGIN");
    await lockConn.query(
      "SELECT id FROM shopping_list_items WHERE id = $1 FOR UPDATE",
      [item.id],
    );

    let canonicalizeResolved = false;
    const canonicalizePromise = app.inject({
      method: "POST",
      url: `/api/shopping/lists/${list.id}/items/${item.id}/canonicalize`,
      cookies,
    }).then((r) => {
      canonicalizeResolved = true;
      return r;
    });

    // canonicalize should still be blocked after 200ms.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    assert.equal(
      canonicalizeResolved,
      false,
      "canonicalizeItem should block while item row is locked",
    );

    // Change rawText while holding the lock, then commit.
    await lockConn.query(
      "UPDATE shopping_list_items SET raw_text = 'ChangedItem', updated_at = now() WHERE id = $1",
      [item.id],
    );
    await lockConn.query("COMMIT");

    const canonicalizeRes = await canonicalizePromise;
    assert.equal(canonicalizeRes.statusCode, 200, canonicalizeRes.body);
    const result = JSON.parse(canonicalizeRes.body);
    // rawText was "ChangedItem" when canonicalize read it under the item lock.
    // "ChangedItem" has no catalog entry → none.
    assert.equal(result.match.status, "none", `Expected none but got ${result.match.status} (stale rawText was used instead of freshly-locked rawText)`);
  } finally {
    lockConn.release();
  }
});

test("demo session rejected on every catalog mutation AND canonicalize → 403", async (t) => {
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

  await assertDemo403("POST", "/api/shopping/catalog", { canonicalName: "x" });
  await assertDemo403("PUT", `/api/shopping/catalog/${fakeId}`, {
    canonicalName: "x",
    brand: null,
    categoryId: null,
    packQuantityBase: null,
    unit: null,
  });
  await assertDemo403("DELETE", `/api/shopping/catalog/${fakeId}`);
  await assertDemo403("POST", `/api/shopping/lists/${fakeId}/items/${fakeId}/canonicalize`);
});
