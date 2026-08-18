import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEqualShares, computeProportionalShares, validateExactShares } from "./split-math.ts";

describe("computeEqualShares", () => {
  it("splits evenly when divisible", () => {
    const shares = computeEqualShares(300, 3);
    assert.deepEqual(shares, [100, 100, 100]);
  });

  it("gives remainder to first N members deterministically", () => {
    // 100 paise / 3 = 33, 33, 34 — remainder 1 paise to first member
    const shares = computeEqualShares(100, 3);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(shares, [34, 33, 33]);
  });

  it("two members, odd amount", () => {
    const shares = computeEqualShares(101, 2);
    assert.equal(shares.reduce((a, b) => a + b, 0), 101);
    assert.deepEqual(shares, [51, 50]);
  });

  it("single member gets everything", () => {
    assert.deepEqual(computeEqualShares(999, 1), [999]);
  });

  it("always sums to totalPaise (property)", () => {
    for (const [total, count] of [[1, 7], [997, 3], [10000, 6], [1, 1]] as [number, number][]) {
      const shares = computeEqualShares(total, count);
      assert.equal(shares.reduce((a, b) => a + b, 0), total);
    }
  });

  it("throws on zero member count", () => {
    assert.throws(() => computeEqualShares(100, 0));
  });
});

describe("computeProportionalShares", () => {
  it("equal ratios same as equal split", () => {
    const shares = computeProportionalShares(100, [1, 1, 1]);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  });

  it("2:1 split", () => {
    const shares = computeProportionalShares(300, [2, 1]);
    assert.deepEqual(shares, [200, 100]);
  });

  it("always sums to totalPaise (property)", () => {
    const cases: [number, number[]][] = [
      [1000, [3, 1]],
      [997,  [1, 2, 3]],
      [1,    [1, 1, 1]],
      [100,  [7, 3]],
    ];
    for (const [total, ratios] of cases) {
      const shares = computeProportionalShares(total, ratios);
      assert.equal(shares.reduce((a, b) => a + b, 0), total, `failed for ${total}, [${ratios}]`);
    }
  });

  it("throws on empty ratios", () => {
    assert.throws(() => computeProportionalShares(100, []));
  });

  it("throws on non-positive ratio", () => {
    assert.throws(() => computeProportionalShares(100, [1, 0]));
  });
});

describe("validateExactShares", () => {
  it("returns 0 for valid shares", () => {
    assert.equal(validateExactShares([100, 200, 300], 600), 0);
  });

  it("returns positive shortfall when shares under-count", () => {
    assert.equal(validateExactShares([100, 100], 300), 100);
  });

  it("returns negative when shares overshoot", () => {
    assert.equal(validateExactShares([200, 200], 300), -100);
  });
});
