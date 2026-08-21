/**
 * Hermetic route test for GET /api/shopping/units (task 9.1).
 *
 * No Postgres, Redis, config, auth, or security plugins. Follows the same
 * setup pattern as app.route-snapshot.test.ts: Fastify + validatorCompiler +
 * serializerCompiler + the module plugin with its prefix.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { RouteOptions } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { ShoppingUnitsResponseSchema } from "@compass/shared";
import { shoppingRoutes } from "../plugin.ts";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(shoppingRoutes, { prefix: "/api/shopping" });
  await app.ready();
  return app;
}

test("GET /api/shopping/units returns 200 and a schema-valid body with all three units", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/shopping/units" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = ShoppingUnitsResponseSchema.safeParse(body);
  assert.ok(parsed.success, `body failed ShoppingUnitsResponseSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(parsed.data!.units.length, 3, `expected 3 units, got ${parsed.data!.units.length}`);

  const unitStrings = parsed.data!.units.map((u) => u.unit).sort();
  assert.deepEqual(unitStrings, ["g", "ml", "piece"], `unexpected unit values: ${unitStrings.join(", ")}`);
});

test("GET /units (unprefixed) returns 404 — prefix is actually applied", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/units" });
  assert.equal(res.statusCode, 404, `expected 404 for unprefixed /units, got ${res.statusCode}`);
});

test("GET /api/shopping/units does not opt out of authentication (config.public is not true)", async (t) => {
  // plugins/auth.ts authenticates every route unless it sets config: { public: true }.
  // This asserts the absence of that opt-out so a future edit cannot accidentally
  // open the route to unauthenticated callers without this test catching it.
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  let capturedOptions: RouteOptions | undefined;
  app.addHook("onRoute", (routeOptions) => {
    if (routeOptions.method === "GET" && routeOptions.url === "/api/shopping/units") {
      capturedOptions = routeOptions;
    }
  });

  await app.register(shoppingRoutes, { prefix: "/api/shopping" });
  await app.ready();
  t.after(() => app.close());

  assert.ok(capturedOptions !== undefined, "expected to capture route options for GET /api/shopping/units");
  assert.notEqual(
    (capturedOptions!.config as Record<string, unknown> | undefined)?.public,
    true,
    "GET /api/shopping/units must not set config.public = true (that would bypass auth)",
  );
});
