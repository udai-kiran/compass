/**
 * Tests for money.ts — unit-price + unit-conversion helpers (task 9.3).
 *
 * The pre-existing helpers (rupeesToPaise, formatINR, standardEmiPaise) are
 * exercised implicitly through the rest of the test suite; this file focuses
 * on the two new pure helpers: unitPricePaise and convertToBaseQuantity.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { unitPricePaise, convertToBaseQuantity } from "./money.ts";

// ── unitPricePaise — examples ─────────────────────────────────────────────────

test("unitPricePaise: ₹100 / 5000 g → 2000 p (₹20/kg)", () => {
  assert.equal(unitPricePaise(10000, 5000, "g"), 2000);
});

test("unitPricePaise: ₹100 / 2000 ml → 5000 p (₹50/L)", () => {
  assert.equal(unitPricePaise(10000, 2000, "ml"), 5000);
});

test("unitPricePaise: ₹100 / 6 pieces → 1667 p (round-half-up)", () => {
  // 10000/6 = 1666.666… → rounds up to 1667
  assert.equal(unitPricePaise(10000, 6, "piece"), 1667);
});

test("unitPricePaise: exact half rounds up (3p / 2 pieces = 1.5 → 2)", () => {
  // (2·3·1 + 2) / (2·2) = 8/4 = 2 ✓
  assert.equal(unitPricePaise(3, 2, "piece"), 2);
});

test("unitPricePaise: 7p / 4 pieces = 1.75 → 2 (rounds up)", () => {
  // (2·7·1 + 4) / (2·4) = 18/8 = 2 (floor of 2.25 would be 2 too, but 1.75 rounds to 2)
  assert.equal(unitPricePaise(7, 4, "piece"), 2);
});

test("unitPricePaise: zero price is valid → 0", () => {
  assert.equal(unitPricePaise(0, 500, "g"), 0);
  assert.equal(unitPricePaise(0, 1000, "ml"), 0);
  assert.equal(unitPricePaise(0, 6, "piece"), 0);
});

test("unitPricePaise: ref=1000 for g (not piece) — confirms unit matters", () => {
  // 100 paise / 100 g = 1000 p/kg
  assert.equal(unitPricePaise(100, 100, "g"), 1000);
  // 100 paise / 100 ml = 1000 p/L
  assert.equal(unitPricePaise(100, 100, "ml"), 1000);
  // 100 paise / 100 pieces = 1 p/piece
  assert.equal(unitPricePaise(100, 100, "piece"), 1);
});

test("unitPricePaise: result > MAX_SAFE_INTEGER throws RangeError", () => {
  // MAX_SAFE_INTEGER = 2^53 − 1 = 9007199254740991
  // pricePaise = MAX_SAFE_INTEGER, quantityBase=1, unit=g → result = MAX·1000
  assert.throws(
    () => unitPricePaise(Number.MAX_SAFE_INTEGER, 1, "g"),
    RangeError,
  );
});

// ── unitPricePaise — guards ───────────────────────────────────────────────────

test("unitPricePaise: zero quantityBase → RangeError", () => {
  assert.throws(() => unitPricePaise(1000, 0, "g"), RangeError);
});

test("unitPricePaise: negative quantityBase → RangeError", () => {
  assert.throws(() => unitPricePaise(1000, -1, "g"), RangeError);
});

test("unitPricePaise: negative pricePaise → RangeError", () => {
  assert.throws(() => unitPricePaise(-1, 500, "g"), RangeError);
});

test("unitPricePaise: fractional pricePaise → RangeError", () => {
  assert.throws(() => unitPricePaise(1000.5, 500, "g"), RangeError);
});

test("unitPricePaise: fractional quantityBase → RangeError", () => {
  assert.throws(() => unitPricePaise(1000, 500.5, "g"), RangeError);
});

test("unitPricePaise: invalid unit → RangeError", () => {
  assert.throws(() => unitPricePaise(1000, 500, "kg" as never), RangeError);
  assert.throws(() => unitPricePaise(1000, 500, "litre" as never), RangeError);
});

// ── unitPricePaise — property: non-increasing in quantityBase ─────────────────

test("unitPricePaise: result is non-increasing as quantityBase increases", () => {
  // Same price, more quantity → cheaper per unit (or equal if rounding).
  const price = 10000;
  const qtys = [100, 200, 500, 1000, 2000, 5000];
  let prev = unitPricePaise(price, qtys[0]!, "g");
  for (let i = 1; i < qtys.length; i++) {
    const curr = unitPricePaise(price, qtys[i]!, "g");
    assert.ok(
      curr <= prev,
      `unitPricePaise with qty=${qtys[i]} (${curr}) must be ≤ qty=${qtys[i - 1]} (${prev})`,
    );
    prev = curr;
  }
});

test("unitPricePaise: result is always non-negative", () => {
  assert.ok(unitPricePaise(0, 1, "g") >= 0);
  assert.ok(unitPricePaise(0, 1, "ml") >= 0);
  assert.ok(unitPricePaise(0, 1, "piece") >= 0);
  assert.ok(unitPricePaise(100, 3, "piece") >= 0);
});

// ── convertToBaseQuantity — examples ─────────────────────────────────────────

test("convertToBaseQuantity: '1.5' kg → 1500 g", () => {
  assert.deepEqual(convertToBaseQuantity("1.5", "kg"), { quantityBase: 1500, unit: "g" });
});

test("convertToBaseQuantity: '0.25' litre → 250 ml", () => {
  assert.deepEqual(convertToBaseQuantity("0.25", "litre"), { quantityBase: 250, unit: "ml" });
});

test("convertToBaseQuantity: '6' piece → 6 piece", () => {
  assert.deepEqual(convertToBaseQuantity("6", "piece"), { quantityBase: 6, unit: "piece" });
});

test("convertToBaseQuantity: '500' g → 500 g (passthrough)", () => {
  assert.deepEqual(convertToBaseQuantity("500", "g"), { quantityBase: 500, unit: "g" });
});

test("convertToBaseQuantity: '1000' ml → 1000 ml (passthrough)", () => {
  assert.deepEqual(convertToBaseQuantity("1000", "ml"), { quantityBase: 1000, unit: "ml" });
});

test("convertToBaseQuantity: '1' kg → 1000 g", () => {
  assert.deepEqual(convertToBaseQuantity("1", "kg"), { quantityBase: 1000, unit: "g" });
});

test("convertToBaseQuantity: '0.001' kg → 1 g (3 dp exact)", () => {
  assert.deepEqual(convertToBaseQuantity("0.001", "kg"), { quantityBase: 1, unit: "g" });
});

test("convertToBaseQuantity: '2.5' kg → 2500 g", () => {
  assert.deepEqual(convertToBaseQuantity("2.5", "kg"), { quantityBase: 2500, unit: "g" });
});

test("convertToBaseQuantity: '0.001' litre → 1 ml (3 dp exact)", () => {
  assert.deepEqual(convertToBaseQuantity("0.001", "litre"), { quantityBase: 1, unit: "ml" });
});

// ── convertToBaseQuantity — guards ───────────────────────────────────────────

test("convertToBaseQuantity: excess precision for kg → RangeError", () => {
  // 4 dp > 3 dp max
  assert.throws(() => convertToBaseQuantity("0.0001", "kg"), RangeError);
});

test("convertToBaseQuantity: excess precision for litre → RangeError", () => {
  assert.throws(() => convertToBaseQuantity("0.0001", "litre"), RangeError);
});

test("convertToBaseQuantity: fractional g → RangeError (0 dp max)", () => {
  assert.throws(() => convertToBaseQuantity("1.5", "g"), RangeError);
});

test("convertToBaseQuantity: fractional ml → RangeError (0 dp max)", () => {
  assert.throws(() => convertToBaseQuantity("0.5", "ml"), RangeError);
});

test("convertToBaseQuantity: fractional piece → RangeError (0 dp max)", () => {
  assert.throws(() => convertToBaseQuantity("1.5", "piece"), RangeError);
});

test("convertToBaseQuantity: tiny-positive-that-would-round-to-0 rejected by excess-dp check ('0.0004' kg → 4 dp)", () => {
  // With float arithmetic, 0.0004 * 1000 = 0.4 → would round to 0 g.
  // With exact decimal parsing, 4 dp exceeds 3 dp max → RangeError.
  assert.throws(() => convertToBaseQuantity("0.0004", "kg"), RangeError);
});

test("convertToBaseQuantity: invalid format → RangeError", () => {
  assert.throws(() => convertToBaseQuantity("-1", "kg"), RangeError);
  assert.throws(() => convertToBaseQuantity("abc", "g"), RangeError);
  assert.throws(() => convertToBaseQuantity("1.2.3", "kg"), RangeError);
  assert.throws(() => convertToBaseQuantity("", "g"), RangeError);
});

test("convertToBaseQuantity: invalid displayUnit → RangeError", () => {
  assert.throws(() => convertToBaseQuantity("1", "lb" as never), RangeError);
  assert.throws(() => convertToBaseQuantity("1", "oz" as never), RangeError);
  assert.throws(() => convertToBaseQuantity("1", "" as never), RangeError);
});

// ── convertToBaseQuantity — deepEqual round-trips ────────────────────────────

test("convertToBaseQuantity deepEqual: '5' kg → {quantityBase:5000, unit:'g'}", () => {
  assert.deepEqual(convertToBaseQuantity("5", "kg"), { quantityBase: 5000, unit: "g" });
});

test("convertToBaseQuantity deepEqual: '1.500' kg → {quantityBase:1500, unit:'g'}", () => {
  // Trailing zeros still yield exact parse.
  assert.deepEqual(convertToBaseQuantity("1.500", "kg"), { quantityBase: 1500, unit: "g" });
});
