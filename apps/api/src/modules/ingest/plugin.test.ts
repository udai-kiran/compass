import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { ingestRoutes } from "./plugin.ts";

// Hermetic plugin-registration proof (no DB/Redis/env/config/storage — same
// pattern as app.route-snapshot.test.ts and modules/credit/plugin.test.ts):
// registers ingestRoutes directly on a minimally-decorated Fastify instance
// and asserts one uniquely-attributable (method, url) pair from EACH of the 3
// internal route registrations, via Fastify's own route-lookup introspection
// (`hasRoute`) — never `app.inject()`/handler execution, since handlers
// reference `app.db`/`app.config`/`app.eventBus`/`req.session` decorations
// this hermetic instance doesn't provide. Catches a route file silently
// missing from plugin.ts, with a more local failure than the global canonical
// route-surface snapshot alone.

const EXPECTED_PAIRS: Array<{ method: string; url: string; routeFile: string }> = [
  { method: "GET", url: "/api/imports/presets", routeFile: "imports.ts" },
  { method: "GET", url: "/api/inbox", routeFile: "inbox.ts" },
  { method: "GET", url: "/api/mailboxes", routeFile: "mailboxes.ts" },
];

test("ingestRoutes registers one uniquely-attributable route from each of the 3 internal route files", async (t) => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(ingestRoutes);
  await app.ready();
  t.after(() => app.close());

  assert.equal(EXPECTED_PAIRS.length, 3, "must assert exactly one pair per each of the 3 route files");

  for (const { method, url, routeFile } of EXPECTED_PAIRS) {
    assert.ok(
      app.hasRoute({ method, url }),
      `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
    );
  }
});
