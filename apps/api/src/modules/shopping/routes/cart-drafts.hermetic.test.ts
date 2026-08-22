/**
 * Hermetic route tests for cart-draft routes (task 12.2).
 *
 * Verifies:
 * - POST /drafts/:id/accept: status='draft' → 200, sets status='ordered'
 * - POST /drafts/:id/accept: status='abandoned' → 409
 * - PUT /drafts/:id/items/:itemId: status='ordered' → 400
 * - DELETE /drafts/:id: status='ordered' → 409
 *
 * No DB, no Redis, no env vars.
 * Stubs the ownership service and cart-draft-generator service.
 * Requires --experimental-test-module-mocks (enabled in apps/api/package.json).
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

// ─── Stub data ────────────────────────────────────────────────────────────────

const DRAFT_ID = "00000000-0000-4000-a000-000000000001";
const ITEM_ID = "00000000-0000-4000-a000-000000000002";
const USER_ID = "00000000-0000-4000-a000-000000000099";

const STUB_DRAFT_ORDERED = {
  id: DRAFT_ID,
  status: "ordered" as const,
  priceSourceId: null,
  totalPaise: 0,
  generatedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  items: [],
};

// ─── Stub service modules ─────────────────────────────────────────────────────

// Mock the ownership service — assertOwnedDraft always succeeds.
await mock.module(new URL("../services/ownership.ts", import.meta.url).href, {
  exports: {
    assertOwnedDraft: async () => undefined,
    assertOwnedList: async () => undefined,
    assertOwnedCatalogItem: async () => undefined,
    assertOwnedPriceSource: async () => undefined,
    assertOwnedPriceObservation: async () => undefined,
    assertOwnedListItem: async () => undefined,
  },
});

// Mock the cart-draft-generator service.
await mock.module(new URL("../services/cart-draft-generator.ts", import.meta.url).href, {
  exports: {
    generateDraft: async () => ({ ...STUB_DRAFT_ORDERED, status: "draft" }),
    getDraftWithItems: async () => STUB_DRAFT_ORDERED,
    calculateDraftTotalPaise: () => 0,
    decrementObservationCount: (n: number) => n,
  },
});

// Import the real route plugin AFTER mocks are set up.
const { shoppingCartDraftRoutes } = await import("./cart-drafts.ts");

// ─── DB factory ───────────────────────────────────────────────────────────────

/**
 * Build a minimal fake db that the cart-drafts routes use:
 * - db.query.cartDrafts.findFirst → fails if the edit route tries a non-atomic status read
 * - db.query.cartDraftItems.findFirst → returns a fake item
 * - db.query.habitProfiles.findFirst → returns null
 * - db.update(...).set(...).where(...).returning(...) → conditional result
 * - db.query.cartDrafts.findMany → returns []
 * - db.transaction(fn) → calls fn(db)
 */
function makeDb(draftStatus: string) {
  const fakeItem = {
    id: ITEM_ID,
    cartDraftId: DRAFT_ID,
    catalogItemId: null,
    quantityBase: 1,
    unit: "piece",
    reason: "test",
    suggestedPricePaise: 10000,
    suggestedSourceId: null,
    substitutionForItemId: null,
    priceDeltaPaise: null,
    isRemoved: false,
    createdAt: new Date("2026-01-01"),
  };

  const setChain = {
    where: () => ({
      returning: async () => (draftStatus === "draft" ? [{ id: DRAFT_ID }] : []),
    }),
  };
  const updateChain = { set: () => setChain };
  const db: Record<string, unknown> = {
    query: {
      cartDrafts: {
        findFirst: async () => {
          throw new Error("Edit status must be claimed atomically, not read first");
        },
        findMany: async () => [],
      },
      cartDraftItems: {
        findFirst: async () => fakeItem,
        findMany: async () => [fakeItem],
      },
      habitProfiles: {
        findFirst: async () => null,
      },
    },
    update: () => updateChain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(draftStatus: string) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("session", null);
  app.addHook("onRequest", (req, _reply, done) => {
    (req as unknown as { session: { userId: string } }).session = { userId: USER_ID };
    done();
  });
  app.decorate("db", makeDb(draftStatus) as never);
  await app.register(shoppingCartDraftRoutes, { prefix: "/api/shopping" });
  await app.ready();
  return app;
}

// ─── Accept endpoint tests ────────────────────────────────────────────────────

test("POST /drafts/:id/accept with status=draft → 200", async (t) => {
  const app = await buildApp("draft");
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: `/api/shopping/drafts/${DRAFT_ID}/accept`,
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body) as { status: string };
  // getDraftWithItems stub returns STUB_DRAFT_ORDERED with status='ordered'
  assert.equal(body.status, "ordered", `expected status='ordered', got: ${body.status}`);
});

test("POST /drafts/:id/accept with status=abandoned → 409", async (t) => {
  const app = await buildApp("abandoned");
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: `/api/shopping/drafts/${DRAFT_ID}/accept`,
  });
  assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${res.body}`);
});

test("POST /drafts/:id/accept with status=ordered → 409", async (t) => {
  const app = await buildApp("ordered");
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: `/api/shopping/drafts/${DRAFT_ID}/accept`,
  });
  assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${res.body}`);
});

// ─── Edit guard tests ─────────────────────────────────────────────────────────

test("PUT /drafts/:id/items/:itemId with status=ordered → 400", async (t) => {
  const app = await buildApp("ordered");
  t.after(() => app.close());

  const res = await app.inject({
    method: "PUT",
    url: `/api/shopping/drafts/${DRAFT_ID}/items/${ITEM_ID}`,
    payload: { quantityBase: 2, unit: "piece", isRemoved: false },
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}: ${res.body}`);
});

test("PUT /drafts/:id/items/:itemId with status=abandoned → 400", async (t) => {
  const app = await buildApp("abandoned");
  t.after(() => app.close());

  const res = await app.inject({
    method: "PUT",
    url: `/api/shopping/drafts/${DRAFT_ID}/items/${ITEM_ID}`,
    payload: { quantityBase: 2, unit: "piece", isRemoved: false },
  });
  assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}: ${res.body}`);
});

test("PUT /drafts/:id/items/:itemId claims a draft atomically before editing", async (t) => {
  const app = await buildApp("draft");
  t.after(() => app.close());

  const res = await app.inject({
    method: "PUT",
    url: `/api/shopping/drafts/${DRAFT_ID}/items/${ITEM_ID}`,
    payload: { quantityBase: 2, unit: "piece", isRemoved: false },
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
});

// ─── Abandon guard tests ──────────────────────────────────────────────────────

test("DELETE /drafts/:id with status=ordered → 409", async (t) => {
  const app = await buildApp("ordered");
  t.after(() => app.close());

  const res = await app.inject({
    method: "DELETE",
    url: `/api/shopping/drafts/${DRAFT_ID}`,
  });
  assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${res.body}`);
});

test("DELETE /drafts/:id with status=abandoned → 409 (cannot abandon already-abandoned)", async (t) => {
  const app = await buildApp("abandoned");
  t.after(() => app.close());

  const res = await app.inject({
    method: "DELETE",
    url: `/api/shopping/drafts/${DRAFT_ID}`,
  });
  assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${res.body}`);
});

test("DELETE /drafts/:id with status=draft → 204", async (t) => {
  const app = await buildApp("draft");
  t.after(() => app.close());

  const res = await app.inject({
    method: "DELETE",
    url: `/api/shopping/drafts/${DRAFT_ID}`,
  });
  assert.equal(res.statusCode, 204, `expected 204, got ${res.statusCode}: ${res.body}`);
});
