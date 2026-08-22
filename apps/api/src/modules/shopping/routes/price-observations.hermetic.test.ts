/**
 * Hermetic route-config tests for price-observation routes (task 10.1).
 *
 * No DB, no Redis, no env vars. Boots only the real Fastify app + Zod
 * compilers + the shoppingPriceObservationRoutes plugin, then asserts:
 *   - every mutating route (POST/DELETE) has config.public !== true
 *   - all 3 expected (method, relative-path) pairs are registered
 *   - each route has the expected body/params/querystring/response schemas
 *
 * Uses mock.module() to stub the price-observations service.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Stub the price-observations service so no DB is needed.
// ---------------------------------------------------------------------------

const STUB_OBSERVATION = {
  id: "00000000-0000-4000-a000-000000000001",
  catalogItemId: "00000000-0000-4000-a000-000000000002",
  priceSourceId: "00000000-0000-4000-a000-000000000003",
  pricePaise: 14900,
  mrpPaise: null,
  packQuantityBase: null,
  unit: null,
  observedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
};

const STUB_OBS_WITH_SOURCE = {
  ...STUB_OBSERVATION,
  sourceName: "Blinkit",
  sourceKind: "quick_commerce" as const,
  isStale: false,
};

await mock.module(new URL("../services/price-observations.ts", import.meta.url).href, {
  exports: {
    listObservations: async () => [STUB_OBS_WITH_SOURCE],
    createObservation: async () => STUB_OBSERVATION,
    deleteObservation: async () => undefined,
    isStaleObservation: () => false,
    STALE_DAYS: 7,
  },
});

// Import the real route plugin AFTER the mock is set up.
const { shoppingPriceObservationRoutes } = await import("./price-observations.ts");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("all price-observation mutation routes are not marked public", async (t) => {
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

  await app.register(shoppingPriceObservationRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.deepEqual(
    publicMutations,
    [],
    `These mutation routes are incorrectly marked public: ${publicMutations.join(", ")}`,
  );
});

test("all 3 expected price-observation routes are registered (plus HEAD mirror)", async (t) => {
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

  await app.register(shoppingPriceObservationRoutes);
  await app.ready();
  t.after(() => app.close());

  const registered = pairs.map((p) => `${p.method} ${p.url}`);

  const expectedRoutes = [
    "GET /observations",
    "POST /observations",
    "DELETE /observations/:id",
  ];

  for (const expected of expectedRoutes) {
    assert.ok(
      registered.includes(expected),
      `Expected route "${expected}" to be registered. Registered: ${registered.join(", ")}`,
    );
  }

  // Fastify auto-registers HEAD for each GET.
  assert.ok(
    registered.includes("HEAD /observations"),
    `Expected auto-registered HEAD /observations. Registered: ${registered.join(", ")}`,
  );
});

test("each price-observation route has the expected body/params/querystring/response schemas", async (t) => {
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

  await app.register(shoppingPriceObservationRoutes);
  await app.ready();
  t.after(() => app.close());

  // GET /observations must have a querystring schema.
  const getSchema = schemaMap.get("GET /observations");
  assert.ok(getSchema != null, "GET /observations not found");
  assert.ok(getSchema!.querystring != null, "GET /observations missing querystring schema");
  assert.ok(getSchema!.response != null, "GET /observations missing response schema");

  // POST /observations must have body schema.
  const postSchema = schemaMap.get("POST /observations");
  assert.ok(postSchema != null, "POST /observations not found");
  assert.ok(postSchema!.body != null, "POST /observations missing body schema");
  assert.ok(postSchema!.response != null, "POST /observations missing response schema");

  // DELETE /observations/:id must have params.
  const delSchema = schemaMap.get("DELETE /observations/:id");
  assert.ok(delSchema != null, "DELETE /observations/:id not found");
  assert.ok(delSchema!.params != null, "DELETE /observations/:id missing params schema");
  assert.ok(delSchema!.response != null, "DELETE /observations/:id missing response schema");

  // All non-HEAD routes must have response schemas.
  for (const [key, schema] of schemaMap) {
    if (key.startsWith("HEAD ")) continue;
    assert.ok(schema.response != null, `Route "${key}" is missing a response schema`);
  }
});

test("unauthenticated request to GET /observations → 401 (session guard bites)", async (t) => {
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

  await app.register(shoppingPriceObservationRoutes);
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/observations?catalogItemId=00000000-0000-4000-a000-000000000001" });
  assert.equal(res.statusCode, 401, `Expected 401, got ${res.statusCode}: ${res.body}`);
});
