/**
 * capital-losses.hermetic.test.ts — Hermetic route test for the new
 * POST /capital-losses/apply-setoff endpoint.
 *
 * Uses node:test mock.module to stub the service dependency, then registers
 * the REAL capitalLossRoutes plugin so the actual handler executes.
 * Proves:
 *   - POST /capital-losses/apply-setoff with a valid body {fy:"2025-26"} reaches
 *     the service stub and returns HTTP 200 with the expected shape.
 *   - POST /capital-losses/apply-setoff with an invalid FY format returns 400.
 *
 * Demo-mode safety: POST is listed in MUTATING_METHODS in auth.ts so demo
 * sessions are rejected by the global auth preHandler before the route handler
 * is invoked. This is documented in the route comment and tested end-to-end by
 * the auth plugin's own test suite — it is not retestable without the auth
 * plugin and is therefore not covered here.
 *
 * No DB, no Redis, no env vars required.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Db } from "../../../db/index.ts";

// ─── Stub fixture ─────────────────────────────────────────────────────────────

const APPLY_SETOFF_FIXTURE = {
  fy: "2025-26",
  totalAbsorbedPaise: 0,
  entries: [],
};

// ─── Stub the service module BEFORE importing the real route plugin ────────────

await mock.module(new URL("../services/capital-losses.ts", import.meta.url).href, {
  exports: {
    getCapitalPosition: async () => { throw new Error("should not be called in this test"); },
    listCapitalLossEntries: async () => [],
    createCapitalLossEntry: async () => { throw new Error("should not be called in this test"); },
    updateCapitalLossEntry: async () => { throw new Error("should not be called in this test"); },
    deleteCapitalLossEntry: async () => { return; },
    applySetoffForFy: async () => APPLY_SETOFF_FIXTURE,
  },
});

// Import the REAL route plugin — it binds to the mocked service exports above.
const { capitalLossRoutes } = await import("./capital-losses.ts");

// ─── Build a minimal Fastify instance ─────────────────────────────────────────

async function buildHermeticApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Stub req.session with a fixed userId (auth plugin not loaded).
  app.addHook("preHandler", async (req) => {
    (req as unknown as { session: { userId: string } }).session = {
      userId: "00000000-0000-0000-0000-000000000099",
    };
  });

  // Decorate app.db — the real route passes it to the (mocked) service.
  app.decorate("db", {} as unknown as Db);

  await app.register(capitalLossRoutes);
  await app.ready();
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("POST /capital-losses/apply-setoff {fy:'2025-26'} — 200 and reaches service stub", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/capital-losses/apply-setoff",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ fy: "2025-26" }),
  });
  assert.equal(
    res.statusCode,
    200,
    `expected 200 for valid request, got ${res.statusCode}: ${res.body}`,
  );

  const body = JSON.parse(res.body) as typeof APPLY_SETOFF_FIXTURE;
  assert.equal(body.fy, "2025-26");
  assert.equal(body.totalAbsorbedPaise, 0);
  assert.deepEqual(body.entries, []);
});

test("POST /capital-losses/apply-setoff {fy:'2025-27'} — 400 (FY end-year suffix inconsistent)", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/capital-losses/apply-setoff",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ fy: "2025-27" }),
  });
  assert.equal(
    res.statusCode,
    400,
    `expected 400 for inconsistent FY '2025-27', got ${res.statusCode}: ${res.body}`,
  );
});

test("POST /capital-losses/apply-setoff without body — 400", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/capital-losses/apply-setoff",
    headers: { "content-type": "application/json" },
    payload: "{}",
  });
  assert.equal(
    res.statusCode,
    400,
    `expected 400 when fy is missing, got ${res.statusCode}: ${res.body}`,
  );
});
