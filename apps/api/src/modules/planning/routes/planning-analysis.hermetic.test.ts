/**
 * Hermetic serializer test for planning-analysis routes (AC4a).
 *
 * Uses node:test mock.module to stub the service dependencies, then registers
 * the REAL planningAnalysisRoutes plugin so the actual handler executes.
 * Injects requests and asserts HTTP 200 with schema-valid JSON. This catches
 * route/schema wiring errors and serializer rejection — specifically, an
 * over-strict response schema manifests as a 500 only at serialization time
 * and can only be caught when the real route is registered.
 *
 * No DB, no Redis, no env vars required. Runs without DATABASE_URL/REDIS_URL.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Db } from "../../../db/index.ts";
import {
  DataCompletenessReportSchema,
  IncomeSurplusResultSchema,
} from "@compass/shared";

// ---------------------------------------------------------------------------
// Stub fixtures — schema-valid typed values
// ---------------------------------------------------------------------------

const INCOME_SURPLUS_FIXTURE = {
  historyMonths: 3,
  months: [
    { month: "2026-06", incomePaise: 500000, likelyBonus: false },
    { month: "2026-07", incomePaise: 500000, likelyBonus: false },
    { month: "2026-08", incomePaise: 600000, likelyBonus: false },
  ],
  committedOutflows: [
    { monthlyPaise: 50000, kind: "recurring" as const, label: "Rent" },
  ],
  totalCommittedPaise: 50000,
  conservativeSurplusPaise: 450000,
  optimisticSurplusPaise: 550000,
  confidence: "medium" as const,
};

const DATA_COMPLETENESS_FIXTURE = {
  asOf: "2026-08-18",
  accounts: [
    {
      accountId: "00000000-0000-0000-0000-000000000001",
      accountName: "HDFC Savings",
      accountType: "savings",
      lastImportedAt: "2026-08-15",
      lastImportDaysAgo: 3,
      unmatchedStatementLines: null,
      lastValuationAt: null,
      lastValuationDaysAgo: null,
      dataFreshness: "fresh" as const,
    },
  ],
  unresolvedDraftCount: 0,
  lastSnapshotAt: "2026-08-17",
  lastSnapshotDaysAgo: 1,
  confidence: "high" as const,
  confidenceReasons: [],
};

// ---------------------------------------------------------------------------
// Stub the service modules BEFORE importing the real route plugin.
// Paths are relative to this file (routes/ dir), matching how planning-analysis.ts
// imports them (also from routes/ so the same absolute URL resolves).
// ---------------------------------------------------------------------------

let capturedLookback: number | undefined;

await mock.module(new URL("../services/income-surplus.ts", import.meta.url).href, {
  exports: {
    getIncomeSurplus: async (
      _db: unknown,
      _userId: string,
      lookback = 12,
    ) => {
      capturedLookback = lookback;
      return INCOME_SURPLUS_FIXTURE;
    },
  },
});

await mock.module(new URL("../services/data-completeness.ts", import.meta.url).href, {
  exports: {
    getDataCompletenessReport: async () => DATA_COMPLETENESS_FIXTURE,
  },
});

// Import the REAL route plugin — it binds to the mocked service exports above.
const { planningAnalysisRoutes } = await import("./planning-analysis.ts");

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
  await app.register(planningAnalysisRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests — all use the REAL planningAnalysisRoutes handler
// ---------------------------------------------------------------------------

test("GET /api/planning/income-surplus — 200 and schema-valid body (no query)", async (t) => {
  capturedLookback = undefined;
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/planning/income-surplus" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = IncomeSurplusResultSchema.safeParse(body);
  assert.ok(parsed.success, `body failed IncomeSurplusResultSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.historyMonths, 3);
  assert.equal(body.confidence, "medium");
});

test("GET /api/planning/income-surplus — lookbackMonths defaults to 12 when omitted", async (t) => {
  capturedLookback = undefined;
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/planning/income-surplus" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(capturedLookback, 12, "real route should default lookbackMonths to 12");
});

test("GET /api/planning/income-surplus — lookbackMonths coerces string '6'", async (t) => {
  capturedLookback = undefined;
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus?lookbackMonths=6",
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}`);
  assert.equal(capturedLookback, 6, "real route should coerce '6' to number 6");
});

test("GET /api/planning/income-surplus — lookbackMonths=0 rejected 400", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus?lookbackMonths=0",
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
});

test("GET /api/planning/income-surplus — lookbackMonths=121 rejected 400", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus?lookbackMonths=121",
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
});

test("GET /api/planning/income-surplus — fractional lookbackMonths rejected 400", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus?lookbackMonths=6.5",
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
});

test("GET /api/planning/income-surplus — non-numeric lookbackMonths rejected 400", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "GET",
    url: "/api/planning/income-surplus?lookbackMonths=abc",
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}`);
});

test("GET /api/planning/data-completeness — 200 and schema-valid body", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/planning/data-completeness" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = DataCompletenessReportSchema.safeParse(body);
  assert.ok(parsed.success, `body failed DataCompletenessReportSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.asOf, "2026-08-18");
  assert.equal(body.confidence, "high");
});

test("GET /api/planning/data-completeness — ?today= is silently ignored: asOf reflects server date, not query param", async (t) => {
  const app = await buildHermeticApp();
  t.after(() => app.close());

  // The data-completeness route defines NO querystring schema, so query params
  // are not processed by Zod at all. The handler calls getDataCompletenessReport
  // with only (db, userId), omitting the today argument. The mocked service
  // returns DATA_COMPLETENESS_FIXTURE whose asOf is the real server date (from
  // fixture), not the supplied ?today= value.
  const res = await app.inject({
    method: "GET",
    url: "/api/planning/data-completeness?today=2020-01-01",
  });
  assert.equal(
    res.statusCode,
    200,
    `expected 200 (today= silently ignored), got ${res.statusCode}: ${res.body}`,
  );
  const body = JSON.parse(res.body);
  // asOf must be the fixture value (server date), NOT "2020-01-01"
  assert.notEqual(body.asOf, "2020-01-01", "asOf must not be affected by ?today= query param");
  assert.equal(body.asOf, "2026-08-18", "asOf must match the fixture (server date), not the supplied query param");
});
