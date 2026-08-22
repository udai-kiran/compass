import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDraftTotalPaise,
  decrementObservationCount,
  isPriceSpiked,
  shouldReplenish,
  suggestQuantity,
} from "./cart-draft-generator.ts";
import { MS_PER_DAY } from "./consumption-rate.ts";

const now = new Date("2026-08-22T12:00:00.000Z");
const habit = { consumptionBasePerMonth: 900, unit: "g" as const };

describe("shouldReplenish", () => {
  it("replenishes stock expected to deplete in three days", () => {
    assert.equal(
      shouldReplenish({ quantityBase: 100, unit: "g", expectedDepletionAt: new Date(now.getTime() + 3 * MS_PER_DAY) }, habit, now),
      true,
    );
  });

  it("does not replenish stock expected to deplete in ten days", () => {
    assert.equal(
      shouldReplenish({ quantityBase: 100, unit: "g", expectedDepletionAt: new Date(now.getTime() + 10 * MS_PER_DAY) }, habit, now),
      false,
    );
  });

  it("replenishes when stock quantity is unknown", () => {
    assert.equal(shouldReplenish({ quantityBase: null, unit: null, expectedDepletionAt: null }, habit, now), true);
  });

  it("skips an item without a learned consumption rate", () => {
    assert.equal(
      shouldReplenish({ quantityBase: null, unit: null, expectedDepletionAt: null }, { consumptionBasePerMonth: null, unit: null }, now),
      false,
    );
  });

  it("skips an item with a zero consumption rate", () => {
    assert.equal(
      shouldReplenish(
        { quantityBase: null, unit: null, expectedDepletionAt: null },
        { consumptionBasePerMonth: 0, unit: "g" as const },
        now,
      ),
      false,
    );
  });
});

describe("suggestQuantity", () => {
  it("returns one integer month of supply", () => {
    assert.deepEqual(suggestQuantity(habit), { quantityBase: 900, unit: "g" });
  });
});

describe("price spike calculation", () => {
  it("flags a current price at 125% of the average", () => {
    assert.equal(isPriceSpiked(125, 100), true);
  });

  it("does not flag a current price at 110% of the average", () => {
    assert.equal(isPriceSpiked(110, 100), false);
  });

  it("does not flag a missing price history", () => {
    assert.equal(isPriceSpiked(null, null), false);
  });
});

describe("calculateDraftTotalPaise", () => {
  it("sums only non-removed priced lines, treating missing prices as zero", () => {
    assert.equal(
      calculateDraftTotalPaise([
        { suggestedPricePaise: 100, isRemoved: false },
        { suggestedPricePaise: null, isRemoved: false },
        { suggestedPricePaise: 200, isRemoved: true },
      ]),
      100,
    );
  });
});

describe("teaching signal", () => {
  it("clamps a decremented observation count at zero", () => {
    assert.equal(decrementObservationCount(0), 0);
  });
});
