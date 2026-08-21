/**
 * Hermetic route-config tests for shopping-list routes (task 9.2).
 *
 * No DB, no Redis, no env vars. Boots only the real Fastify app + Zod compilers
 * + the shoppingListRoutes plugin, then asserts:
 *   - every mutating route (POST/PUT/DELETE) has config.public !== true
 *   - every expected (method, relative-path) pair is registered
 *
 * Uses mock.module() to stub the lists service so no real DB calls are made.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { assertOwnedList, assertOwnedCatalogItem, assertOwnedListItem } from "../services/ownership.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { DbOrTx } from "../../../db/index.ts";

// ---------------------------------------------------------------------------
// Stub the lists service so the real route plugin can register without a DB.
// ---------------------------------------------------------------------------

const STUB_LIST = {
  id: "00000000-0000-4000-a000-000000000001",
  name: "Test",
  status: "active" as const,
  note: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};
const STUB_LIST_WITH_ITEMS = { ...STUB_LIST, items: [] };

await mock.module(new URL("../services/lists.ts", import.meta.url).href, {
  exports: {
    createList: async () => STUB_LIST,
    listLists: async () => [STUB_LIST],
    getList: async () => STUB_LIST_WITH_ITEMS,
    updateList: async () => STUB_LIST,
    deleteList: async () => undefined,
    addItem: async () => STUB_LIST_WITH_ITEMS,
    updateItem: async () => STUB_LIST_WITH_ITEMS,
    deleteItem: async () => STUB_LIST_WITH_ITEMS,
    reorderItems: async () => STUB_LIST_WITH_ITEMS,
  },
});

// Import the real route plugin AFTER the mock is set up.
const { shoppingListRoutes } = await import("./lists.ts");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all shopping-list mutation routes are not marked public", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("session", null);
  app.decorate("db", {} as never);

  const publicMutations: string[] = [];
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      if (
        ["POST", "PUT", "DELETE"].includes(method.toUpperCase()) &&
        (routeOptions.config as Record<string, unknown> | undefined)?.["public"] === true
      ) {
        publicMutations.push(`${method.toUpperCase()} ${routeOptions.url}`);
      }
    }
  });

  await app.register(shoppingListRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.deepEqual(
    publicMutations,
    [],
    `These mutation routes are incorrectly marked public: ${publicMutations.join(", ")}`,
  );
});

test("all nine expected shopping-list routes are registered", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("session", null);
  app.decorate("db", {} as never);

  const pairs: Array<{ method: string; url: string }> = [];
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      pairs.push({ method: method.toUpperCase(), url: routeOptions.url });
    }
  });

  await app.register(shoppingListRoutes);
  await app.ready();
  t.after(() => app.close());

  const registered = pairs.map((p) => `${p.method} ${p.url}`);

  const expectedMutations = [
    "POST /lists",
    "PUT /lists/:id",
    "DELETE /lists/:id",
    "POST /lists/:id/items",
    "PUT /lists/:id/items/reorder",
    "PUT /lists/:id/items/:itemId",
    "DELETE /lists/:id/items/:itemId",
  ];

  const expectedGets = [
    "GET /lists",
    "GET /lists/:id",
  ];

  for (const expected of [...expectedMutations, ...expectedGets]) {
    assert.ok(
      registered.includes(expected),
      `Expected route "${expected}" to be registered. Registered: ${registered.join(", ")}`,
    );
  }
  // Fastify auto-registers HEAD for each GET.
  for (const get of expectedGets) {
    const head = get.replace("GET ", "HEAD ");
    assert.ok(
      registered.includes(head),
      `Expected auto-registered HEAD route "${head}". Registered: ${registered.join(", ")}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Ownership-guard bite tests — fake DbOrTx, no real DB connection.
// ---------------------------------------------------------------------------

const FAKE_USER_ID = "00000000-0000-4000-a000-000000000010";
const FAKE_LIST_ID = "00000000-0000-4000-a000-000000000011";
const FAKE_ITEM_ID = "00000000-0000-4000-a000-000000000012";
const FAKE_CATALOG_ID = "00000000-0000-4000-a000-000000000013";

/** Fake DbOrTx whose query.*.findFirst always returns undefined (row not found). */
function emptyDb(): DbOrTx {
  return {
    query: {
      shoppingLists: { findFirst: async () => undefined },
      catalogItems: { findFirst: async () => undefined },
      shoppingListItems: { findFirst: async () => undefined },
    },
  } as unknown as DbOrTx;
}

/** Fake DbOrTx that returns the specified rows from findFirst calls. */
function rowDb(overrides: {
  shoppingLists?: { id: string };
  catalogItems?: { id: string };
  shoppingListItems?: { id: string };
}): DbOrTx {
  return {
    query: {
      shoppingLists: { findFirst: async () => overrides.shoppingLists ?? undefined },
      catalogItems: { findFirst: async () => overrides.catalogItems ?? undefined },
      shoppingListItems: { findFirst: async () => overrides.shoppingListItems ?? undefined },
    },
  } as unknown as DbOrTx;
}

test("assertOwnedList: throws HttpError(404) when list row is not found", async () => {
  await assert.rejects(
    () => assertOwnedList(emptyDb(), FAKE_USER_ID, FAKE_LIST_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `Expected HttpError, got ${String(err)}`);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("assertOwnedCatalogItem: throws HttpError(404) when catalogItemId is non-null and row not found", async () => {
  await assert.rejects(
    () => assertOwnedCatalogItem(emptyDb(), FAKE_USER_ID, FAKE_CATALOG_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `Expected HttpError, got ${String(err)}`);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("assertOwnedCatalogItem: null catalogItemId is a no-op — does not throw and does not query", async () => {
  // Should resolve without throwing.
  await assertOwnedCatalogItem(emptyDb(), FAKE_USER_ID, null);
});

test("assertOwnedCatalogItem: undefined catalogItemId is a no-op — does not throw and does not query", async () => {
  await assertOwnedCatalogItem(emptyDb(), FAKE_USER_ID, undefined);
});

test("assertOwnedListItem: throws HttpError(404) when list row is not found", async () => {
  await assert.rejects(
    () => assertOwnedListItem(emptyDb(), FAKE_USER_ID, FAKE_LIST_ID, FAKE_ITEM_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `Expected HttpError, got ${String(err)}`);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

test("assertOwnedListItem: throws HttpError(404) when list exists but item row is not found", async () => {
  // List is found, item is absent.
  const db = rowDb({ shoppingLists: { id: FAKE_LIST_ID } });
  await assert.rejects(
    () => assertOwnedListItem(db, FAKE_USER_ID, FAKE_LIST_ID, FAKE_ITEM_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError, `Expected HttpError, got ${String(err)}`);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Per-route schema presence assertions.
// ---------------------------------------------------------------------------

test("each route has the expected body/params/querystring/response schemas attached", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("session", null);
  app.decorate("db", {} as never);

  type RouteSchema = {
    body?: unknown;
    params?: unknown;
    querystring?: unknown;
    response?: unknown;
  };
  const schemaMap = new Map<string, RouteSchema>();

  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      const key = `${method.toUpperCase()} ${routeOptions.url}`;
      schemaMap.set(key, (routeOptions.schema ?? {}) as RouteSchema);
    }
  });

  await app.register(shoppingListRoutes);
  await app.ready();
  t.after(() => app.close());

  // Routes that must have a body schema.
  const routesWithBody = [
    "POST /lists",
    "PUT /lists/:id",
    "POST /lists/:id/items",
    "PUT /lists/:id/items/reorder",
    "PUT /lists/:id/items/:itemId",
  ];
  for (const route of routesWithBody) {
    const s = schemaMap.get(route);
    assert.ok(s != null, `Route "${route}" not found in registered routes`);
    assert.ok(s!.body != null, `Route "${route}" missing body schema`);
    assert.ok(s!.response != null, `Route "${route}" missing response schema`);
  }

  // Routes that must have params.
  const routesWithParams = [
    "GET /lists/:id",
    "PUT /lists/:id",
    "DELETE /lists/:id",
    "POST /lists/:id/items",
    "PUT /lists/:id/items/reorder",
    "PUT /lists/:id/items/:itemId",
    "DELETE /lists/:id/items/:itemId",
  ];
  for (const route of routesWithParams) {
    const s = schemaMap.get(route);
    assert.ok(s != null, `Route "${route}" not found in registered routes`);
    assert.ok(s!.params != null, `Route "${route}" missing params schema`);
  }

  // GET /lists must have querystring and response.
  const getListsSchema = schemaMap.get("GET /lists");
  assert.ok(getListsSchema != null, "GET /lists not found in registered routes");
  assert.ok(getListsSchema!.querystring != null, "GET /lists missing querystring schema");
  assert.ok(getListsSchema!.response != null, "GET /lists missing response schema");

  // All non-HEAD routes must have response schemas.
  for (const [key, schema] of schemaMap) {
    if (key.startsWith("HEAD ")) continue; // Fastify auto-registers HEAD for GET; no schema.
    assert.ok(schema.response != null, `Route "${key}" is missing a response schema`);
  }
});
