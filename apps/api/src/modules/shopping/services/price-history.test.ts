/**
 * Unit tests for price-history services (task 10.7).
 *
 * All 8 tests are pure / injectable — no DB, no Redis, no env vars.
 * `checkPriceHonesty` is tested with a minimal fake-DB that returns
 * pre-canned rows, keeping the tests deterministic and fast.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_OBSERVATIONS,
  MIN_DISTINCT_DAYS,
  INFLATION_THRESHOLD_PCT,
  analyzeTrend,
  checkPriceHonesty,
} from "./price-history.ts";
import type { PriceHistoryPoint } from "@compass/shared";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal PriceHistoryPoint for testing. */
function makePoint(
  pricePaise: number,
  observedAt: Date,
  opts: { packQuantityBase?: number; unit?: "g" | "ml" | "piece"; sourceId?: string } = {},
): PriceHistoryPoint {
  const packQuantityBase = opts.packQuantityBase ?? null;
  const unit = opts.unit ?? null;
  const unitPricePaisePerBase =
    packQuantityBase !== null && packQuantityBase > 0
      ? pricePaise / packQuantityBase
      : null;
  return {
    pricePaise,
    unitPricePaisePerBase,
    packQuantityBase,
    unit,
    sourceId: opts.sourceId ?? "00000000-0000-4000-a000-000000000001",
    observedAt,
  };
}

/** Days offset relative to a fixed anchor date. */
function dayOf(offset: number): Date {
  const base = new Date("2026-01-01T00:00:00.000Z");
  return new Date(base.getTime() + offset * 24 * 60 * 60 * 1000);
}

// ─── analyzeTrend tests ──────────────────────────────────────────────────────

test("analyzeTrend: 0 observations → insufficient_data", () => {
  const result = analyzeTrend([]);
  assert.equal(result.trend, "insufficient_data");
  assert.equal(result.confidence, "insufficient_data");
  assert.equal(result.recommendationPaise, null);
  assert.equal(result.observationCount, 0);
  assert.equal(result.minObservationsRequired, MIN_OBSERVATIONS);
  assert.equal(result.distinctDaysRequired, MIN_DISTINCT_DAYS);
});

test(`analyzeTrend: 4 observations, 4 distinct days → insufficient_data (< MIN_OBSERVATIONS=${MIN_OBSERVATIONS})`, () => {
  const points = [
    makePoint(10000, dayOf(0)),
    makePoint(11000, dayOf(1)),
    makePoint(12000, dayOf(2)),
    makePoint(13000, dayOf(3)),
  ];
  const result = analyzeTrend(points);
  assert.equal(result.trend, "insufficient_data");
  assert.equal(result.observationCount, 4);
  assert.equal(result.distinctDayCount, 4);
});

test(`analyzeTrend: 5 observations, 2 distinct days → insufficient_data (< MIN_DISTINCT_DAYS=${MIN_DISTINCT_DAYS})`, () => {
  // All 5 observations on 2 different days.
  const points = [
    makePoint(10000, dayOf(0)),
    makePoint(10100, dayOf(0)),
    makePoint(10200, dayOf(0)),
    makePoint(10300, dayOf(1)),
    makePoint(10400, dayOf(1)),
  ];
  const result = analyzeTrend(points);
  assert.equal(result.trend, "insufficient_data");
  assert.equal(result.observationCount, 5);
  assert.equal(result.distinctDayCount, 2);
});

test("analyzeTrend: 5 observations, 3 distinct days, rising prices → trend: rising, confidence: low", () => {
  // Prices 100→200→300→400→500 over 5 distinct days (paise values scaled).
  const points = [
    makePoint(10000, dayOf(0)),
    makePoint(20000, dayOf(1)),
    makePoint(30000, dayOf(2)),
    makePoint(40000, dayOf(3)),
    makePoint(50000, dayOf(4)),
  ];
  const result = analyzeTrend(points);
  assert.equal(result.trend, "rising", `expected rising, got ${result.trend}`);
  assert.equal(result.confidence, "low");
  // recommendationPaise for rising = latest pricePaise.
  assert.equal(result.recommendationPaise, 50000);
  assert.equal(result.observationCount, 5);
  assert.equal(result.distinctDayCount, 5);
});

// ─── checkPriceHonesty tests ─────────────────────────────────────────────────

/**
 * Build a minimal fake DB that returns `rows` from any SELECT against
 * `price_observations`.
 */
type FakeRow = {
  id: string;
  userId: string;
  catalogItemId: string;
  priceSourceId: string;
  pricePaise: number;
  mrpPaise: number | null;
  packQuantityBase: number | null;
  unit: "g" | "ml" | "piece" | null;
  observedAt: Date;
  createdAt: Date;
};

function makeFakeDb(rows: FakeRow[]): unknown {
  // The service calls db.select().from(...).where(...).orderBy(...).
  // We return a thenable chain that resolves to `rows`.
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
    select: () => chain,
  };
  return {
    select: () => chain,
  };
}

function makeObsRow(
  pricePaise: number,
  observedAt: Date,
  opts: {
    catalogItemId?: string;
    priceSourceId?: string;
    packQuantityBase?: number | null;
    unit?: "g" | "ml" | "piece" | null;
  } = {},
): FakeRow {
  return {
    id: crypto.randomUUID(),
    userId: "00000000-0000-4000-a000-000000000001",
    catalogItemId: opts.catalogItemId ?? "00000000-0000-4000-a000-000000000002",
    priceSourceId: opts.priceSourceId ?? "00000000-0000-4000-a000-000000000003",
    pricePaise,
    mrpPaise: null,
    packQuantityBase: opts.packQuantityBase !== undefined ? opts.packQuantityBase : null,
    unit: opts.unit !== undefined ? opts.unit : null,
    observedAt,
    createdAt: observedAt,
  };
}

const WITHIN_30_DAYS = new Date("2026-01-10T00:00:00.000Z");

test("checkPriceHonesty: claimed MRP ₹1000 (=100000p), max observed ₹850 (=85000p) → flagged (>110%)", async () => {
  // 100000 > 85000 * 110 / 100 = 93500 → flagged
  const rows = [makeObsRow(85000, WITHIN_30_DAYS)];
  const db = makeFakeDb(rows);
  const result = await checkPriceHonesty(
    db as never,
    "00000000-0000-4000-a000-000000000001",
    "00000000-0000-4000-a000-000000000002",
    undefined,
    100000,
  );
  assert.equal(result.flagged, true, "should be flagged: 100000 > 85000*1.1=93500");
  assert.equal(result.maxObservedPricePaise, 85000);
  assert.equal(result.claimedMrpPaise, 100000);
  assert.equal(result.inflationThresholdPct, INFLATION_THRESHOLD_PCT);
});

test("checkPriceHonesty: claimed MRP ₹1000 (=100000p), max observed ₹950 (=95000p) → not flagged (<110%)", async () => {
  // 100000 vs 95000 * 110 / 100 = 104500 → 100000 < 104500 → not flagged
  const rows = [makeObsRow(95000, WITHIN_30_DAYS)];
  const db = makeFakeDb(rows);
  const result = await checkPriceHonesty(
    db as never,
    "00000000-0000-4000-a000-000000000001",
    "00000000-0000-4000-a000-000000000002",
    undefined,
    100000,
  );
  assert.equal(result.flagged, false, "should not be flagged: 100000 <= 95000*1.1=104500");
  assert.equal(result.maxObservedPricePaise, 95000);
});

test("checkPriceHonesty: no observations → not flagged, maxObservedPricePaise: null", async () => {
  const db = makeFakeDb([]);
  const result = await checkPriceHonesty(
    db as never,
    "00000000-0000-4000-a000-000000000001",
    "00000000-0000-4000-a000-000000000002",
    undefined,
    100000,
  );
  assert.equal(result.flagged, false);
  assert.equal(result.maxObservedPricePaise, null);
  assert.deepEqual(result.evidence, []);
});

test("checkPriceHonesty: different pack sizes excluded from honesty check (filter by packQuantityBase+unit)", async () => {
  // Two observations: one 500g pack, one 1000g pack. Caller passes 500g.
  const rows = [
    makeObsRow(50000, WITHIN_30_DAYS, { packQuantityBase: 500, unit: "g" }),   // matching
    makeObsRow(90000, WITHIN_30_DAYS, { packQuantityBase: 1000, unit: "g" }),  // different pack — excluded
  ];
  const db = makeFakeDb(rows);
  // Claimed MRP 60000p for 500g pack. Max observed for 500g = 50000p.
  // 60000 > 50000 * 110 / 100 = 55000 → flagged
  const result = await checkPriceHonesty(
    db as never,
    "00000000-0000-4000-a000-000000000001",
    "00000000-0000-4000-a000-000000000002",
    undefined,
    60000,
    500,
    "g",
  );
  // Only the 500g observation is in evidence — the 1000g one must be excluded.
  assert.equal(result.evidence.length, 1, "only the 500g observation should be in evidence");
  assert.equal(result.maxObservedPricePaise, 50000);
  assert.equal(result.flagged, true, "60000 > 55000 → flagged");
});
