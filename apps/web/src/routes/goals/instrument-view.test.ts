import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tierLabel, tierBadgeClass } from "./instrument-view.ts";

describe("tierLabel", () => {
  it('returns "Best fit" for ideal', () => {
    assert.equal(tierLabel("ideal"), "Best fit");
  });

  it('returns "Suitable" for suitable', () => {
    assert.equal(tierLabel("suitable"), "Suitable");
  });

  it('returns "Use with caution" for caution', () => {
    assert.equal(tierLabel("caution"), "Use with caution");
  });
});

describe("tierBadgeClass", () => {
  it("includes emerald for ideal", () => {
    assert.ok(tierBadgeClass("ideal").includes("emerald"));
  });

  it("includes amber for caution", () => {
    assert.ok(tierBadgeClass("caution").includes("amber"));
  });

  it("includes blue for suitable", () => {
    assert.ok(tierBadgeClass("suitable").includes("blue"));
  });
});
