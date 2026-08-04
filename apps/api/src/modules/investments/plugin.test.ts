import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { investmentsRoutes } from "./plugin.ts";

// Hermetic plugin-registration proof (no DB/Redis/env/config/storage — same
// pattern as app.route-snapshot.test.ts and modules/ledger/plugin.test.ts /
// modules/credit/plugin.test.ts): registers investmentsRoutes directly on a
// minimally-decorated Fastify instance and asserts one uniquely-attributable
// (method, url) pair from EACH of the 4 internal route registrations, via
// Fastify's own route-lookup introspection (`hasRoute`) — never
// `app.inject()`/handler execution, since handlers reference `app.db`/
// `app.storage`/`app.redis`/`req.session` decorations this hermetic instance
// doesn't provide. Catches a route file silently missing from plugin.ts, with
// a more local failure than the global canonical route-surface snapshot
// alone. The account-nps pair specifically proves the account-nps ownership
// correction (see TASK.md Root Cause's Scope decision 1) actually landed in
// plugin registration, not just in the roadmap text.

const EXPECTED_PAIRS: Array<{ method: string; url: string; routeFile: string }> = [
  { method: "GET", url: "/api/portfolio", routeFile: "holdings.ts" },
  { method: "GET", url: "/api/sips", routeFile: "sips.ts" },
  { method: "GET", url: "/api/net-worth", routeFile: "networth.ts" },
  { method: "GET", url: "/api/accounts/:accountId/nps-details", routeFile: "account-nps.ts" },
];

test("investmentsRoutes registers one uniquely-attributable route from each of the 4 internal route files", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(investmentsRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.equal(EXPECTED_PAIRS.length, 4, "must assert exactly one pair per each of the 4 route files");

  for (const { method, url, routeFile } of EXPECTED_PAIRS) {
    assert.ok(
      app.hasRoute({ method, url }),
      `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
    );
  }
});
