import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeEqualShares,
  computeProportionalShares,
  validateExactShares,
} from "./split-math.ts";

describe("computeEqualShares", () => {
  it("splits evenly with no remainder", () => {
    assert.deepEqual(computeEqualShares(300, 3), [100, 100, 100]);
  });

  it("distributes remainder to first members", () => {
    assert.deepEqual(computeEqualShares(100, 3), [34, 33, 33]);
  });
});

describe("computeProportionalShares", () => {
  it("splits 2:1 proportionally", () => {
    const shares = computeProportionalShares(300, [2, 1]);
    assert.deepEqual(shares, [200, 100]);
  });

  it("preserves total with remainder", () => {
    const shares = computeProportionalShares(100, [2, 1]);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  });
});

describe("validateExactShares", () => {
  it("returns 0 for valid shares", () => {
    assert.equal(validateExactShares([50, 50], 100), 0);
  });

  it("returns difference when shares don't match", () => {
    assert.equal(validateExactShares([40, 50], 100), 10);
  });
});
