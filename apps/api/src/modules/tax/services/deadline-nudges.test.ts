/**
 * deadline-nudges.test.ts — Unit tests for the pure tax deadline nudge helpers.
 *
 * No DB, no I/O. Tests daysUntil, headroomTier, withinLeadWindow, and
 * isSchemeDormancyRisk only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  daysUntil,
  headroomTier,
  withinLeadWindow,
  isSchemeDormancyRisk,
} from "./deadline-nudges.ts";

describe("daysUntil", () => {
  it("same day → 0", () => {
    assert.strictEqual(daysUntil("2025-12-15", "2025-12-15"), 0);
  });

  it("target is 1 day ahead", () => {
    assert.strictEqual(daysUntil("2025-12-14", "2025-12-15"), 1);
  });

  it("Feb 28 to Mar 31 in non-leap year → 31 days", () => {
    // 2026 is not a leap year: Feb has 28 days
    assert.strictEqual(daysUntil("2026-02-28", "2026-03-31"), 31);
  });

  it("target in the past → negative", () => {
    assert.strictEqual(daysUntil("2026-04-01", "2026-03-31"), -1);
  });

  it("Jan 1 to Mar 31 in non-leap year → 89 days", () => {
    // Jan: 31, Feb: 28 (non-leap 2026), Mar: 31 — total 90 days inclusive = 89 days apart
    assert.strictEqual(daysUntil("2026-01-01", "2026-03-31"), 89);
  });
});

describe("headroomTier", () => {
  it("91 days out → null (too early, no nudge)", () => {
    assert.strictEqual(headroomTier(91), null);
  });

  it("90 days out → '90d' (first reminder)", () => {
    assert.strictEqual(headroomTier(90), "90d");
  });

  it("31 days out → '90d' (still in first tier)", () => {
    assert.strictEqual(headroomTier(31), "90d");
  });

  it("30 days out → '30d'", () => {
    assert.strictEqual(headroomTier(30), "30d");
  });

  it("8 days out → '30d'", () => {
    assert.strictEqual(headroomTier(8), "30d");
  });

  it("7 days out → '7d' (final warning)", () => {
    assert.strictEqual(headroomTier(7), "7d");
  });

  it("0 days (FY end day itself) → '7d'", () => {
    assert.strictEqual(headroomTier(0), "7d");
  });

  it("negative days (already past) → null", () => {
    assert.strictEqual(headroomTier(-1), null);
  });
});

describe("withinLeadWindow", () => {
  it("0 days out, 30-day window → true", () => {
    assert.strictEqual(withinLeadWindow(0, 30), true);
  });

  it("30 days out, 30-day window → true (inclusive upper bound)", () => {
    assert.strictEqual(withinLeadWindow(30, 30), true);
  });

  it("31 days out, 30-day window → false (too early)", () => {
    assert.strictEqual(withinLeadWindow(31, 30), false);
  });

  it("-1 days out (already passed) → false", () => {
    assert.strictEqual(withinLeadWindow(-1, 30), false);
  });
});

describe("isSchemeDormancyRisk", () => {
  it("PPF below minimum, FY still open → true", () => {
    assert.strictEqual(
      isSchemeDormancyRisk({ schemeKind: "ppf", statusCode: "discontinued_risk" }),
      true,
    );
  });

  it("SSY below minimum, FY completed → true", () => {
    assert.strictEqual(
      isSchemeDormancyRisk({ schemeKind: "ssy", statusCode: "discontinued" }),
      true,
    );
  });

  it("PPF ok → false", () => {
    assert.strictEqual(isSchemeDormancyRisk({ schemeKind: "ppf", statusCode: "ok" }), false);
  });

  it("NPS Tier I below_min → false (not a PPF/SSY discontinuation risk)", () => {
    assert.strictEqual(
      isSchemeDormancyRisk({ schemeKind: "nps_tier1", statusCode: "below_min" }),
      false,
    );
  });

  it("SSY outside deposit window → false (not a below-minimum risk)", () => {
    assert.strictEqual(
      isSchemeDormancyRisk({ schemeKind: "ssy", statusCode: "outside_deposit_window" }),
      false,
    );
  });
});

describe("dormancy nudge tier-gating (headroomTier reused for scheme-dormancy nudge)", () => {
  // evaluateTaxDeadlineNudges gates the PPF/SSY dormancy nudge on
  // `headroomTier(daysToFyEnd) !== null` (the same 90/30/7-day window as the
  // 80C/80D headroom nudges) *in addition to* isSchemeDormancyRisk, so it
  // can no longer fire the moment scheme-compliance.ts reports
  // discontinued_risk early in the FY (e.g. right after 1 April) and then
  // never fire again as 31 March approaches. These two pure helpers are what
  // that gate composes; the actual `if (tier !== null && isSchemeDormancyRisk(...))`
  // integration inside evaluateTaxDeadlineNudges is DB-backed (reads
  // scheme-compliance results and writes alert_ledger via fireOnce) and, like
  // the rest of this file's DB-backed logic, cannot be exercised without a
  // live DB in this sandbox — only the pure helpers below are unit-tested here.

  it("far from FY-end (200 days out) → headroomTier is null → dormancy nudge would NOT fire", () => {
    assert.strictEqual(headroomTier(200), null);
  });

  it("just past FY-start (365 days before next FY-end, i.e. far out) → still null", () => {
    // e.g. 2 April with FY end 31 March next year — the exact early-FY case
    // described in the bug report.
    assert.strictEqual(headroomTier(363), null);
  });

  it("within the 90-day window with an active dormancy risk → dormancy nudge WOULD fire", () => {
    const daysToFyEnd = 45;
    const result = { schemeKind: "ppf" as const, statusCode: "discontinued_risk" as const };
    assert.strictEqual(headroomTier(daysToFyEnd), "90d");
    assert.strictEqual(isSchemeDormancyRisk(result), true);
  });

  it("within the 7-day final window with an active dormancy risk → escalates to '7d'", () => {
    const daysToFyEnd = 3;
    const result = { schemeKind: "ssy" as const, statusCode: "discontinued" as const };
    assert.strictEqual(headroomTier(daysToFyEnd), "7d");
    assert.strictEqual(isSchemeDormancyRisk(result), true);
  });

  it("outside the window even with an active dormancy risk → gate blocks the fire", () => {
    const daysToFyEnd = 150;
    const result = { schemeKind: "ppf" as const, statusCode: "discontinued_risk" as const };
    assert.strictEqual(headroomTier(daysToFyEnd), null);
    assert.strictEqual(isSchemeDormancyRisk(result), true); // risk is real, but gate blocks it
  });
});
