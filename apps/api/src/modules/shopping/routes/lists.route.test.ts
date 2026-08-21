/**
 * Integration tests for shopping-list routes (task 9.2).
 *
 * Exercises the real HTTP layer (Fastify + Zod + the real auth hook), against a
 * real Postgres + Redis connection. DB-gated: requires DATABASE_URL, REDIS_URL,
 * SESSION_SECRET to be set.
 *
 * This file is modelled on modules/protection/routes/protection.route.test.ts
 * and modules/ledger/routes/user-tasks.route.test.ts.
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
import { catalogItems, shoppingListItems, shoppingLists } from "../schema.ts";
import { addItem, reorderItems, deleteItem } from "../services/lists.ts";

// DB-gated: fail fast if env vars are missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `lists.route.test.ts needs ${name} set — export it (see apps/api/.env) before running \`npm run test -w apps/api\`.`,
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
      email: `shopping-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "shopping.route.test.ts user",
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

// ── Tests ─────────────────────────────────────────────────────────────────────

test("unauthenticated request → 401", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/shopping/lists",
  });
  assert.equal(res.statusCode, 401);
});

test("demo session rejected on POST /api/shopping/lists → 403", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies: sessionCookie(sessionId),
    payload: { name: "Demo list" },
  });
  assert.equal(res.statusCode, 403, `Expected 403 but got ${res.statusCode}: ${res.body}`);
});

test("POST /lists → create, GET /lists → list, GET /lists/:id → get with items", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Create a list.
  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Weekly Groceries", note: "Don't forget oats" },
  });
  assert.equal(createRes.statusCode, 200, `Create failed: ${createRes.body}`);
  const list = JSON.parse(createRes.body);
  assert.equal(list.name, "Weekly Groceries");
  assert.equal(list.note, "Don't forget oats");
  assert.equal(list.status, "active");
  const listId: string = list.id;

  // List all lists.
  const listRes = await app.inject({
    method: "GET",
    url: "/api/shopping/lists",
    cookies,
  });
  assert.equal(listRes.statusCode, 200);
  const lists = JSON.parse(listRes.body);
  assert.ok(Array.isArray(lists));
  assert.ok(lists.some((l: { id: string }) => l.id === listId));

  // Get single list with items.
  const getRes = await app.inject({
    method: "GET",
    url: `/api/shopping/lists/${listId}`,
    cookies,
  });
  assert.equal(getRes.statusCode, 200);
  const got = JSON.parse(getRes.body);
  assert.equal(got.id, listId);
  assert.deepEqual(got.items, []);
});

test("PUT /lists/:id — full replace; omitting a field → 400", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Before" },
  });
  const list = JSON.parse(createRes.body);

  // Full PUT — success.
  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "After", note: "changed", status: "archived" },
  });
  assert.equal(putRes.statusCode, 200);
  const updated = JSON.parse(putRes.body);
  assert.equal(updated.name, "After");
  assert.equal(updated.status, "archived");

  // Omit status → 400.
  const badRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "After", note: null },
  });
  assert.equal(badRes.statusCode, 400, `Expected 400 for missing status, got ${badRes.statusCode}`);
});

test("archive/unarchive reversibility + ?status filter", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Archivable" },
  });
  const list = JSON.parse(createRes.body);

  // Archive it.
  await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "Archivable", note: null, status: "archived" },
  });

  // ?status=archived should include it.
  const archivedRes = await app.inject({
    method: "GET",
    url: "/api/shopping/lists?status=archived",
    cookies,
  });
  const archivedLists = JSON.parse(archivedRes.body);
  assert.ok(archivedLists.some((l: { id: string }) => l.id === list.id));

  // ?status=active should NOT include it.
  const activeRes = await app.inject({
    method: "GET",
    url: "/api/shopping/lists?status=active",
    cookies,
  });
  const activeLists = JSON.parse(activeRes.body);
  assert.ok(!activeLists.some((l: { id: string }) => l.id === list.id));

  // Re-activate (un-archive).
  await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "Archivable", note: null, status: "active" },
  });

  // Now ?status=active should include it again.
  const reactivatedRes = await app.inject({
    method: "GET",
    url: "/api/shopping/lists?status=active",
    cookies,
  });
  const reactivated = JSON.parse(reactivatedRes.body);
  assert.ok(reactivated.some((l: { id: string }) => l.id === list.id));
});

test("DELETE /lists/:id — cascades to items", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "To delete" },
  });
  const list = JSON.parse(createRes.body);

  // Add an item.
  await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Eggs" },
  });

  // Delete the list.
  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(JSON.parse(delRes.body).ok, true);

  // GET should 404.
  const getRes = await app.inject({
    method: "GET",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
  });
  assert.equal(getRes.statusCode, 404);
});

test("cross-owner list access → 404", async (t) => {
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

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies: cookies1,
    payload: { name: "User1 list" },
  });
  const list = JSON.parse(createRes.body);

  // User2 tries to access user1's list.
  const getRes = await app.inject({
    method: "GET",
    url: `/api/shopping/lists/${list.id}`,
    cookies: cookies2,
  });
  assert.equal(getRes.statusCode, 404);
});

test("add item (raw-text only), update item (PUT full replace), delete item", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Items test" },
  });
  const list = JSON.parse(createRes.body);

  // Add raw-text-only item.
  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Milk" },
  });
  assert.equal(addRes.statusCode, 200);
  const withItems = JSON.parse(addRes.body);
  assert.equal(withItems.items.length, 1);
  assert.equal(withItems.items[0].rawText, "Milk");
  assert.equal(withItems.items[0].catalogItemId, null);
  assert.equal(withItems.items[0].quantityBase, null);
  assert.equal(withItems.items[0].unit, null);
  const itemId: string = withItems.items[0].id;

  // PUT update with full required fields — change status to bought.
  const putItemRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: {
      rawText: "Milk",
      catalogItemId: null,
      quantityBase: null,
      unit: null,
      status: "bought",
    },
  });
  assert.equal(putItemRes.statusCode, 200);
  const updated = JSON.parse(putItemRes.body);
  assert.equal(updated.items[0].status, "bought");

  // PUT item — omit status → 400.
  const badRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: { rawText: "Milk", catalogItemId: null, quantityBase: null, unit: null },
  });
  assert.equal(badRes.statusCode, 400, `Expected 400 for missing status, got ${badRes.statusCode}`);

  // Delete item — leaves no items.
  const delItemRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
  });
  assert.equal(delItemRes.statusCode, 200);
  const afterDelete = JSON.parse(delItemRes.body);
  assert.equal(afterDelete.items.length, 0);
});

test("quantity/unit pairing — create item one-sided → 400; both-set → 200; clear via both-null PUT → 200", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Qty test" },
  });
  const list = JSON.parse(createRes.body);

  // One-sided → 400.
  const badCreate = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Milk", quantityBase: 500 },
  });
  assert.equal(badCreate.statusCode, 400);

  // Both-set → 200.
  const goodCreate = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Milk", quantityBase: 500, unit: "ml" },
  });
  assert.equal(goodCreate.statusCode, 200);
  const withItems = JSON.parse(goodCreate.body);
  const itemId: string = withItems.items[0].id;

  // Clear via both-null PUT → 200.
  const clearRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: {
      rawText: "Milk",
      catalogItemId: null,
      quantityBase: null,
      unit: null,
      status: "pending",
    },
  });
  assert.equal(clearRes.statusCode, 200);
  const cleared = JSON.parse(clearRes.body);
  assert.equal(cleared.items[0].quantityBase, null);
  assert.equal(cleared.items[0].unit, null);
});

test("reorder: exact set succeeds; duplicate id → 400 (schema); wrong count → 400; empty on empty → 200", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Reorder test" },
  });
  const list = JSON.parse(createRes.body);

  // Add two items.
  await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Item A" },
  });
  const add2 = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Item B" },
  });
  const items2 = JSON.parse(add2.body).items as Array<{ id: string }>;
  const [idA, idB] = [items2[0]!.id, items2[1]!.id];

  // Exact set — reversed order — success.
  const reorderRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [idB, idA] },
  });
  assert.equal(reorderRes.statusCode, 200, `Reorder failed: ${reorderRes.body}`);
  const reordered = JSON.parse(reorderRes.body);
  assert.equal(reordered.items[0].id, idB);
  assert.equal(reordered.items[1].id, idA);

  // Duplicate id — 400 at Zod boundary.
  const dupRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [idA, idA] },
  });
  assert.equal(dupRes.statusCode, 400);

  // Wrong count (3 ids for 2 items) → 400.
  const foreignId = "00000000-0000-4000-a000-000000000099";
  const wrongCountRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [idA, idB, foreignId] },
  });
  assert.equal(wrongCountRes.statusCode, 400);

  // Empty reorder on non-empty list → 400.
  const emptyOnNonEmptyRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [] },
  });
  assert.equal(emptyOnNonEmptyRes.statusCode, 400);

  // Empty reorder on empty list → 200.
  const emptyListRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Empty list" },
  });
  const emptyList = JSON.parse(emptyListRes.body);
  const emptyReorderRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${emptyList.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [] },
  });
  assert.equal(emptyReorderRes.statusCode, 200);
});

test("cross-list itemId → 404 (IDOR prevention)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  // Create two lists.
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

  // Add item to list 2.
  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list2.id}/items`,
    cookies,
    payload: { rawText: "Cross item" },
  });
  const item = JSON.parse(addRes.body).items[0] as { id: string };

  // Try to update the list2 item via list1's URL → 404.
  const crossPut = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list1.id}/items/${item.id}`,
    cookies,
    payload: {
      rawText: "Cross item",
      catalogItemId: null,
      quantityBase: null,
      unit: null,
      status: "bought",
    },
  });
  assert.equal(crossPut.statusCode, 404);

  // Try to delete the list2 item via list1's URL → 404.
  const crossDel = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list1.id}/items/${item.id}`,
    cookies,
  });
  assert.equal(crossDel.statusCode, 404);
});

test("append positions: each addItem appends at max+1 (0-based)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const createRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Position test" },
  });
  const list = JSON.parse(createRes.body);

  const add1 = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "First" },
  });
  const first = (JSON.parse(add1.body).items as Array<{ position: number }>)[0]!;
  assert.equal(first.position, 0);

  const add2 = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Second" },
  });
  const items = JSON.parse(add2.body).items as Array<{ position: number }>;
  assert.equal(items[1]!.position, 1);
});

// ── Iteration-2 additions ─────────────────────────────────────────────────────

// Item 1: Catalog ownership on ADD — four cases (a) valid, (b) other user's, (c) nonexistent, (d) null.
test("catalog ownership on ADD item — valid / cross-owner / nonexistent / null-unlink", async (t) => {
  const userAId = await createTestUser();
  const userBId = await createTestUser();
  const sessionAId = await createSession(app.redis, userAId);
  t.after(async () => {
    await destroySession(app.redis, sessionAId);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const cookiesA = sessionCookie(sessionAId);

  // Insert catalog items directly (no route exists yet to create them).
  const [catA] = await app.db
    .insert(catalogItems)
    .values({ userId: userAId, canonicalName: `Owned-${randomUUID()}` })
    .returning({ id: catalogItems.id });
  const [catB] = await app.db
    .insert(catalogItems)
    .values({ userId: userBId, canonicalName: `OtherUser-${randomUUID()}` })
    .returning({ id: catalogItems.id });

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies: cookiesA,
    payload: { name: "Catalog ownership ADD test" },
  });
  const list = JSON.parse(listRes.body);

  // (a) Valid owned catalogItemId → 200, item has catalogItemId set.
  const goodAdd = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies: cookiesA,
    payload: { rawText: "Rice", catalogItemId: catA!.id },
  });
  assert.equal(goodAdd.statusCode, 200, `(a) owned cat failed: ${goodAdd.body}`);
  const withCat = JSON.parse(goodAdd.body);
  assert.equal(withCat.items[0]!.catalogItemId, catA!.id);

  // (b) Other user's catalogItemId → 404, item NOT created.
  const beforeB = (JSON.parse(goodAdd.body) as { items: unknown[] }).items.length;
  const crossAdd = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies: cookiesA,
    payload: { rawText: "CrossItem", catalogItemId: catB!.id },
  });
  assert.equal(crossAdd.statusCode, 404, `(b) cross-owner cat should be 404`);
  const afterBRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies: cookiesA });
  assert.equal((JSON.parse(afterBRes.body) as { items: unknown[] }).items.length, beforeB, "(b) no item created");

  // (c) Nonexistent catalogItemId → 404, no write.
  const fakeId = randomUUID();
  const nonexistentAdd = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies: cookiesA,
    payload: { rawText: "Ghost", catalogItemId: fakeId },
  });
  assert.equal(nonexistentAdd.statusCode, 404, `(c) nonexistent cat should be 404`);
  const afterCRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies: cookiesA });
  assert.equal((JSON.parse(afterCRes.body) as { items: unknown[] }).items.length, beforeB, "(c) no item created");

  // (d) catalogItemId:null → 200 (unlink / raw-text only).
  const nullAdd = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies: cookiesA,
    payload: { rawText: "Plain item", catalogItemId: null },
  });
  assert.equal(nullAdd.statusCode, 200, `(d) null cat should succeed`);
  const newItems = (JSON.parse(nullAdd.body) as { items: Array<{ catalogItemId: string | null }> }).items;
  const lastItem = newItems[newItems.length - 1]!;
  assert.equal(lastItem.catalogItemId, null, "(d) item has null catalogItemId");
});

// Item 1 (continued): Catalog ownership on UPDATE item — four cases.
test("catalog ownership on UPDATE item — valid / cross-owner / nonexistent / null-unlink", async (t) => {
  const userAId = await createTestUser();
  const userBId = await createTestUser();
  const sessionAId = await createSession(app.redis, userAId);
  t.after(async () => {
    await destroySession(app.redis, sessionAId);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const cookiesA = sessionCookie(sessionAId);

  const [catA] = await app.db
    .insert(catalogItems)
    .values({ userId: userAId, canonicalName: `UpdateOwned-${randomUUID()}` })
    .returning({ id: catalogItems.id });
  const [catB] = await app.db
    .insert(catalogItems)
    .values({ userId: userBId, canonicalName: `UpdateOther-${randomUUID()}` })
    .returning({ id: catalogItems.id });

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies: cookiesA,
    payload: { name: "Catalog ownership UPDATE test" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies: cookiesA,
    payload: { rawText: "Initial item" },
  });
  const itemId = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!.id;

  const baseUpdate = {
    rawText: "Initial item",
    catalogItemId: null as string | null,
    quantityBase: null as number | null,
    unit: null as string | null,
    status: "pending" as const,
  };

  // (a) Valid owned catalogItemId → 200, item has catalogItemId set.
  const goodUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies: cookiesA,
    payload: { ...baseUpdate, catalogItemId: catA!.id },
  });
  assert.equal(goodUpdate.statusCode, 200, `(a) owned cat update failed: ${goodUpdate.body}`);
  const withCat = JSON.parse(goodUpdate.body) as { items: Array<{ catalogItemId: string | null }> };
  assert.equal(withCat.items[0]!.catalogItemId, catA!.id);

  // (b) Other user's catalogItemId → 404, item unchanged.
  const crossUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies: cookiesA,
    payload: { ...baseUpdate, catalogItemId: catB!.id },
  });
  assert.equal(crossUpdate.statusCode, 404, "(b) cross-owner cat update should be 404");
  const afterBRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies: cookiesA });
  const afterBItem = (JSON.parse(afterBRes.body) as { items: Array<{ catalogItemId: string | null }> }).items[0]!;
  assert.equal(afterBItem.catalogItemId, catA!.id, "(b) catalogItemId unchanged after failed update");

  // (c) Nonexistent catalogItemId → 404, item unchanged.
  const fakeId = randomUUID();
  const nonexistentUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies: cookiesA,
    payload: { ...baseUpdate, catalogItemId: fakeId },
  });
  assert.equal(nonexistentUpdate.statusCode, 404, "(c) nonexistent cat update should be 404");
  const afterCRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies: cookiesA });
  const afterCItem = (JSON.parse(afterCRes.body) as { items: Array<{ catalogItemId: string | null }> }).items[0]!;
  assert.equal(afterCItem.catalogItemId, catA!.id, "(c) catalogItemId unchanged after failed update");

  // (d) catalogItemId:null → 200 (unlink).
  const unlinkUpdate = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies: cookiesA,
    payload: { ...baseUpdate, catalogItemId: null },
  });
  assert.equal(unlinkUpdate.statusCode, 200, "(d) null unlink should succeed");
  const afterDItem = (JSON.parse(unlinkUpdate.body) as { items: Array<{ catalogItemId: string | null }> }).items[0]!;
  assert.equal(afterDItem.catalogItemId, null, "(d) catalogItemId is null after unlink");
});

// Item 2: Item UPDATE one-sided quantity/unit → 400, no write.
test("item UPDATE one-sided quantity/unit → 400, item unchanged", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Update pairing test" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Test item" },
  });
  const itemId = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!.id;

  // quantityBase set, unit null → 400 (pairing violation at Zod boundary).
  const badRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: {
      rawText: "Test item",
      catalogItemId: null,
      quantityBase: 500,
      unit: null,
      status: "pending",
    },
  });
  assert.equal(badRes.statusCode, 400, `Expected 400 for one-sided qty/unit, got ${badRes.statusCode}`);

  // Mirror case: quantityBase null, unit set → 400 (pairing violation at Zod boundary).
  const badRes2 = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: {
      rawText: "Test item",
      catalogItemId: null,
      quantityBase: null,
      unit: "g",
      status: "pending",
    },
  });
  assert.equal(badRes2.statusCode, 400, `Expected 400 for mirror one-sided qty/unit (unit set, qty null), got ${badRes2.statusCode}`);

  // Re-query: item unchanged after both failed updates.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const items = (JSON.parse(getRes.body) as { items: Array<{ quantityBase: number | null; unit: string | null }> }).items;
  assert.equal(items[0]!.quantityBase, null, "quantityBase unchanged after failed updates");
  assert.equal(items[0]!.unit, null, "unit unchanged after failed updates");
});

// Item 3a: Reorder — assert actual numeric positions are 0..n-1.
test("reorder: positions set to 0..n-1 in the new order", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Position value test" },
  });
  const list = JSON.parse(listRes.body);

  // Add three items.
  let lastAdd: { items: Array<{ id: string; position: number }> } = { items: [] };
  for (const text of ["A", "B", "C"]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/shopping/lists/${list.id}/items`,
      cookies,
      payload: { rawText: text },
    });
    lastAdd = JSON.parse(res.body) as typeof lastAdd;
  }
  const [idA, idB, idC] = lastAdd.items.map((i) => i.id);

  // Reorder as C, A, B.
  const reorderRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [idC, idA, idB] },
  });
  assert.equal(reorderRes.statusCode, 200, `Reorder failed: ${reorderRes.body}`);
  const reordered = JSON.parse(reorderRes.body) as { items: Array<{ id: string; position: number }> };

  // Positions must be exactly 0, 1, 2 in the new id order.
  assert.equal(reordered.items[0]!.id, idC);
  assert.equal(reordered.items[0]!.position, 0, "first item position must be 0");
  assert.equal(reordered.items[1]!.id, idA);
  assert.equal(reordered.items[1]!.position, 1, "second item position must be 1");
  assert.equal(reordered.items[2]!.id, idB);
  assert.equal(reordered.items[2]!.position, 2, "third item position must be 2");
});

// Item 3b+3c: Reorder with equal-cardinality but one foreign id → 404, all positions unchanged.
test("reorder: equal-cardinality with one foreign id → 404 and all positions unchanged", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Foreign id reorder test" },
  });
  const list = JSON.parse(listRes.body);

  await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Item 1" },
  });
  const add2Res = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Item 2" },
  });
  const items = (JSON.parse(add2Res.body) as { items: Array<{ id: string; position: number }> }).items;
  const [realId1, realId2] = [items[0]!.id, items[1]!.id];
  const originalPositions = [items[0]!.position, items[1]!.position];

  // Send exactly 2 ids, but replace the second with a foreign id.
  const foreignId = randomUUID();
  const badReorder = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [realId1, foreignId] },
  });
  assert.equal(badReorder.statusCode, 404, `Expected 404 for foreign id reorder, got ${badReorder.statusCode}: ${badReorder.body}`);

  // Re-query: positions must be unchanged.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const afterItems = (JSON.parse(getRes.body) as { items: Array<{ id: string; position: number }> }).items;
  assert.equal(afterItems[0]!.id, realId1);
  assert.equal(afterItems[0]!.position, originalPositions[0], "position of item 1 must be unchanged");
  assert.equal(afterItems[1]!.id, realId2);
  assert.equal(afterItems[1]!.position, originalPositions[1], "position of item 2 must be unchanged");

  // Variant: use a REAL item id belonging to a DIFFERENT list owned by the same user.
  // Create a second list and add one item to it.
  const list2Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Other list for foreign id variant" },
  });
  const list2 = JSON.parse(list2Res.body);
  const list2AddRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list2.id}/items`,
    cookies,
    payload: { rawText: "Item from other list" },
  });
  const list2ItemId = (JSON.parse(list2AddRes.body) as { items: Array<{ id: string }> }).items[0]!.id;

  // Send [realId1, list2ItemId] — equal cardinality to list-1's 2 items, but list2ItemId is foreign.
  const badReorder2 = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [realId1, list2ItemId] },
  });
  assert.equal(badReorder2.statusCode, 404, `Expected 404 for real other-list item id reorder, got ${badReorder2.statusCode}: ${badReorder2.body}`);

  // Re-query list-1: positions must still be unchanged.
  const getRes2 = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const afterItems2 = (JSON.parse(getRes2.body) as { items: Array<{ id: string; position: number }> }).items;
  assert.equal(afterItems2[0]!.id, realId1);
  assert.equal(afterItems2[0]!.position, originalPositions[0], "position of item 1 must be unchanged after real-foreign-id reorder");
  assert.equal(afterItems2[1]!.id, realId2);
  assert.equal(afterItems2[1]!.position, originalPositions[1], "position of item 2 must be unchanged after real-foreign-id reorder");
});

// Item 3d: Empty orderedIds on non-empty list → 400, no write.
test("reorder: empty orderedIds on non-empty list → 400, positions unchanged", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Empty reorder non-empty test" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Only item" },
  });
  const beforePos = (JSON.parse(addRes.body) as { items: Array<{ position: number }> }).items[0]!.position;

  const emptyReorder = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/reorder`,
    cookies,
    payload: { orderedIds: [] },
  });
  assert.equal(emptyReorder.statusCode, 400, `Expected 400 for empty reorder on non-empty list`);

  // Position unchanged.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const afterPos = (JSON.parse(getRes.body) as { items: Array<{ position: number }> }).items[0]!.position;
  assert.equal(afterPos, beforePos, "position unchanged after failed empty reorder");
});

// Item 4: Concurrency — prove parent row FOR UPDATE lock serializes add, reorder, and delete.
// NOTE: This test uses a 200ms bounded wait to assert the competing operation is still pending while
// the lock is held. This is inherently timing-dependent; on very slow machines the assertion could
// be flaky. The design follows the delegation's specification for proving lock serialization.
test("concurrency: parent row FOR UPDATE lock serializes add, reorder, and delete", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  /**
   * Acquire a FOR UPDATE row lock on `listId` using a dedicated pool connection
   * (connection A), then start `op()` which will block waiting for the same lock
   * (on connection B, via app.db.transaction). Assert op is still pending after
   * 200ms, then COMMIT on connection A and return the resolved result of op.
   *
   * Limitation: relies on 200ms being long enough for op to start its transaction
   * and reach the lock wait. This is a timing-based proof; see DELEGATION.md.
   */
  async function proveBlocks<T>(listId: string, op: () => Promise<T>): Promise<T> {
    // Use app.pg (pg.Pool) to check out a dedicated connection that holds the lock.
    const pgPool = app.pg as unknown as { connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<unknown>; release(): void }> };
    const lockConn = await pgPool.connect();
    try {
      await lockConn.query("BEGIN");
      await lockConn.query("SELECT id FROM shopping_lists WHERE id = $1 FOR UPDATE", [listId]);

      // Start the competing operation. It will try to open a tx and SELECT ... FOR UPDATE
      // the same row, which blocks until we COMMIT below.
      let opResolved = false;
      const opPromise = op().then((r) => {
        opResolved = true;
        return r;
      });

      // Give the operation 200ms to complete. It should NOT have resolved yet.
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      assert.equal(
        opResolved,
        false,
        `Operation resolved before the FOR UPDATE lock was released on list ${listId}`,
      );

      // Release the lock — op can now acquire it and proceed.
      await lockConn.query("COMMIT");
      return opPromise;
    } finally {
      lockConn.release();
    }
  }

  // ── Sub-test 1: add-vs-lock ──────────────────────────────────────────────────
  const l1Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Concurrency add" },
  });
  const l1 = JSON.parse(l1Res.body);

  const addResult = await proveBlocks(
    l1.id,
    () => addItem(app.db, userId, l1.id, { rawText: "Blocked add" }),
  );
  assert.equal(addResult.items.length, 1, "addItem completed with one item after lock released");
  assert.equal(addResult.items[0]!.rawText, "Blocked add");

  // ── Sub-test 2: reorder-vs-lock ───────────────────────────────────────────────
  const l2Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Concurrency reorder" },
  });
  const l2 = JSON.parse(l2Res.body);

  await app.inject({ method: "POST", url: `/api/shopping/lists/${l2.id}/items`, cookies, payload: { rawText: "Item A" } });
  const add2Res = await app.inject({ method: "POST", url: `/api/shopping/lists/${l2.id}/items`, cookies, payload: { rawText: "Item B" } });
  const items2 = (JSON.parse(add2Res.body) as { items: Array<{ id: string }> }).items;
  const [idA, idB] = [items2[0]!.id, items2[1]!.id];

  const reorderResult = await proveBlocks(
    l2.id,
    () => reorderItems(app.db, userId, l2.id, { orderedIds: [idB!, idA!] }),
  );
  assert.equal(reorderResult.items[0]!.id, idB, "reorder completed with reversed ids after lock released");
  assert.equal(reorderResult.items[1]!.id, idA);

  // ── Sub-test 3: delete-vs-lock ────────────────────────────────────────────────
  const l3Res = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Concurrency delete" },
  });
  const l3 = JSON.parse(l3Res.body);

  const add3Res = await app.inject({ method: "POST", url: `/api/shopping/lists/${l3.id}/items`, cookies, payload: { rawText: "To delete" } });
  const item3Id = (JSON.parse(add3Res.body) as { items: Array<{ id: string }> }).items[0]!.id;

  const deleteResult = await proveBlocks(
    l3.id,
    () => deleteItem(app.db, userId, l3.id, item3Id),
  );
  assert.equal(deleteResult.items.length, 0, "deleteItem completed with no remaining items after lock released");
});

// Item 5: Demo session rejected on EVERY mutation route → 403.
test("demo session rejected on every shopping mutation route → 403", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId, { demo: true });
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);
  const fakeId = randomUUID();
  const fakeItemId = randomUUID();

  // Helper to inject a mutation and assert 403.
  async function assertDemo403(method: "POST" | "PUT" | "DELETE", url: string, payload?: object): Promise<void> {
    // Cast the result explicitly to avoid TypeScript narrowing the inject overload to Chain.
    const res = await (app.inject({ method, url, cookies, payload }) as Promise<{ statusCode: number; body: string }>);
    assert.equal(res.statusCode, 403, `Expected 403 for demo on ${method} ${url}, got ${res.statusCode}: ${res.body}`);
  }

  await assertDemo403("POST", "/api/shopping/lists", { name: "x" });
  await assertDemo403("PUT", `/api/shopping/lists/${fakeId}`, { name: "x", note: null, status: "active" });
  await assertDemo403("DELETE", `/api/shopping/lists/${fakeId}`);
  await assertDemo403("POST", `/api/shopping/lists/${fakeId}/items`, { rawText: "x" });
  await assertDemo403("PUT", `/api/shopping/lists/${fakeId}/items/${fakeItemId}`, { rawText: "x", catalogItemId: null, quantityBase: null, unit: null, status: "pending" });
  await assertDemo403("DELETE", `/api/shopping/lists/${fakeId}/items/${fakeItemId}`);
  await assertDemo403("PUT", `/api/shopping/lists/${fakeId}/items/reorder`, { orderedIds: [] });
});

// Item 6a: Deterministic list ordering — status ASC, updatedAt DESC, id ASC.
test("list ordering: status ASC, updatedAt DESC, id ASC", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);
  const base = new Date();
  const older = new Date(base.getTime() - 20000);
  const newer = new Date(base.getTime() - 10000);
  // Use a fixed timestamp for the tie-break pair so both rows have EXACTLY equal updatedAt.
  const tieAt = new Date(base.getTime() - 5000);

  // Insert lists directly to control updatedAt precisely.
  // The tie-break pair uses fixed UUIDs so we can assert id ASC order deterministically.
  const tieIdLow = "a0000000-0000-4000-a000-000000000001";
  const tieIdHigh = "b0000000-0000-4000-a000-000000000001";
  const rows = await app.db
    .insert(shoppingLists)
    .values([
      { userId, name: "Active Older", status: "active" as const, updatedAt: older },
      { userId, name: "Active Newer", status: "active" as const, updatedAt: newer },
      { userId, name: "Archived Newer", status: "archived" as const, updatedAt: newer },
      // Tie-break pair: same status (active), same updatedAt — must appear in id ASC order.
      { id: tieIdLow, userId, name: "Tie Low", status: "active" as const, updatedAt: tieAt },
      { id: tieIdHigh, userId, name: "Tie High", status: "active" as const, updatedAt: tieAt },
    ])
    .returning({ id: shoppingLists.id, name: shoppingLists.name });

  const idActiveOlder = rows[0]!.id;
  const idActiveNewer = rows[1]!.id;
  const idArchivedNewer = rows[2]!.id;

  const listRes = await app.inject({ method: "GET", url: "/api/shopping/lists", cookies });
  assert.equal(listRes.statusCode, 200);
  const all = JSON.parse(listRes.body) as Array<{ id: string }>;
  const createdIds = new Set([idActiveOlder, idActiveNewer, idArchivedNewer]);
  const relevant = all.filter((l) => createdIds.has(l.id));

  assert.equal(relevant.length, 3, "all three inserted lists must appear");
  // Expected: active/newer, active/older, archived/newer
  assert.equal(relevant[0]!.id, idActiveNewer, "1st: active with newer updatedAt");
  assert.equal(relevant[1]!.id, idActiveOlder, "2nd: active with older updatedAt");
  assert.equal(relevant[2]!.id, idArchivedNewer, "3rd: archived (regardless of updatedAt)");

  // Tie-break: tieIdLow and tieIdHigh are both active with equal updatedAt (tieAt).
  // They must appear with tieIdLow before tieIdHigh (id ASC).
  const tieIds = new Set([tieIdLow, tieIdHigh]);
  const tiePair = all.filter((l) => tieIds.has(l.id));
  assert.equal(tiePair.length, 2, "both tie-break lists must appear");
  assert.equal(tiePair[0]!.id, tieIdLow, "tie-break: lower id must appear first (id ASC)");
  assert.equal(tiePair[1]!.id, tieIdHigh, "tie-break: higher id must appear second (id ASC)");
});

// Item 6b: Item ordering with duplicate positions — position ASC, id ASC.
test("item ordering with duplicate positions: position ASC, id ASC", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Item ordering test" },
  });
  const list = JSON.parse(listRes.body);

  // Insert items with explicit IDs and positions so we control the sort order.
  // lowId < highId lexicographically; both get position 0.
  const lowId = "10000000-0000-4000-a000-000000000001";
  const highId = "20000000-0000-4000-a000-000000000001";
  await app.db.insert(shoppingListItems).values([
    { id: highId, listId: list.id, rawText: "High UUID", position: 0 },
    { id: lowId, listId: list.id, rawText: "Low UUID", position: 0 },
  ]);
  // Insert a third item at position 1.
  const posOneId = "30000000-0000-4000-a000-000000000001";
  await app.db.insert(shoppingListItems).values([
    { id: posOneId, listId: list.id, rawText: "Position 1 item", position: 1 },
  ]);

  const getRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const items = (JSON.parse(getRes.body) as { items: Array<{ id: string; position: number }> }).items;

  // Filter to just our inserted items.
  const ours = items.filter((i) => [lowId, highId, posOneId].includes(i.id));
  assert.equal(ours.length, 3);
  // Both position-0 items come before position-1 item, ordered by id ASC.
  assert.equal(ours[0]!.id, lowId, "lowId should be first (position 0, lower UUID)");
  assert.equal(ours[1]!.id, highId, "highId should be second (position 0, higher UUID)");
  assert.equal(ours[2]!.id, posOneId, "posOneId should be third (position 1)");
});

// Item 7: Delete item leaves position gaps (no compaction).
test("delete item leaves position gaps — remaining positions are NOT compacted", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Delete gaps test" },
  });
  const list = JSON.parse(listRes.body);

  let lastItems: Array<{ id: string; position: number }> = [];
  for (const text of ["Item 0", "Item 1", "Item 2"]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/shopping/lists/${list.id}/items`,
      cookies,
      payload: { rawText: text },
    });
    lastItems = (JSON.parse(res.body) as { items: Array<{ id: string; position: number }> }).items;
  }

  // Items should be at positions 0, 1, 2.
  assert.equal(lastItems[0]!.position, 0);
  assert.equal(lastItems[1]!.position, 1);
  assert.equal(lastItems[2]!.position, 2);

  const middleItemId = lastItems[1]!.id;

  // Delete the middle item (position 1).
  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list.id}/items/${middleItemId}`,
    cookies,
  });
  assert.equal(delRes.statusCode, 200);
  const remaining = (JSON.parse(delRes.body) as { items: Array<{ id: string; position: number }> }).items;

  assert.equal(remaining.length, 2, "two items remain");
  // Positions must NOT be compacted: 0 and 2, not 0 and 1.
  assert.equal(remaining[0]!.position, 0, "first remaining item is still at position 0");
  assert.equal(remaining[1]!.position, 2, "second remaining item is still at position 2 (no compaction)");
});

// Item 8: Default listing returns BOTH active and archived.
test("GET /lists default returns both active and archived lists", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const activeRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Active list" },
  });
  const activeList = JSON.parse(activeRes.body);

  const archivedCreateRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Archived list" },
  });
  const archivedList = JSON.parse(archivedCreateRes.body);

  // Archive the second list.
  await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${archivedList.id}`,
    cookies,
    payload: { name: "Archived list", note: null, status: "archived" },
  });

  // Default listing (no filter) must include both.
  const defaultRes = await app.inject({ method: "GET", url: "/api/shopping/lists", cookies });
  const defaultLists = JSON.parse(defaultRes.body) as Array<{ id: string }>;
  assert.ok(defaultLists.some((l) => l.id === activeList.id), "active list must appear in default listing");
  assert.ok(defaultLists.some((l) => l.id === archivedList.id), "archived list must appear in default listing");

  // ?status=active must include only active.
  const activeFilterRes = await app.inject({ method: "GET", url: "/api/shopping/lists?status=active", cookies });
  const activeLists = JSON.parse(activeFilterRes.body) as Array<{ id: string }>;
  assert.ok(activeLists.some((l) => l.id === activeList.id), "active list in ?status=active");
  assert.ok(!activeLists.some((l) => l.id === archivedList.id), "archived list NOT in ?status=active");

  // ?status=archived must include only archived.
  const archivedFilterRes = await app.inject({ method: "GET", url: "/api/shopping/lists?status=archived", cookies });
  const archivedLists = JSON.parse(archivedFilterRes.body) as Array<{ id: string }>;
  assert.ok(!archivedLists.some((l) => l.id === activeList.id), "active list NOT in ?status=archived");
  assert.ok(archivedLists.some((l) => l.id === archivedList.id), "archived list in ?status=archived");
});

// Item 9: Archived list is readable and mutable; status:active un-archives.
test("archived list is readable, mutable, and can be un-archived via status:active", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "To archive" },
  });
  const list = JSON.parse(listRes.body);
  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Before archive" },
  });
  const itemId = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!.id;

  // Archive.
  await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "To archive", note: null, status: "archived" },
  });

  // Readable: GET returns 200.
  const getArchived = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  assert.equal(getArchived.statusCode, 200, "archived list must be readable");
  assert.equal((JSON.parse(getArchived.body) as { status: string }).status, "archived");

  // Mutable: rename while archived.
  const renameRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "Renamed while archived", note: null, status: "archived" },
  });
  assert.equal(renameRes.statusCode, 200, "archived list must be mutable");
  assert.equal((JSON.parse(renameRes.body) as { name: string }).name, "Renamed while archived");

  // Mutable: add item while archived.
  const addArchivedRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Added while archived" },
  });
  assert.equal(addArchivedRes.statusCode, 200, "can add items to archived list");

  // Mutable: update item while archived.
  const updateArchivedRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: { rawText: "Updated while archived", catalogItemId: null, quantityBase: null, unit: null, status: "bought" },
  });
  assert.equal(updateArchivedRes.statusCode, 200, "can update items on archived list");

  // Un-archive via status:active.
  const unarchiveRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "Renamed while archived", note: null, status: "active" },
  });
  assert.equal(unarchiveRes.statusCode, 200, "can un-archive list via status:active");
  assert.equal((JSON.parse(unarchiveRes.body) as { status: string }).status, "active");
});

// Item 10: Cross-owner UPDATE, DELETE, ADD-item, REORDER → 404 + no write.
test("cross-owner operations on list and items → 404 and no write", async (t) => {
  const userAId = await createTestUser();
  const userBId = await createTestUser();
  const sessionAId = await createSession(app.redis, userAId);
  const sessionBId = await createSession(app.redis, userBId);
  t.after(async () => {
    await destroySession(app.redis, sessionAId);
    await destroySession(app.redis, sessionBId);
    await cleanupUser(userAId);
    await cleanupUser(userBId);
  });

  const cookiesA = sessionCookie(sessionAId);
  const cookiesB = sessionCookie(sessionBId);

  // User A creates a list with two items.
  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies: cookiesA,
    payload: { name: "User A list" },
  });
  const listA = JSON.parse(listRes.body);

  await app.inject({ method: "POST", url: `/api/shopping/lists/${listA.id}/items`, cookies: cookiesA, payload: { rawText: "Item 1" } });
  const add2 = await app.inject({ method: "POST", url: `/api/shopping/lists/${listA.id}/items`, cookies: cookiesA, payload: { rawText: "Item 2" } });
  const itemsA = (JSON.parse(add2.body) as { items: Array<{ id: string }> }).items;
  const [itemA1Id, itemA2Id] = [itemsA[0]!.id, itemsA[1]!.id];

  // Snapshot list A state before B's attacks.
  const snapRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${listA.id}`, cookies: cookiesA });
  const snapshot = JSON.parse(snapRes.body) as { name: string; status: string; items: Array<{ id: string; rawText: string; position: number; status: string }> };

  // B tries to UPDATE list A → 404.
  const bUpdateList = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${listA.id}`,
    cookies: cookiesB,
    payload: { name: "Hijacked", note: null, status: "active" },
  });
  assert.equal(bUpdateList.statusCode, 404, "B updating A's list should be 404");

  // B tries to DELETE list A → 404.
  const bDeleteList = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${listA.id}`,
    cookies: cookiesB,
  });
  assert.equal(bDeleteList.statusCode, 404, "B deleting A's list should be 404");

  // B tries to ADD an item to list A → 404.
  const bAddItem = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${listA.id}/items`,
    cookies: cookiesB,
    payload: { rawText: "B's injected item" },
  });
  assert.equal(bAddItem.statusCode, 404, "B adding to A's list should be 404");

  // B tries to REORDER list A's items → 404.
  const bReorder = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${listA.id}/items/reorder`,
    cookies: cookiesB,
    payload: { orderedIds: [itemA2Id, itemA1Id] },
  });
  assert.equal(bReorder.statusCode, 404, "B reordering A's items should be 404");

  // B tries to UPDATE an item in list A → 404.
  const bUpdateItem = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${listA.id}/items/${itemA1Id}`,
    cookies: cookiesB,
    payload: { rawText: "Hijacked item", catalogItemId: null, quantityBase: null, unit: null, status: "bought" },
  });
  assert.equal(bUpdateItem.statusCode, 404, "B updating A's item should be 404");

  // B tries to DELETE an item from list A → 404.
  const bDeleteItem = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${listA.id}/items/${itemA1Id}`,
    cookies: cookiesB,
  });
  assert.equal(bDeleteItem.statusCode, 404, "B deleting A's item should be 404");

  // Re-query as user A to confirm list is completely unchanged.
  const afterRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${listA.id}`, cookies: cookiesA });
  assert.equal(afterRes.statusCode, 200, "A's list must still be accessible");
  const afterState = JSON.parse(afterRes.body) as typeof snapshot;
  assert.equal(afterState.name, snapshot.name, "list name unchanged");
  assert.equal(afterState.status, snapshot.status, "list status unchanged");
  assert.equal(afterState.items.length, snapshot.items.length, "item count unchanged");
  // Full items array: same id ORDER, same positions, same rawText, same status for every item.
  for (let i = 0; i < snapshot.items.length; i++) {
    const expected = snapshot.items[i]!;
    const actual = afterState.items[i]!;
    assert.equal(actual.id, expected.id, `items[${i}].id unchanged`);
    assert.equal(actual.rawText, expected.rawText, `items[${i}].rawText unchanged`);
    assert.equal(actual.position, expected.position, `items[${i}].position unchanged`);
    assert.equal(actual.status, expected.status, `items[${i}].status unchanged`);
  }
});

// Item 11: Cascade — DELETE /lists/:id removes child items from shoppingListItems.
test("DELETE /lists/:id removes all child items from shoppingListItems (DB cascade verified)", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Cascade test" },
  });
  const list = JSON.parse(listRes.body);

  // Add two items.
  for (const text of ["Item A", "Item B"]) {
    await app.inject({
      method: "POST",
      url: `/api/shopping/lists/${list.id}/items`,
      cookies,
      payload: { rawText: text },
    });
  }

  // Delete the list.
  const delRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
  });
  assert.equal(delRes.statusCode, 200);

  // Directly query shoppingListItems for the deleted list — must be zero rows.
  const orphanedItems = await app.db.query.shoppingListItems.findMany({
    where: eq(shoppingListItems.listId, list.id),
  });
  assert.equal(orphanedItems.length, 0, "all child items must be removed by cascade");
});

// Item 12: updatedAt is bumped on every list and item write.
test("updatedAt is bumped after item add, item update, item delete, and list PUT", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "updatedAt test" },
  });
  const list = JSON.parse(listRes.body);

  // Capture initial list updatedAt.
  const getInitial = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const t0 = new Date((JSON.parse(getInitial.body) as { updatedAt: string }).updatedAt).getTime();

  // Wait 5ms to ensure timestamp can differ.
  await new Promise<void>((r) => setTimeout(r, 5));

  // Add item — list updatedAt must increase.
  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Item" },
  });
  const t1 = new Date((JSON.parse(addRes.body) as { updatedAt: string }).updatedAt).getTime();
  assert.ok(t1 > t0, `updatedAt must increase after addItem (t0=${t0}, t1=${t1})`);
  const itemId = (JSON.parse(addRes.body) as { items: Array<{ id: string }> }).items[0]!.id;

  await new Promise<void>((r) => setTimeout(r, 5));

  // Update item — list updatedAt must increase.
  const updateRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
    payload: { rawText: "Updated item", catalogItemId: null, quantityBase: null, unit: null, status: "bought" },
  });
  const t2 = new Date((JSON.parse(updateRes.body) as { updatedAt: string }).updatedAt).getTime();
  assert.ok(t2 > t1, `updatedAt must increase after updateItem (t1=${t1}, t2=${t2})`);

  await new Promise<void>((r) => setTimeout(r, 5));

  // Delete item — list updatedAt must increase.
  const deleteRes = await app.inject({
    method: "DELETE",
    url: `/api/shopping/lists/${list.id}/items/${itemId}`,
    cookies,
  });
  const t3 = new Date((JSON.parse(deleteRes.body) as { updatedAt: string }).updatedAt).getTime();
  assert.ok(t3 > t2, `updatedAt must increase after deleteItem (t2=${t2}, t3=${t3})`);

  await new Promise<void>((r) => setTimeout(r, 5));

  // List PUT — list updatedAt must increase.
  const putRes = await app.inject({
    method: "PUT",
    url: `/api/shopping/lists/${list.id}`,
    cookies,
    payload: { name: "Renamed", note: "a note", status: "active" },
  });
  const t4 = new Date((JSON.parse(putRes.body) as { updatedAt: string }).updatedAt).getTime();
  assert.ok(t4 > t3, `updatedAt must increase after list PUT (t3=${t3}, t4=${t4})`);
});

// Item 13: Raw-text-only item persists with all optional fields null.
test("raw-text-only item (no catalogItemId, no quantity, no unit) persists via POST items", async (t) => {
  const userId = await createTestUser();
  const sessionId = await createSession(app.redis, userId);
  t.after(async () => {
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const cookies = sessionCookie(sessionId);

  const listRes = await app.inject({
    method: "POST",
    url: "/api/shopping/lists",
    cookies,
    payload: { name: "Raw text test" },
  });
  const list = JSON.parse(listRes.body);

  const addRes = await app.inject({
    method: "POST",
    url: `/api/shopping/lists/${list.id}/items`,
    cookies,
    payload: { rawText: "Plain oats" },
  });
  assert.equal(addRes.statusCode, 200, `Raw-text-only item failed: ${addRes.body}`);
  const result = JSON.parse(addRes.body) as { items: Array<{ rawText: string; catalogItemId: string | null; quantityBase: number | null; unit: string | null }> };
  const item = result.items[0]!;
  assert.equal(item.rawText, "Plain oats");
  assert.equal(item.catalogItemId, null, "catalogItemId must be null");
  assert.equal(item.quantityBase, null, "quantityBase must be null");
  assert.equal(item.unit, null, "unit must be null");

  // Verify persisted via a fresh GET.
  const getRes = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
  const persisted = (JSON.parse(getRes.body) as { items: Array<{ rawText: string }> }).items[0]!;
  assert.equal(persisted.rawText, "Plain oats", "raw text persists after GET");
});
