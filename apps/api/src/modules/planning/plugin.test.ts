import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { planningRoutes } from "./plugin.ts";

// Hermetic plugin-registration proof (no DB/Redis/env/config/storage — same
// pattern as app.route-snapshot.test.ts and modules/ledger/plugin.test.ts):
// registers planningRoutes directly on a minimally-decorated Fastify instance
// and asserts one uniquely-attributable (method, url) pair from each of the 8
// internal route registrations, via Fastify's own route-lookup introspection
// (`hasRoute`) — never `app.inject()`/handler execution, since handlers
// reference `app.db`/`app.storage`/`app.redis`/`req.session` decorations this
// hermetic instance doesn't provide. Catches a route file silently missing
// from plugin.ts, with a more local failure than the global canonical
// route-surface snapshot alone. The asserted pairs are representative
// (budgets/dashboard/goals/cashflow/bills/insights/reports/projectionSettings).

const EXPECTED_PAIRS: Array<{ method: string; url: string; routeFile: string }> = [
  { method: "GET", url: "/api/budgets/suggestions", routeFile: "budgets.ts" },
  { method: "GET", url: "/api/dashboard", routeFile: "dashboard.ts" },
  { method: "GET", url: "/api/goals", routeFile: "goals.ts" },
  { method: "GET", url: "/api/cashflow", routeFile: "cashflow.ts" },
  { method: "GET", url: "/api/bills/upcoming", routeFile: "bills.ts" },
  { method: "GET", url: "/api/insights", routeFile: "insights.ts" },
  { method: "GET", url: "/api/reports", routeFile: "reports.ts" },
  { method: "GET", url: "/api/projection-settings", routeFile: "projection-settings.ts" },
];

test("planningRoutes registers one uniquely-attributable route from each of the 8 internal route files", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(planningRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.equal(EXPECTED_PAIRS.length, 8, "must assert exactly one pair per each of the 8 route files");

  for (const { method, url, routeFile } of EXPECTED_PAIRS) {
    assert.ok(
      app.hasRoute({ method, url }),
      `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
    );
  }
});