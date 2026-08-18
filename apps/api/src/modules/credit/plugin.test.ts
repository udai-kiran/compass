import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { creditRoutes } from "./plugin.ts";

// Hermetic plugin-registration proof (no DB/Redis/env/config/storage — same
// pattern as app.route-snapshot.test.ts and modules/ledger/plugin.test.ts):
// registers creditRoutes directly on a minimally-decorated Fastify instance
// and asserts one uniquely-attributable (method, url) pair from EACH of the 4
// internal route registrations, via Fastify's own route-lookup introspection
// (`hasRoute`) — never `app.inject()`/handler execution, since handlers
// reference `app.db`/`app.storage`/`app.redis`/`req.session` decorations this
// hermetic instance doesn't provide. Catches a route file silently missing
// from plugin.ts, with a more local failure than the global canonical
// route-surface snapshot alone.

const EXPECTED_PAIRS: Array<{ method: string; url: string; routeFile: string }> = [
  { method: "GET", url: "/api/cards", routeFile: "cards.ts" },
  { method: "GET", url: "/api/emis", routeFile: "emis.ts" },
  { method: "GET", url: "/api/accounts/:accountId/bank-details", routeFile: "bank-details.ts" },
  { method: "GET", url: "/api/accounts/:accountId/overdraft-details", routeFile: "overdraft-details.ts" },
  { method: "GET", url: "/api/credit/revolving-debt", routeFile: "revolving-debt.ts" },
];

test("creditRoutes registers one uniquely-attributable route from each of the 5 internal route files", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(creditRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.equal(EXPECTED_PAIRS.length, 5, "must assert exactly one pair per each of the 5 route files");

  for (const { method, url, routeFile } of EXPECTED_PAIRS) {
    assert.ok(
      app.hasRoute({ method, url }),
      `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
    );
  }
});
