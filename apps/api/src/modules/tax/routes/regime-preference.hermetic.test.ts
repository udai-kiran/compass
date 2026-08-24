/**
 * Hermetic route test for tax regime-preference routes (task 13.1 K3).
 *
 * Uses node:test mock.module to stub the service dependency, then registers
 * the REAL regimePreferenceRoutes plugin so the actual handler executes.
 * Proves:
 *   - "2025-27" (well-formed but suffix-inconsistent) is rejected HTTP 400 by
 *     FySchema's suffix-consistency refinement before the service is called.
 *   - A valid FY ("2025-26") reaches the service stub and returns HTTP 200.
 *
 * No DB, no Redis, no env vars required. Runs without DATABASE_URL/REDIS_URL.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Db } from "../../../db/index.ts";

// ---------------------------------------------------------------------------
// Stub fixture — schema-valid RegimePreference response
// ---------------------------------------------------------------------------

const REGIME_PREF_FIXTURE = {
  fy: "2025-26",
  chosen: null,
  inferredRegime: null,
  inferredAt: null,
  effective: "new" as const,
  source: "default" as const,
};

// ---------------------------------------------------------------------------
// Stub the service module BEFORE importing the real route plugin.
// Path is relative to this file (routes/ dir), matching how regime-preference.ts
// imports it (also from routes/ so the same absolute URL resolves).
// ---------------------------------------------------------------------------

await mock.module(new URL("../services/regime-preference.ts", import.meta.url).href, {
  exports: {
    getRegimePreference: async () => REGIME_PREF_FIXTURE,
    upsertRegimePreference: async () => REGIME_PREF_FIXTURE,
    updateInferredRegime: async () => REGIME_PREF_FIXTURE,
  },
});

// Import the REAL route plugin — it binds to the mocked service exports above.
const { regimePreferenceRoutes } = await import("./regime-preference.ts");

// ---------------------------------------------------------------------------
// Build a minimal Fastify instance with the real route plugin
// ---------------------------------------------------------------------------

async function buildHermeticApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Stub req.session with a fixed userId (auth plugin not loaded)
  app.addHook("preHandler", async (req) => {
    (req as unknown as { session: { userId: string } }).session = {
      userId: "00000000-0000-0000-0000-000000000099",
    };
  });

  // Decorate app.db — the real route passes it to the (mocked) service, so the
  // value is never used, but Fastify requires the decoration to exist.
  app.decorate("db", {} as unknown as Db);

  // Register the REAL route plugin
  await app.register(regimePreferenceRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests — all use the REAL regimePreferenceRoutes handler
// ---------------------------------------------------------------------------

test("GET /regime-preference?fy=2025-27 — 400 (FY end-year suffix inconsistent with start year)", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/regime-preference?fy=2025-27" });
  assert.equal(
    res.statusCode,
    400,
    `expected 400 for inconsistent FY '2025-27', got ${res.statusCode}: ${res.body}`,
  );
});

test("PUT /regime-preference body={fy:'2025-27',...} — 400 (FY end-year suffix inconsistent)", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "PUT",
    url: "/regime-preference",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ fy: "2025-27", chosen: "new" }),
  });
  assert.equal(
    res.statusCode,
    400,
    `expected 400 for inconsistent FY '2025-27', got ${res.statusCode}: ${res.body}`,
  );
});

test("GET /regime-preference?fy=2025-26 — 200 and reaches service stub (proves route→service wiring)", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/regime-preference?fy=2025-26" });
  assert.equal(
    res.statusCode,
    200,
    `expected 200 for valid FY '2025-26', got ${res.statusCode}: ${res.body}`,
  );

  const body = JSON.parse(res.body);
  assert.equal(body.fy, "2025-26");
  assert.equal(body.effective, "new");
  assert.equal(body.source, "default");
  assert.equal(body.chosen, null);
  assert.equal(body.inferredRegime, null);
});
