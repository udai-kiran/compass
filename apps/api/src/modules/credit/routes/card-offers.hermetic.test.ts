/**
 * Hermetic route test for card-offers routes (task 10.4).
 *
 * Uses node:test mock.module to stub the service module, then registers the
 * REAL cardOfferRoutes plugin so the actual handler/schema/serializer logic
 * executes. No DB, no Redis, no env vars required.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Db } from "../../../db/index.ts";
import { CardOfferSchema } from "@compass/shared";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

const OFFER_FIXTURE = {
  id: "a0000000-0000-4000-8000-000000000001",
  platform: "Swiggy",
  issuer: "HDFC",
  cardProductName: null,
  discountKind: "percentage" as const,
  discountRateBps: 1000,
  maxCapPaise: null,
  minSpendPaise: null,
  validFrom: new Date("2026-01-01"),
  validUntil: FUTURE,
  stackable: false,
  isReviewed: false,
  sourceEmailId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const REVIEWED_FIXTURE = { ...OFFER_FIXTURE, isReviewed: true };

// ---------------------------------------------------------------------------
// Mutable stubs
// ---------------------------------------------------------------------------

let listReturn: typeof OFFER_FIXTURE[] = [OFFER_FIXTURE];
let createReturn: typeof OFFER_FIXTURE = OFFER_FIXTURE;
let reviewReturn: typeof OFFER_FIXTURE = REVIEWED_FIXTURE;

await mock.module(new URL("../services/card-offers.ts", import.meta.url).href, {
  exports: {
    listOffers: async () => listReturn,
    createOffer: async () => createReturn,
    reviewOffer: async () => reviewReturn,
    deleteOffer: async () => undefined,
    getActiveOffers: async () => [REVIEWED_FIXTURE],
  },
});

const { cardOfferRoutes } = await import("./card-offers.ts");

// ---------------------------------------------------------------------------
// Fastify instance builder
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("preHandler", async (req) => {
    (req as unknown as { session: { userId: string } }).session = {
      userId: "a0000000-0000-4000-8000-000000000099",
    };
  });
  app.decorate("db", {} as unknown as Db);
  await app.register(cardOfferRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("GET /api/credit/card-offers — 200 with array of offers", async (t) => {
  listReturn = [OFFER_FIXTURE];
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/card-offers" });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);

  const body = JSON.parse(res.body) as unknown[];
  assert.equal(body.length, 1);
  // Response has ISO strings for date fields (JSON serialization) — coerce back to Date for schema validation
  const parsed = CardOfferSchema.safeParse(body[0]);
  assert.ok(parsed.success, `body[0] failed CardOfferSchema: ${JSON.stringify(parsed.error?.issues)}`);
});

test("GET /api/credit/card-offers — empty list returns []", async (t) => {
  listReturn = [];
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/api/credit/card-offers" });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.deepEqual(body, []);
});

test("POST /api/credit/card-offers — 201 with created offer", async (t) => {
  createReturn = OFFER_FIXTURE;
  const app = await buildApp();
  t.after(() => app.close());

  const payload = {
    platform: "Swiggy",
    issuer: "HDFC",
    cardProductName: null,
    discountKind: "percentage",
    discountRateBps: 1000,
    maxCapPaise: null,
    minSpendPaise: null,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: FUTURE.toISOString(),
    stackable: false,
    raw: null,
  };

  const res = await app.inject({
    method: "POST",
    url: "/api/credit/card-offers",
    headers: { "content-type": "application/json" },
    payload,
  });
  assert.equal(res.statusCode, 201, `expected 201: ${res.body}`);

  const body = JSON.parse(res.body);
  const parsed = CardOfferSchema.safeParse(body);
  assert.ok(parsed.success, `body failed CardOfferSchema: ${JSON.stringify(parsed.error?.issues)}`);
  assert.equal(body.isReviewed, false);
});

test("PATCH /api/credit/card-offers/:id/review — 200 with isReviewed=true", async (t) => {
  reviewReturn = REVIEWED_FIXTURE;
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "PATCH",
    url: "/api/credit/card-offers/a0000000-0000-4000-8000-000000000001/review",
  });
  assert.equal(res.statusCode, 200, `expected 200: ${res.body}`);

  const body = JSON.parse(res.body);
  assert.equal(body.isReviewed, true);
});

test("DELETE /api/credit/card-offers/:id — 204 no content", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "DELETE",
    url: "/api/credit/card-offers/a0000000-0000-4000-8000-000000000001",
  });
  assert.equal(res.statusCode, 204, `expected 204: ${res.body}`);
});
