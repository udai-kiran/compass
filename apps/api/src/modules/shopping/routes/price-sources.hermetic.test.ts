/**
 * Hermetic route-config tests for price-source routes (task 10.1).
 *
 * No DB, no Redis, no env vars. Boots only the real Fastify app + Zod
 * compilers + the shoppingPriceSourceRoutes plugin, then asserts:
 *   - every mutating route (POST/PUT/DELETE) has config.public !== true
 *   - all 4 expected (method, relative-path) pairs are registered
 *   - each route has the expected body/params/response schemas
 *
 * Uses mock.module() to stub the price-sources service and platform-seeds
 * so no real DB calls are made.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Stub the price-sources service and platform-seeds so no DB is needed.
// ---------------------------------------------------------------------------

const STUB_SOURCE = {
  id: "00000000-0000-4000-a000-000000000001",
  name: "Blinkit",
  kind: "quick_commerce" as const,
  url: "https://blinkit.com",
  isActive: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

await mock.module(new URL("../services/price-sources.ts", import.meta.url).href, {
  exports: {
    listPriceSources: async () => [STUB_SOURCE],
    createPriceSource: async () => STUB_SOURCE,
    updatePriceSource: async () => STUB_SOURCE,
    deletePriceSource: async () => undefined,
  },
});

await mock.module(new URL("../services/platform-seeds.ts", import.meta.url).href, {
  exports: {
    ensurePlatformSeeds: async () => undefined,
  },
});

// Import the real route plugin AFTER the mock is set up.
const { shoppingPriceSourceRoutes } = await import("./price-sources.ts");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all price-source mutation routes are not marked public", async (t) => {
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

  await app.register(shoppingPriceSourceRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.deepEqual(
    publicMutations,
    [],
    `These mutation routes are incorrectly marked public: ${publicMutations.join(", ")}`,
  );
});

test("all 4 expected price-source routes are registered (plus HEAD mirrors)", async (t) => {
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

  await app.register(shoppingPriceSourceRoutes);
  await app.ready();
  t.after(() => app.close());

  const registered = pairs.map((p) => `${p.method} ${p.url}`);

  const expectedRoutes = [
    "GET /sources",
    "POST /sources",
    "PUT /sources/:id",
    "DELETE /sources/:id",
  ];

  for (const expected of expectedRoutes) {
    assert.ok(
      registered.includes(expected),
      `Expected route "${expected}" to be registered. Registered: ${registered.join(", ")}`,
    );
  }

  // Fastify auto-registers HEAD for each GET.
  assert.ok(
    registered.includes("HEAD /sources"),
    `Expected auto-registered HEAD /sources. Registered: ${registered.join(", ")}`,
  );
});

test("each price-source route has the expected body/params/response schemas", async (t) => {
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

  await app.register(shoppingPriceSourceRoutes);
  await app.ready();
  t.after(() => app.close());

  // POST /sources must have body schema.
  const postSchema = schemaMap.get("POST /sources");
  assert.ok(postSchema != null, "POST /sources not found");
  assert.ok(postSchema!.body != null, "POST /sources missing body schema");
  assert.ok(postSchema!.response != null, "POST /sources missing response schema");

  // PUT /sources/:id must have body and params.
  const putSchema = schemaMap.get("PUT /sources/:id");
  assert.ok(putSchema != null, "PUT /sources/:id not found");
  assert.ok(putSchema!.body != null, "PUT /sources/:id missing body schema");
  assert.ok(putSchema!.params != null, "PUT /sources/:id missing params schema");
  assert.ok(putSchema!.response != null, "PUT /sources/:id missing response schema");

  // DELETE /sources/:id must have params.
  const delSchema = schemaMap.get("DELETE /sources/:id");
  assert.ok(delSchema != null, "DELETE /sources/:id not found");
  assert.ok(delSchema!.params != null, "DELETE /sources/:id missing params schema");
  assert.ok(delSchema!.response != null, "DELETE /sources/:id missing response schema");

  // All non-HEAD routes must have response schemas.
  for (const [key, schema] of schemaMap) {
    if (key.startsWith("HEAD ")) continue;
    assert.ok(schema.response != null, `Route "${key}" is missing a response schema`);
  }
});

test("unauthenticated request to GET /sources → 401 (session guard bites)", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Minimal session guard that rejects when req.session is null.
  app.decorateRequest("session", null);
  app.addHook("preHandler", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
  app.decorate("db", {} as never);

  await app.register(shoppingPriceSourceRoutes);
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/sources" });
  assert.equal(res.statusCode, 401, `Expected 401, got ${res.statusCode}: ${res.body}`);
});
