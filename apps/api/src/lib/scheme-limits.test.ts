/**
 * scheme-limits.test.ts — boundary tests for the pure scheme-limit library
 * (task 13.6). No DB, no clock, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  schemeRulesFor,
  addYearsIso,
  ppfMaturityDate,
  ssyDepositWindowEnd,
  completedYearsBetween,
  SECTION_80C_CAP_PAISE,
  PPF_REVIVAL_PENALTY_PER_YEAR_PAISE,
  SSY_MAX_HOLDER_AGE_YEARS,
} from "./scheme-limits.ts";

// ─── schemeRulesFor ───────────────────────────────────────────────────────────

describe("schemeRulesFor", () => {
  it("returns PPF limits in paise (₹500 min, ₹1.5L max, ₹50 multiple)", () => {
    assert.deepEqual(schemeRulesFor("ppf", "2025-26"), {
      minAnnualPaise: 50_000,
      maxAnnualPaise: 15_000_000,
      minDepositMultiple: 5_000,
      discontinuedBelowMin: true,
      revivalPenaltyPerYear: 55_000,
      deductionSection: "80C",
    });
  });

  it("returns SSY limits in paise (₹250 min, ₹1.5L max, ₹50 multiple)", () => {
    assert.deepEqual(schemeRulesFor("ssy", "2025-26"), {
      minAnnualPaise: 25_000,
      maxAnnualPaise: 15_000_000,
      minDepositMultiple: 5_000,
      discontinuedBelowMin: true,
      revivalPenaltyPerYear: 55_000,
      deductionSection: "80C",
    });
  });

  it("returns NPS Tier I limits: ₹1,000 min, NO statutory max, no 80C section", () => {
    assert.deepEqual(schemeRulesFor("nps_tier1", "2025-26"), {
      minAnnualPaise: 100_000,
      maxAnnualPaise: null,
      minDepositMultiple: 50_000,
      discontinuedBelowMin: false,
      revivalPenaltyPerYear: 0,
      deductionSection: null,
    });
  });

  it("does not mark NPS as discontinued-below-min (no dormancy rule)", () => {
    assert.equal(schemeRulesFor("nps_tier1", "2024-25").discontinuedBelowMin, false);
  });

  it("returns identical limits across FYs (no amendment modelled yet)", () => {
    for (const fy of ["2019-20", "2024-25", "2025-26", "2099-00"]) {
      assert.deepEqual(schemeRulesFor("ppf", fy), schemeRulesFor("ppf", "2025-26"));
    }
  });

  it("returns a fresh object so callers cannot mutate the shared table", () => {
    const a = schemeRulesFor("ppf", "2025-26");
    a.minAnnualPaise = 1;
    assert.equal(schemeRulesFor("ppf", "2025-26").minAnnualPaise, 50_000);
  });

  it("throws on a malformed FY label", () => {
    assert.throws(() => schemeRulesFor("ppf", "2025-2026"));
    assert.throws(() => schemeRulesFor("ppf", "2025-27"));
    assert.throws(() => schemeRulesFor("ppf", "nonsense"));
  });

  it("exposes the 80C cap and PPF revival penalty as paise constants", () => {
    assert.equal(SECTION_80C_CAP_PAISE, 15_000_000);
    // ₹50 revival fee + ₹500 arrears per defaulted year.
    assert.equal(PPF_REVIVAL_PENALTY_PER_YEAR_PAISE, 55_000);
    assert.equal(SSY_MAX_HOLDER_AGE_YEARS, 10);
  });
});

// ─── addYearsIso ──────────────────────────────────────────────────────────────

describe("addYearsIso", () => {
  it("adds whole years", () => {
    assert.equal(addYearsIso("2015-08-10", 15), "2030-08-10");
    assert.equal(addYearsIso("2000-01-01", 21), "2021-01-01");
  });

  it("clamps Feb 29 to Feb 28 in a non-leap target year", () => {
    assert.equal(addYearsIso("2016-02-29", 15), "2031-02-28");
  });

  it("keeps Feb 29 when the target year is also a leap year", () => {
    assert.equal(addYearsIso("2016-02-29", 4), "2020-02-29");
  });

  it("throws on a malformed date", () => {
    assert.throws(() => addYearsIso("2016-2-29", 1));
  });
});

// ─── ppfMaturityDate ──────────────────────────────────────────────────────────

describe("ppfMaturityDate", () => {
  it("matures 15 years from the END of the opening FY (Jun 2010 → 31 Mar 2026)", () => {
    assert.equal(ppfMaturityDate("2010-06-15"), "2026-03-31");
  });

  it("treats a March opening as the PREVIOUS FY (Mar 2011 → same FY 2010-11)", () => {
    // 2011-03-20 falls in FY 2010-11, which ends 2011-03-31 → +15y = 2026-03-31.
    assert.equal(ppfMaturityDate("2011-03-20"), "2026-03-31");
  });

  it("treats an April opening as the next FY (Apr 2011 → FY 2011-12 → 2027-03-31)", () => {
    assert.equal(ppfMaturityDate("2011-04-01"), "2027-03-31");
  });

  it("is 15 years from FY end, never 15 years from the opening date", () => {
    // A naive opened+15y would give 2025-06-15 — a whole FY earlier.
    assert.notEqual(ppfMaturityDate("2010-06-15"), "2025-06-15");
  });
});

// ─── ssyDepositWindowEnd ──────────────────────────────────────────────────────

describe("ssyDepositWindowEnd", () => {
  it("ends 15 years after the opening date", () => {
    assert.equal(ssyDepositWindowEnd("2015-08-10"), "2030-08-10");
  });

  it("clamps a 29 Feb opening", () => {
    assert.equal(ssyDepositWindowEnd("2016-02-29"), "2031-02-28");
  });
});

// ─── completedYearsBetween ────────────────────────────────────────────────────

describe("completedYearsBetween", () => {
  it("counts the exact 10th birthday as 10 completed years (still eligible)", () => {
    assert.equal(completedYearsBetween("2015-04-01", "2025-04-01"), 10);
  });

  it("counts the day before the 10th birthday as 9", () => {
    assert.equal(completedYearsBetween("2015-04-01", "2025-03-31"), 9);
  });

  it("counts the day after the 10th birthday as 10", () => {
    assert.equal(completedYearsBetween("2015-04-01", "2025-04-02"), 10);
  });

  it("counts the 11th birthday as 11 (over the SSY age gate)", () => {
    assert.equal(completedYearsBetween("2014-04-01", "2025-04-01"), 11);
  });

  it("handles same-month earlier day", () => {
    assert.equal(completedYearsBetween("2015-06-20", "2025-06-19"), 9);
    assert.equal(completedYearsBetween("2015-06-20", "2025-06-20"), 10);
  });

  it("returns 0 on the same date", () => {
    assert.equal(completedYearsBetween("2015-06-20", "2015-06-20"), 0);
  });

  it("returns a negative value when onDate precedes from", () => {
    assert.equal(completedYearsBetween("2015-06-20", "2014-06-20"), -1);
  });
});
