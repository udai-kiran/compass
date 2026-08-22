/**
 * Unit tests for basket-arbitrage.ts — pure function, no DB.
 *
 * All prices are integer paise (1 rupee = 100 paise).
 * All IDs are v4-style UUIDs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SOURCES, optimizeBasket } from "./basket-arbitrage.ts";
import type { SourceInfo } from "./basket-arbitrage.ts";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

// Source IDs
const S1 = "00000000-0000-4000-a000-000000000001";
const S2 = "00000000-0000-4000-a000-000000000002";
const S3 = "00000000-0000-4000-a000-000000000003";

// Shopping list item IDs
const I1 = "00000000-0000-4000-b000-000000000001";
const I2 = "00000000-0000-4000-b000-000000000002";
const I3 = "00000000-0000-4000-b000-000000000003";

const OBS_DATE = new Date("2026-01-01T00:00:00.000Z");

/** Convenience: build a priceMap entry. */
function entry(pricePaise: number) {
  return { pricePaise, observedAt: OBS_DATE };
}

// ─── Test 1: All items cheapest on one source (no delivery fee) ───────────────

test("optimizeBasket: all items cheapest on one source — no delivery fee, saving = 0", () => {
  const sources: SourceInfo[] = [
    { sourceId: S1, sourceName: "Cheap Store", deliveryFeePaise: 0, minCartPaise: null },
    { sourceId: S2, sourceName: "Pricey Store", deliveryFeePaise: 0, minCartPaise: null },
  ];
  const priceMap = new Map([
    [`${I1}:${S1}`, entry(10000)], // ₹100 on S1
    [`${I1}:${S2}`, entry(20000)], // ₹200 on S2
    [`${I2}:${S1}`, entry(30000)], // ₹300 on S1
    [`${I2}:${S2}`, entry(40000)], // ₹400 on S2
  ]);

  const result = optimizeBasket([I1, I2], sources, priceMap);

  // S1 beats S2 on both items; no split needed.
  assert.equal(result.splits.length, 1, "one source should win");
  assert.equal(result.splits[0]!.sourceId, S1);
  assert.equal(result.splits[0]!.itemSubtotalPaise, 40000); // 10000 + 30000
  assert.equal(result.splits[0]!.deliveryFeePaise, 0);
  assert.equal(result.splits[0]!.totalPaise, 40000);
  assert.equal(result.grandTotalPaise, 40000);
  assert.equal(result.bestSingleSourceTotalPaise, 40000);
  assert.equal(result.savingPaise, 0);
  assert.deepEqual(result.unpricedItemIds, []);
  assert.equal(result.tooFewSources, false);

  // Price evidence should be correct
  assert.equal(result.splits[0]!.priceEvidenceByItemId[I1]!.pricePaise, 10000);
  assert.equal(result.splits[0]!.priceEvidenceByItemId[I2]!.pricePaise, 30000);
});

// ─── Test 2: Split across two sources saves more than both delivery fees ───────

test("optimizeBasket: split saves more than combined delivery fees", () => {
  const sources: SourceInfo[] = [
    { sourceId: S1, sourceName: "Store A", deliveryFeePaise: 4000, minCartPaise: null }, // ₹40
    { sourceId: S2, sourceName: "Store B", deliveryFeePaise: 4000, minCartPaise: null }, // ₹40
  ];
  // Each item is drastically cheaper on one source.
  const priceMap = new Map([
    [`${I1}:${S1}`, entry(1000)],   // ₹10 — very cheap on S1
    [`${I1}:${S2}`, entry(100000)], // ₹1000 — very expensive on S2
    [`${I2}:${S1}`, entry(100000)], // ₹1000 — very expensive on S1
    [`${I2}:${S2}`, entry(1000)],   // ₹10 — very cheap on S2
  ]);

  const result = optimizeBasket([I1, I2], sources, priceMap);

  // Best split: I1→S1, I2→S2 → (1000+4000) + (1000+4000) = 10000
  // Best single: S1 or S2 → 1000 + 100000 + 4000 = 105000
  assert.equal(result.grandTotalPaise, 10000);
  assert.equal(result.bestSingleSourceTotalPaise, 105000);
  assert.equal(result.savingPaise, 95000); // 105000 − 10000
  assert.equal(result.splits.length, 2);
  assert.equal(result.unpricedItemIds.length, 0);
  assert.equal(result.tooFewSources, false);

  // Verify assignments
  const planS1 = result.splits.find((s) => s.sourceId === S1)!;
  const planS2 = result.splits.find((s) => s.sourceId === S2)!;
  assert.ok(planS1);
  assert.ok(planS2);
  assert.deepEqual(planS1.assignedItemIds, [I1]);
  assert.deepEqual(planS2.assignedItemIds, [I2]);
});

// ─── Test 3: Split worse than single source — single-source result returned ───

test("optimizeBasket: high delivery fees make splitting worse — optimizer returns single-source", () => {
  // S3 is cheapest on both items. Splitting would add extra delivery fees.
  const sources: SourceInfo[] = [
    { sourceId: S1, sourceName: "Store A", deliveryFeePaise: 5000, minCartPaise: null }, // ₹50
    { sourceId: S2, sourceName: "Store B", deliveryFeePaise: 5000, minCartPaise: null }, // ₹50
    { sourceId: S3, sourceName: "Store C", deliveryFeePaise: 5000, minCartPaise: null }, // ₹50
  ];
  const priceMap = new Map([
    [`${I1}:${S1}`, entry(500)],
    [`${I1}:${S2}`, entry(600)],
    [`${I1}:${S3}`, entry(400)], // cheapest for I1
    [`${I2}:${S1}`, entry(600)],
    [`${I2}:${S2}`, entry(700)],
    [`${I2}:${S3}`, entry(500)], // cheapest for I2
  ]);

  const result = optimizeBasket([I1, I2], sources, priceMap);

  // Best single: S3 → 400+500+5000 = 5900
  // Any 2-source split adds ≥2 delivery fees (≥10000) which dwarfs price differences
  // Optimizer will choose subset {S3} = 5900 as the minimum
  assert.equal(result.grandTotalPaise, 5900);
  assert.equal(result.bestSingleSourceTotalPaise, 5900);
  assert.equal(result.savingPaise, 0);
  assert.equal(result.splits.length, 1, "single-source is optimal — no actual split");
  assert.equal(result.splits[0]!.sourceId, S3);
  assert.equal(result.tooFewSources, false);
});

// ─── Test 4: Items without price observations go in unpricedItemIds ───────────

test("optimizeBasket: items without prices appear in unpricedItemIds, not in splits", () => {
  const sources: SourceInfo[] = [
    { sourceId: S1, sourceName: "Store A", deliveryFeePaise: 0, minCartPaise: null },
    { sourceId: S2, sourceName: "Store B", deliveryFeePaise: 0, minCartPaise: null },
  ];
  // I3 has NO price on any source — it must appear in unpricedItemIds.
  const priceMap = new Map([
    [`${I1}:${S1}`, entry(1000)],
    [`${I1}:${S2}`, entry(1500)],
    [`${I2}:${S1}`, entry(2000)],
    [`${I2}:${S2}`, entry(1800)],
    // I3 intentionally omitted
  ]);

  const result = optimizeBasket([I1, I2, I3], sources, priceMap);

  assert.deepEqual(result.unpricedItemIds, [I3]);

  // I3 must NOT appear in any split's assignedItemIds
  for (const split of result.splits) {
    assert.ok(!split.assignedItemIds.includes(I3), `I3 must not be in splits`);
  }

  // I1 and I2 should be optimized: I1→S1(1000), I2→S2(1800) = 2800 beats all-S1=3000
  assert.ok(result.grandTotalPaise <= 3000, `grandTotal should not exceed all-S1 cost`);
  assert.equal(result.grandTotalPaise, 2800); // optimal split
  assert.equal(result.bestSingleSourceTotalPaise, 3000); // S1 covers both: 1000+2000
  assert.equal(result.savingPaise, 200);
});

// ─── Test 5: deliveryFeePaise and minCartPaise fields appear correctly ─────────

test("optimizeBasket: deliveryFeePaise always added per source; minCartPaise in output", () => {
  const sources: SourceInfo[] = [
    // I1 only priced on S1; I2 only priced on S2 — must use both sources
    { sourceId: S1, sourceName: "Quick Store", deliveryFeePaise: 2000, minCartPaise: 10000 },
    { sourceId: S2, sourceName: "Regular Store", deliveryFeePaise: 3000, minCartPaise: null },
  ];
  const priceMap = new Map([
    [`${I1}:${S1}`, entry(15000)], // ₹150 — meets S1's ₹100 minCart
    [`${I2}:${S2}`, entry(8000)],  // ₹80
  ]);

  const result = optimizeBasket([I1, I2], sources, priceMap);

  // Only viable subset is {S1, S2}
  assert.equal(result.splits.length, 2);
  assert.equal(result.unpricedItemIds.length, 0);
  assert.equal(result.bestSingleSourceTotalPaise, null, "no single source covers both items");
  assert.equal(result.savingPaise, 0, "saving is 0 when bestSingle is null");

  const planS1 = result.splits.find((s) => s.sourceId === S1)!;
  assert.ok(planS1, "S1 plan must exist");
  assert.equal(planS1.itemSubtotalPaise, 15000);
  assert.equal(planS1.deliveryFeePaise, 2000); // always added
  assert.equal(planS1.minCartPaise, 10000);    // informational field present
  assert.equal(planS1.totalPaise, 17000);      // 15000 + 2000

  const planS2 = result.splits.find((s) => s.sourceId === S2)!;
  assert.ok(planS2, "S2 plan must exist");
  assert.equal(planS2.itemSubtotalPaise, 8000);
  assert.equal(planS2.deliveryFeePaise, 3000); // always added
  assert.equal(planS2.minCartPaise, null);     // null when unknown
  assert.equal(planS2.totalPaise, 11000);      // 8000 + 3000

  assert.equal(result.grandTotalPaise, 28000); // 17000 + 11000
  assert.equal(result.tooFewSources, false);
});

// ─── Test 6: Source cap — throws when sources.length > MAX_SOURCES ─────────────

test("optimizeBasket: throws Error when sources exceed MAX_SOURCES (16 sources)", () => {
  const tooManySources: SourceInfo[] = Array.from({ length: MAX_SOURCES + 1 }, (_, i) => ({
    sourceId: `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`,
    sourceName: `Source ${i + 1}`,
    deliveryFeePaise: 0,
    minCartPaise: null,
  }));

  assert.throws(
    () => optimizeBasket([I1], tooManySources, new Map()),
    (err: unknown) => {
      return err instanceof Error && err.message === `Too many sources: ${MAX_SOURCES + 1}`;
    },
    "should throw with the source count in the message",
  );
});
