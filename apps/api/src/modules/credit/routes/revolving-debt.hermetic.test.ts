/**
 * Hermetic serializer test for revolving-debt route (AC4a).
 *
 * Uses node:test mock.module to stub the service dependency, then registers
 * the REAL revolvingDebtRoutes plugin so the actual handler executes.
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
import { HouseholdRevolvingDebtSchema } from "@compass/shared";

// ---------------------------------------------------------------------------
// Stub fixture — schema-valid typed value
// ---------------------------------------------------------------------------

const REVOLVING_DEBT_FIXTURE = {
  cards: [
    {
      accountId: "00000000-0000-0000-0000-000000000001",
      accountName: "HDFC Regalia",
      latestStatement: {
        accountId: "00000000-0000-0000-0000-000000000001",
        period: "2026-07",
        totalDuePaise: 1500000,
        minDuePaise: 75000,
        paidByDueDatePaise: 900000,
        state: "partial" as const,
        revolvingBalancePaise: 600000,
        estimatedMonthlyChargePaise: 3000,
      },
      isRevolving: true,
      revolvingBalancePaise: 600000,
    },
  ],
  totalRevolvingPaise: 600000,
  hasRevolvingDebt: true,
  totalMonthlyChargePaise: 3000,
};

// ---------------------------------------------------------------------------
// Mutable stub — lets tests switch the return value without re-mocking
// ---------------------------------------------------------------------------

type StubReturn = typeof REVOLVING_DEBT_FIXTURE | {
  cards: [];
  totalRevolvingPaise: 0;
  hasRevolvingDebt: false;
  totalMonthlyChargePaise: 0;
};

let stubReturn: StubReturn = REVOLVING_DEBT_FIXTURE;

// Stub the service module BEFORE importing the real route plugin.
// Path is relative to this file (routes/ dir), matching how revolving-debt.ts
// imports it (also from routes/ so the same absolute URL resolves).
await mock.module(new URL("../services/revolving-debt.ts", import.meta.url).href, {
  exports: {
    getHouseholdRevolvingDebt: async () => stubReturn,
  },
});

// Import the REAL route plugin — it binds to the mocked service export above.
const { revolvingDebtRoutes } = await import("./revolving-debt.ts");

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
  await app.register(revolvingDebtRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests — all use the REAL revolvingDebtRoutes handler
// ---------------------------------------------------------------------------

test("GET /api/credit/revolving-debt — 200 and schema-valid body", async (t) => {
  stubReturn = REVOLVING_DEBT_FIXTURE;
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/revolving-debt" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = HouseholdRevolvingDebtSchema.safeParse(body);
  assert.ok(parsed.success, `body failed HouseholdRevolvingDebtSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.hasRevolvingDebt, true);
  assert.equal(body.totalRevolvingPaise, 600000);
});

test("GET /api/credit/revolving-debt — empty cards returns 200 with zero totals", async (t) => {
  stubReturn = {
    cards: [],
    totalRevolvingPaise: 0,
    hasRevolvingDebt: false,
    totalMonthlyChargePaise: 0,
  };
  const app = await buildHermeticApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/revolving-debt" });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = HouseholdRevolvingDebtSchema.safeParse(body);
  assert.ok(parsed.success, `body failed HouseholdRevolvingDebtSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.hasRevolvingDebt, false);
  assert.equal(body.cards.length, 0);
});
