import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { ledgerRoutes } from "./plugin.ts";

// Hermetic plugin-registration proof (no DB/Redis/env/config/storage — same
// pattern as app.route-snapshot.test.ts): registers ledgerRoutes directly on
// a minimally-decorated Fastify instance and asserts one uniquely-attributable
// (method, path) pair from EACH of the 11 internal route registrations, via
// Fastify's own route-lookup introspection (`hasRoute`) — never
// `app.inject()`/handler execution, since handlers reference `app.db` /
// `app.storage` / `app.redis` / `req.session` decorations this hermetic
// instance doesn't provide. Catches a route file silently missing from
// plugin.ts, with a more local failure than the global canonical route-surface
// snapshot alone.

const EXPECTED_PAIRS: Array<{ method: string; url: string; routeFile: string }> = [
  { method: "GET", url: "/api/accounts/average-balance", routeFile: "accounts.ts" },
  { method: "GET", url: "/api/categories/tree", routeFile: "categories.ts" },
  { method: "POST", url: "/api/epf-contributions", routeFile: "transactions.ts" },
  { method: "GET", url: "/api/transfers/suggestions", routeFile: "transfers.ts" },
  { method: "DELETE", url: "/api/transaction-links/:id", routeFile: "transaction-links.ts" },
  { method: "GET", url: "/api/attachments/:id", routeFile: "attachments.ts" },
  { method: "GET", url: "/api/recurring", routeFile: "recurring.ts" },
  { method: "POST", url: "/api/merchants/rename", routeFile: "rules.ts" },
  { method: "GET", url: "/api/resources", routeFile: "resources.ts" },
  { method: "GET", url: "/api/search/recent", routeFile: "search.ts" },
  { method: "GET", url: "/api/user-tasks", routeFile: "user-tasks.ts" },
];

test("ledgerRoutes registers one uniquely-attributable route from each of the 11 internal route files", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(ledgerRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.equal(EXPECTED_PAIRS.length, 11, "must assert exactly one pair per each of the 11 route files");

  for (const { method, url, routeFile } of EXPECTED_PAIRS) {
    assert.ok(
      app.hasRoute({ method, url }),
      `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
    );
  }
});
