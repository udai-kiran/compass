/**
 * Hermetic route test for reward-rules routes (task 10.5).
 *
 * Uses node:test mock.module to stub the service module, then registers the
 * REAL rewardRuleRoutes plugin so the actual handler/schema/serializer logic
 * executes. No DB, no Redis, no env vars required.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Db } from "../../../db/index.ts";
import { RewardRuleSchema } from "@compass/shared";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const RULE_FIXTURE = {
  id: "b0000000-0000-4000-8000-000000000001",
  cardProductName: "Regalia Gold",
  network: "visa" as const,
  baseEarnPer100: 4,
  mccExclusions: [] as string[],
  accelEarnMultiplier: null,
  accelEarnCapPaise: null,
  accelEarnCapPeriod: null,
  redemptionValues: { cashback: 50 } as Record<string, number>,
  milestoneSpendPaise: null,
  milestoneBenefitDesc: null,
  annualFeeWaiverSpendPaise: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

// ---------------------------------------------------------------------------
// Mutable stubs
// ---------------------------------------------------------------------------

let listReturn: typeof RULE_FIXTURE[] = [RULE_FIXTURE];
let createReturn: typeof RULE_FIXTURE = RULE_FIXTURE;
let updateReturn: typeof RULE_FIXTURE = RULE_FIXTURE;

await mock.module(new URL("../services/reward-rules.ts", import.meta.url).href, {
  exports: {
    listRewardRules: async () => listReturn,
    createRewardRule: async () => createReturn,
    updateRewardRule: async () => updateReturn,
    deleteRewardRule: async () => undefined,
    getEffectiveEarnPoints: () => 0,
    getPointValue: () => null,
  },
});

const { rewardRuleRoutes } = await import("./reward-rules.ts");

// ---------------------------------------------------------------------------
// Fastify instance builder
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("preHandler", async (req) => {
    (req as unknown as { session: { userId: string } }).session = {
      userId: "b0000000-0000-4000-8000-000000000099",
    };
  });
  app.decorate("db", {} as unknown as Db);
  await app.register(rewardRuleRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("GET /api/credit/reward-rules — 200 with array of rules", async (t) => {
  listReturn = [RULE_FIXTURE];
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/reward-rules" });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);

  const body = JSON.parse(res.body) as unknown[];
  assert.equal(body.length, 1);
  const parsed = RewardRuleSchema.safeParse(body[0]);
  assert.ok(parsed.success, `body[0] failed RewardRuleSchema: ${JSON.stringify(parsed.error?.issues)}`);
});

test("GET /api/credit/reward-rules — empty list returns []", async (t) => {
  listReturn = [];
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/reward-rules" });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.deepEqual(body, []);
});

test("POST /api/credit/reward-rules — 201 with created rule", async (t) => {
  createReturn = RULE_FIXTURE;
  const app = await buildApp();
  t.after(() => app.close());

  const payload = {
    cardProductName: "Regalia Gold",
    network: "visa",
    baseEarnPer100: 4,
    mccExclusions: [],
    accelEarnMultiplier: null,
    accelEarnCapPaise: null,
    accelEarnCapPeriod: null,
    redemptionValues: { cashback: 50 },
    milestoneSpendPaise: null,
    milestoneBenefitDesc: null,
    annualFeeWaiverSpendPaise: null,
  };

  const res = await app.inject({
    method: "POST",
    url: "/api/credit/reward-rules",
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(res.statusCode, 201, `expected 201: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = RewardRuleSchema.safeParse(body);
  assert.ok(parsed.success, `body failed RewardRuleSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.cardProductName, "Regalia Gold");
});

test("PUT /api/credit/reward-rules/:id — 200 with updated rule", async (t) => {
  updateReturn = { ...RULE_FIXTURE, baseEarnPer100: 6 };
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "PUT",
    url: "/api/credit/reward-rules/b0000000-0000-4000-8000-000000000001",
    headers: { "content-type": "application/json" },
    payload: { baseEarnPer100: 6 },
  });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);

  const body = JSON.parse(res.body);
  assert.equal(body.baseEarnPer100, 6);
});

test("DELETE /api/credit/reward-rules/:id — 204 no content", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "DELETE",
    url: "/api/credit/reward-rules/b0000000-0000-4000-8000-000000000001",
  });
  assert.equal(res.statusCode, 204, `expected 204: ${res.body}`);
});
