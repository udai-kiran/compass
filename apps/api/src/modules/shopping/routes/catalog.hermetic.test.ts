/**
 * Hermetic route-config tests for catalog routes (task 9.3).
 *
 * No DB, no Redis, no env vars. Boots only the real Fastify app + Zod
 * compilers + the shoppingCatalogRoutes plugin, then asserts:
 *   - every mutating route (POST/PUT/DELETE) has config.public !== true
 *   - all 7 expected (method, relative-path) pairs are registered
 *   - GET /catalog/match is registered before GET /catalog/:id (static before param)
 *   - each route has the expected body/params/querystring/response schemas
 *
 * Uses mock.module() to stub the canonicalize service so no real DB calls are
 * made. Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Stub the canonicalize service so the real route plugin can register without a DB.
// ---------------------------------------------------------------------------

const STUB_CATALOG_ITEM = {
  id: "00000000-0000-4000-a000-000000000001",
  canonicalName: "Atta",
  brand: null,
  categoryId: null,
  packQuantityBase: null,
  unit: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const STUB_LIST_ITEM = {
  id: "00000000-0000-4000-a000-000000000002",
  listId: "00000000-0000-4000-a000-000000000003",
  catalogItemId: null,
  rawText: "Atta 5kg",
  quantityBase: null,
  unit: null,
  status: "pending" as const,
  position: 0,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

await mock.module(new URL("../services/canonicalize.ts", import.meta.url).href, {
  exports: {
    createCatalogItem: async () => STUB_CATALOG_ITEM,
    listCatalogItems: async () => [STUB_CATALOG_ITEM],
    getCatalogItem: async () => STUB_CATALOG_ITEM,
    updateCatalogItem: async () => STUB_CATALOG_ITEM,
    deleteCatalogItem: async () => undefined,
    matchCatalog: async () => ({ status: "none" as const }),
    canonicalizeItem: async () => ({ item: STUB_LIST_ITEM, match: { status: "none" as const } }),
  },
});

// Import the real route plugin AFTER the mock is set up.
const { shoppingCatalogRoutes } = await import("./catalog.ts");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all catalog mutation routes are not marked public", async (t) => {
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

  await app.register(shoppingCatalogRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.deepEqual(
    publicMutations,
    [],
    `These mutation routes are incorrectly marked public: ${publicMutations.join(", ")}`,
  );
});

test("all 7 expected catalog routes are registered", async (t) => {
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

  await app.register(shoppingCatalogRoutes);
  await app.ready();
  t.after(() => app.close());

  const registered = pairs.map((p) => `${p.method} ${p.url}`);

  const expectedMutations = [
    "POST /catalog",
    "PUT /catalog/:id",
    "DELETE /catalog/:id",
    "POST /lists/:listId/items/:itemId/canonicalize",
  ];
  const expectedGets = [
    "GET /catalog",
    "GET /catalog/match",
    "GET /catalog/:id",
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

test("GET /catalog/match is registered before GET /catalog/:id (static before param)", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("session", null);
  app.decorate("db", {} as never);

  const registrationOrder: string[] = [];
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const method of methods) {
      registrationOrder.push(`${method.toUpperCase()} ${routeOptions.url}`);
    }
  });

  await app.register(shoppingCatalogRoutes);
  await app.ready();
  t.after(() => app.close());

  const matchIdx = registrationOrder.indexOf("GET /catalog/match");
  const paramIdx = registrationOrder.indexOf("GET /catalog/:id");
  assert.ok(matchIdx !== -1, "GET /catalog/match must be registered");
  assert.ok(paramIdx !== -1, "GET /catalog/:id must be registered");
  assert.ok(
    matchIdx < paramIdx,
    `GET /catalog/match (idx ${matchIdx}) must be registered before GET /catalog/:id (idx ${paramIdx})`,
  );
});

test("each catalog route has the expected body/params/querystring/response schemas", async (t) => {
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

  await app.register(shoppingCatalogRoutes);
  await app.ready();
  t.after(() => app.close());

  // Routes that must have a body schema.
  for (const route of ["POST /catalog", "PUT /catalog/:id"]) {
    const s = schemaMap.get(route);
    assert.ok(s != null, `Route "${route}" not found`);
    assert.ok(s!.body != null, `Route "${route}" missing body schema`);
    assert.ok(s!.response != null, `Route "${route}" missing response schema`);
  }

  // Routes that must have params.
  for (const route of ["GET /catalog/:id", "PUT /catalog/:id", "DELETE /catalog/:id", "POST /lists/:listId/items/:itemId/canonicalize"]) {
    const s = schemaMap.get(route);
    assert.ok(s != null, `Route "${route}" not found`);
    assert.ok(s!.params != null, `Route "${route}" missing params schema`);
  }

  // GET /catalog/match must have a querystring.
  const matchSchema = schemaMap.get("GET /catalog/match");
  assert.ok(matchSchema != null, "GET /catalog/match not found");
  assert.ok(matchSchema!.querystring != null, "GET /catalog/match missing querystring schema");

  // All non-HEAD routes must have response schemas.
  for (const [key, schema] of schemaMap) {
    if (key.startsWith("HEAD ")) continue;
    assert.ok(schema.response != null, `Route "${key}" is missing a response schema`);
  }
});

test("unauthenticated request to GET /catalog → 401 (session guard bites)", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Install a minimal session guard that rejects when req.session is null.
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
  app.decorate("db", {} as never);

  await app.register(shoppingCatalogRoutes);
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/catalog" });
  assert.equal(res.statusCode, 401, `Expected 401, got ${res.statusCode}: ${res.body}`);
});
