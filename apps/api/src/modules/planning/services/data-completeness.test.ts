/**
 * data-completeness.test.ts — unit tests for computeConfidence (pure, no DB).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeConfidence } from "./data-completeness.ts";

describe("computeConfidence", () => {
  it("returns high + empty reasons when all accounts fresh ≤ 7 days, 0 drafts, snapshot ≤ 7 days", () => {
    const result = computeConfidence({
      accounts: [
        {
          accountName: "HDFC Savings",
          lastImportDaysAgo: 3,
          lastValuationDaysAgo: null,
          dataFreshness: "fresh",
        },
        {
          accountName: "ICICI Investment",
          lastImportDaysAgo: null,
          lastValuationDaysAgo: 5,
          dataFreshness: "fresh",
        },
      ],
      unresolvedDraftCount: 0,
      lastSnapshotDaysAgo: 5,
    });
    assert.strictEqual(result.confidence, "high");
    assert.deepStrictEqual(result.confidenceReasons, []);
  });

  it("returns low and mentions the account name when one account is 45 days stale", () => {
    const result = computeConfidence({
      accounts: [
        {
          accountName: "HDFC Savings",
          lastImportDaysAgo: 45,
          lastValuationDaysAgo: null,
          dataFreshness: "stale",
        },
      ],
      unresolvedDraftCount: 0,
      lastSnapshotDaysAgo: 5,
    });
    assert.strictEqual(result.confidence, "low");
    assert.ok(
      result.confidenceReasons.some((r) => r.includes("HDFC Savings")),
      `expected a reason mentioning "HDFC Savings", got: ${JSON.stringify(result.confidenceReasons)}`,
    );
  });

  it("returns low and mentions drafts when unresolvedDraftCount is 6", () => {
    const result = computeConfidence({
      accounts: [
        {
          accountName: "HDFC Savings",
          lastImportDaysAgo: 3,
          lastValuationDaysAgo: null,
          dataFreshness: "fresh",
        },
      ],
      unresolvedDraftCount: 6,
      lastSnapshotDaysAgo: 5,
    });
    assert.strictEqual(result.confidence, "low");
    assert.ok(
      result.confidenceReasons.some((r) => r.toLowerCase().includes("draft")),
      `expected a reason mentioning drafts, got: ${JSON.stringify(result.confidenceReasons)}`,
    );
  });

  it("returns medium when snapshot is 20 days old, all accounts fresh, 0 drafts", () => {
    const result = computeConfidence({
      accounts: [
        {
          accountName: "HDFC Savings",
          lastImportDaysAgo: 3,
          lastValuationDaysAgo: null,
          dataFreshness: "fresh",
        },
      ],
      unresolvedDraftCount: 0,
      lastSnapshotDaysAgo: 20,
    });
    assert.strictEqual(result.confidence, "medium");
  });

  it("returns low and mentions missing snapshot when there are no accounts, 0 drafts, and snapshot is null", () => {
    const result = computeConfidence({
      accounts: [],
      unresolvedDraftCount: 0,
      lastSnapshotDaysAgo: null,
    });
    assert.strictEqual(result.confidence, "low");
    assert.ok(
      result.confidenceReasons.some((r) => r.toLowerCase().includes("snapshot")),
      `expected a reason mentioning "snapshot", got: ${JSON.stringify(result.confidenceReasons)}`,
    );
  });
});
