/**
 * epf-contributions.test.ts — Unit tests for the EPF reconciliation pure
 * helpers (task 13.5, fix round 2).
 *
 * Covers the hermetically-testable pure functions:
 *   - computeStatus            — pending / matched / mismatch state machine (all 4 components)
 *   - fyToWageMonthRange       — FY label → inclusive wage-month range
 *   - isGapEligible            — 45-day grace period eligibility check
 *   - computeEpfProjection     — year-by-year integer corpus compounding
 *   - buildEpfContributionDto  — DB row → DTO, incl. 80C + grossEmployer eligibility
 *
 * DB-backed upsert/idempotency behaviour is exercised by integration tests.
 * No DB, no network — all tests are synchronous and fast.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeStatus,
  fyToWageMonthRange,
  isGapEligible,
  computeEpfProjection,
  buildEpfContributionDto,
} from "./epf-contributions.ts";
import { HttpError } from "../../../lib/errors.ts";

// ─── computeStatus ────────────────────────────────────────────────────────────
// New H4 rule: stays 'pending' while ANY component with a positive expected value
// still has a null actual. All four components checked: employee, employer, EPS, VPF.
// Mismatch uses integer cross-multiplication (no floating point).

function statusRow(overrides: Partial<Parameters<typeof computeStatus>[0]> = {}) {
  return {
    actualEmployeePaise: 180000,
    actualEmployerPaise: 55000,
    actualEpsPaise: 125000,
    actualVpfPaise: null as number | null,
    expectedEmployeePaise: 180000,
    expectedEmployerPaise: 55000,
    expectedEpsPaise: 125000,
    expectedVpfPaise: 0, // NOT NULL DEFAULT 0 in DB; 0 = no VPF expected
    ...overrides,
  };
}

describe("computeStatus", () => {
  it("returns pending when actual employee is null and expected employee is positive", () => {
    assert.equal(computeStatus(statusRow({ actualEmployeePaise: null })), "pending");
  });

  it("returns pending even when some actuals are set but employee is null", () => {
    const status = computeStatus(
      statusRow({ actualEmployeePaise: null, actualEmployerPaise: 55000 }),
    );
    assert.equal(status, "pending");
  });

  it("returns pending when eps actual is null and expected eps is positive (new H4 rule)", () => {
    // Previously this returned 'matched'; with H4, any positive-expected/null-actual → pending.
    assert.equal(computeStatus(statusRow({ actualEpsPaise: null })), "pending");
  });

  it("returns pending when employer actual is null and expected employer is positive", () => {
    assert.equal(computeStatus(statusRow({ actualEmployerPaise: null })), "pending");
  });

  it("returns pending when vpf actual is null and expected vpf is positive", () => {
    assert.equal(
      computeStatus(statusRow({ expectedVpfPaise: 50000, actualVpfPaise: null })),
      "pending",
    );
  });

  it("returns matched on exact match across all three columns (vpf=0, no vpf expected)", () => {
    // actualVpfPaise=null is fine because expectedVpfPaise=0 (zero→not a pending trigger).
    assert.equal(computeStatus(statusRow()), "matched");
  });

  it("returns matched when the difference is within the 1% tolerance", () => {
    // 180000 → 181000 is 0.55% — inside tolerance (|1000|*100=100000 ≤ 180000).
    assert.equal(computeStatus(statusRow({ actualEmployeePaise: 181000 })), "matched");
  });

  it("returns matched at exactly 1% difference (boundary — not a mismatch)", () => {
    // 180000 * 1% = 1800; actual = 181800; |1800|*100 = 180000 = expected → NOT >expected.
    assert.equal(computeStatus(statusRow({ actualEmployeePaise: 181800 })), "matched");
  });

  it("returns mismatch when employee differs by more than 1%", () => {
    // 180000 → 190000 is 5.6% — outside tolerance.
    assert.equal(computeStatus(statusRow({ actualEmployeePaise: 190000 })), "mismatch");
  });

  it("returns mismatch when employer differs by more than 1%", () => {
    assert.equal(computeStatus(statusRow({ actualEmployerPaise: 90000 })), "mismatch");
  });

  it("returns mismatch when eps differs by more than 1%", () => {
    assert.equal(computeStatus(statusRow({ actualEpsPaise: 200000 })), "mismatch");
  });

  it("returns mismatch when vpf actual differs from expected by more than 1%", () => {
    // expected 50000, actual 60000 = 20% difference.
    assert.equal(
      computeStatus(statusRow({ expectedVpfPaise: 50000, actualVpfPaise: 60000 })),
      "mismatch",
    );
  });

  it("returns matched when vpf actual matches expected within 1%", () => {
    // expected 50000, actual 50400 = 0.8% — inside tolerance.
    assert.equal(
      computeStatus(statusRow({ expectedVpfPaise: 50000, actualVpfPaise: 50400 })),
      "matched",
    );
  });

  it("treats a null expected column as not a pending trigger and not comparable (no mismatch)", () => {
    // expectedEmployerPaise=null: null expected → no pending trigger, no mismatch check.
    const status = computeStatus(
      statusRow({ expectedEmployerPaise: null, actualEmployerPaise: 999999 }),
    );
    assert.equal(status, "matched");
  });

  it("a zero expected EPS with a null actual now needs confirmation (blocker 1 — EPS/employer/employee lost their zero exception)", () => {
    // expectedEpsPaise=0: for employee/employer/EPS, zero expected still triggers pending
    // when actual is null (only VPF keeps the zero-skip exception).
    // statusRow() defaults: actualEmployeePaise=180000, actualEmployerPaise=55000 (non-null),
    // actualVpfPaise=null, expectedVpfPaise=0 — so the leading all-null check is NOT triggered.
    const status = computeStatus(statusRow({ expectedEpsPaise: 0, actualEpsPaise: null }));
    assert.equal(status, "pending");
  });

  it("a zero expected employee with a null actual needs confirmation (no zero exception for employee)", () => {
    // expectedEmployeePaise=0, actualEmployeePaise=null → needsConfirmation(0, null) = true → pending.
    // statusRow() defaults: actualEmployerPaise=55000, actualEpsPaise=125000 (non-null),
    // so the leading all-null check is NOT triggered.
    const status = computeStatus(statusRow({ expectedEmployeePaise: 0, actualEmployeePaise: null }));
    assert.equal(status, "pending");
  });

  it("a zero expected employer with a null actual needs confirmation (no zero exception for employer)", () => {
    // expectedEmployerPaise=0, actualEmployerPaise=null → needsConfirmation(0, null) = true → pending.
    // statusRow() defaults: actualEmployeePaise=180000, actualEpsPaise=125000 (non-null),
    // so the leading all-null check is NOT triggered.
    const status = computeStatus(statusRow({ expectedEmployerPaise: 0, actualEmployerPaise: null }));
    assert.equal(status, "pending");
  });

  it("treats a zero expected column as not comparable for mismatch (avoids divide-by-zero)", () => {
    // expectedEpsPaise=0, actualEpsPaise=125000: zero expected → no mismatch flagged.
    const status = computeStatus(statusRow({ expectedEpsPaise: 0, actualEpsPaise: 125000 }));
    assert.equal(status, "matched");
  });

  it("returns pending when all four actuals are null, even with all expected null/zero (fresh unconfirmed row)", () => {
    const status = computeStatus({
      actualEmployeePaise: null,
      actualEmployerPaise: null,
      actualEpsPaise: null,
      actualVpfPaise: null,
      expectedEmployeePaise: null,
      expectedEmployerPaise: null,
      expectedEpsPaise: null,
      expectedVpfPaise: 0,
    });
    assert.equal(status, "pending");
  });

  it("flags a mismatch when actual is lower than expected by more than 1%", () => {
    assert.equal(computeStatus(statusRow({ actualEmployeePaise: 100000 })), "mismatch");
  });

  it("returns matched when all expected are null (or zero vpf) but actuals are set", () => {
    const status = computeStatus({
      actualEmployeePaise: 180000,
      actualEmployerPaise: null,
      actualEpsPaise: null,
      actualVpfPaise: null,
      expectedEmployeePaise: null,
      expectedEmployerPaise: null,
      expectedEpsPaise: null,
      expectedVpfPaise: 0,
    });
    assert.equal(status, "matched");
  });
});

// ─── isGapEligible ───────────────────────────────────────────────────────────

describe("isGapEligible", () => {
  it("returns false on the day the wage month ends (day 0 of grace)", () => {
    // wageMonth "2025-06" ends on 2025-06-30; grace period ends 45 days later = 2025-08-14.
    assert.equal(isGapEligible("2025-06", new Date("2025-06-30T00:00:00Z")), false);
  });

  it("returns false on day 44 of grace (one day before threshold)", () => {
    // 45 days after 2025-06-30 = 2025-08-14; day 44 = 2025-08-13.
    assert.equal(isGapEligible("2025-06", new Date("2025-08-13T12:00:00Z")), false);
  });

  it("returns true on day 45 of grace (exactly at threshold)", () => {
    // 2025-06-30 + 45 days = 2025-08-14.
    assert.equal(isGapEligible("2025-06", new Date("2025-08-14T00:00:00Z")), true);
  });

  it("returns true well after the grace period", () => {
    assert.equal(isGapEligible("2025-06", new Date("2025-12-01T00:00:00Z")), true);
  });

  it("handles month-end rollover correctly for month with 31 days", () => {
    // wageMonth "2025-03" ends on 2025-03-31; grace = 2025-05-15.
    assert.equal(isGapEligible("2025-03", new Date("2025-05-14T23:59:59Z")), false);
    assert.equal(isGapEligible("2025-03", new Date("2025-05-15T00:00:00Z")), true);
  });

  it("handles February edge case (non-leap year)", () => {
    // wageMonth "2025-02" ends on 2025-02-28; grace = 2025-04-14.
    assert.equal(isGapEligible("2025-02", new Date("2025-04-13T23:59:59Z")), false);
    assert.equal(isGapEligible("2025-02", new Date("2025-04-14T00:00:00Z")), true);
  });
});

// ─── computeEpfProjection ─────────────────────────────────────────────────────

describe("computeEpfProjection", () => {
  it("returns currentCorpusPaise unchanged when monthsToRetirement is 0", () => {
    assert.equal(computeEpfProjection(1_000_000, 0, 825), 1_000_000);
  });

  it("compounds once for 12 months (one year)", () => {
    // 1000000 * (10000 + 825) / 10000 = 1000000 * 10825/10000 = 1082500
    assert.equal(computeEpfProjection(1_000_000, 12, 825), 1_082_500);
  });

  it("compounds twice for 24 months (two years, integer at each step)", () => {
    // Year 1: 1000000 * 10825/10000 = 1082500
    // Year 2: 1082500 * 10825/10000 = 1171806.25 → Math.round = 1171806
    assert.equal(computeEpfProjection(1_000_000, 24, 825), 1_171_806);
  });

  it("uses only whole years (13 months = 1 full year, not 1.08 years)", () => {
    // 13 months → floor(13/12) = 1 year → same as 12 months
    assert.equal(computeEpfProjection(1_000_000, 13, 825), computeEpfProjection(1_000_000, 12, 825));
  });

  it("uses only whole years (23 months = 1 full year)", () => {
    assert.equal(computeEpfProjection(1_000_000, 23, 825), computeEpfProjection(1_000_000, 12, 825));
  });

  it("returns zero when currentCorpusPaise is zero", () => {
    assert.equal(computeEpfProjection(0, 120, 825), 0);
  });

  it("produces integer results (no fractional paise)", () => {
    const result = computeEpfProjection(999_999, 36, 825);
    assert.equal(result, Math.floor(result));
  });

  it("produces an exact BigInt result for a corpus where the intermediate product exceeds Number.MAX_SAFE_INTEGER", () => {
    // corpus = 8_000_000_000_200 paise (~₹80 crore)
    // corpus * (10000 + 825) = 8_000_000_000_200 * 10825 ≈ 8.66e16 > MAX_SAFE_INTEGER ≈ 9.007e15
    // so the old plain-number multiplication would have lost precision.
    // Expected: (8000000000200n * 10825n + 5000n) / 10000n
    // = (86600000002165000n + 5000n) / 10000n
    // = 86600000002170000n / 10000n
    // = 8660000000217n → 8_660_000_000_217
    const expectedBigInt = (8000000000200n * 10825n + 5000n) / 10000n;
    const expected = Number(expectedBigInt);
    assert.ok(Number.isSafeInteger(expected), "expected result must itself be a safe integer");
    const result = computeEpfProjection(8_000_000_000_200, 12, 825);
    assert.equal(result, expected);
    assert.ok(Number.isSafeInteger(result), "result must be a safe integer");
  });

  it("throws HttpError 500 when a compounding step produces a result exceeding Number.MAX_SAFE_INTEGER", () => {
    // Starting corpus 9_000_000_000_000_000 paise (9e15, a safe integer — just below MAX_SAFE ~9.007e15).
    // After 1 year at 825 bps: 9_000_000_000_000_000 * 10825 / 10000 ≈ 9_742_500_000_000_000 > MAX_SAFE_INTEGER.
    // The overflow guard must throw HttpError(500) so the app error handler preserves the message.
    assert.throws(
      () => computeEpfProjection(9_000_000_000_000_000, 12, 825),
      (err: unknown) => err instanceof HttpError && err.statusCode === 500,
    );
  });
});

// ─── fyToWageMonthRange ───────────────────────────────────────────────────────

describe("fyToWageMonthRange", () => {
  it("maps FY 2025-26 to April 2025 → March 2026", () => {
    assert.deepEqual(fyToWageMonthRange("2025-26"), { start: "2025-04", end: "2026-03" });
  });

  it("maps FY 2024-25 to April 2024 → March 2025", () => {
    assert.deepEqual(fyToWageMonthRange("2024-25"), { start: "2024-04", end: "2025-03" });
  });

  it("handles a century rollover FY 2099-00", () => {
    assert.deepEqual(fyToWageMonthRange("2099-00"), { start: "2099-04", end: "2100-03" });
  });

  it("produces a range that string-orders correctly for wage_month comparison", () => {
    const { start, end } = fyToWageMonthRange("2025-26");
    assert.ok(start <= "2025-04" && "2025-04" <= end, "April is in range");
    assert.ok(start <= "2026-03" && "2026-03" <= end, "March is in range");
    assert.ok(!("2025-03" >= start), "previous March is below range");
    assert.ok(!("2026-04" <= end), "next April is above range");
  });
});

// ─── buildEpfContributionDto ──────────────────────────────────────────────────

const NOW = new Date("2025-07-31T12:00:00Z");

function makeRow(
  overrides: Partial<{
    id: string;
    userId: string;
    wageMonth: string;
    employerName: string | null;
    epfoMemberId: string;
    expectedEmployeePaise: number | null;
    expectedEmployerPaise: number | null;
    expectedEpsPaise: number | null;
    expectedVpfPaise: number;
    payslipId: string | null;
    actualEmployeePaise: number | null;
    actualEmployerPaise: number | null;
    actualEpsPaise: number | null;
    actualVpfPaise: number | null;
    reconciliationStatus: string;
    gapReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? "epf-uuid-1",
    userId: overrides.userId ?? "user-uuid-1",
    wageMonth: overrides.wageMonth ?? "2025-06",
    employerName: overrides.employerName !== undefined ? overrides.employerName : "ACME Corp",
    epfoMemberId: overrides.epfoMemberId ?? "MH/BAN/0012345/000/0001234",
    expectedEmployeePaise:
      overrides.expectedEmployeePaise !== undefined ? overrides.expectedEmployeePaise : 180000,
    expectedEmployerPaise:
      overrides.expectedEmployerPaise !== undefined ? overrides.expectedEmployerPaise : 55000,
    expectedEpsPaise: overrides.expectedEpsPaise !== undefined ? overrides.expectedEpsPaise : 125000,
    expectedVpfPaise: overrides.expectedVpfPaise ?? 0,
    payslipId: overrides.payslipId !== undefined ? overrides.payslipId : "payslip-uuid-1",
    actualEmployeePaise:
      overrides.actualEmployeePaise !== undefined ? overrides.actualEmployeePaise : null,
    actualEmployerPaise:
      overrides.actualEmployerPaise !== undefined ? overrides.actualEmployerPaise : null,
    actualEpsPaise: overrides.actualEpsPaise !== undefined ? overrides.actualEpsPaise : null,
    actualVpfPaise: overrides.actualVpfPaise !== undefined ? overrides.actualVpfPaise : null,
    reconciliationStatus: overrides.reconciliationStatus ?? "pending",
    gapReason: overrides.gapReason !== undefined ? overrides.gapReason : null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

type DtoRow = Parameters<typeof buildEpfContributionDto>[0];

describe("buildEpfContributionDto", () => {
  it("converts an unconfirmed payslip-derived row", () => {
    const dto = buildEpfContributionDto(makeRow() as DtoRow);

    assert.equal(dto.id, "epf-uuid-1");
    assert.equal(dto.wageMonth, "2025-06");
    assert.equal(dto.employerName, "ACME Corp");
    assert.equal(dto.epfoMemberId, "MH/BAN/0012345/000/0001234");
    assert.equal(dto.expectedEmployeePaise, 180000);
    assert.equal(dto.expectedEmployerPaise, 55000);
    assert.equal(dto.expectedEpsPaise, 125000);
    assert.equal(dto.expectedVpfPaise, 0);
    assert.equal(dto.payslipId, "payslip-uuid-1");
    assert.equal(dto.actualEmployeePaise, null);
    assert.equal(dto.reconciliationStatus, "pending");
    assert.equal(dto.gapReason, null);
    assert.equal(dto.createdAt, NOW.toISOString());
    assert.equal(dto.updatedAt, NOW.toISOString());
  });

  it("computes 80C eligibility from expected values when unconfirmed", () => {
    const dto = buildEpfContributionDto(makeRow({ expectedVpfPaise: 50000 }) as DtoRow);
    // employee 180000 + vpf 50000; employer/eps excluded.
    assert.equal(dto.eligible80cPaise, 230000);
  });

  it("excludes employer EPF and EPS from 80C eligibility", () => {
    const dto = buildEpfContributionDto(
      makeRow({ expectedEmployerPaise: 900000, expectedEpsPaise: 900000 }) as DtoRow,
    );
    assert.equal(dto.eligible80cPaise, 180000);
  });

  it("prefers actual over expected for 80C eligibility once confirmed", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        expectedEmployeePaise: 180000,
        expectedVpfPaise: 50000,
        actualEmployeePaise: 190000,
        actualVpfPaise: 60000,
        reconciliationStatus: "mismatch",
      }) as DtoRow,
    );
    assert.equal(dto.eligible80cPaise, 250000);
    assert.equal(dto.actualEmployeePaise, 190000);
    assert.equal(dto.actualVpfPaise, 60000);
    assert.equal(dto.reconciliationStatus, "mismatch");
  });

  it("mixes actual employee with expected vpf when only vpf is unconfirmed", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        expectedVpfPaise: 50000,
        actualEmployeePaise: 190000,
        actualVpfPaise: null,
      }) as DtoRow,
    );
    assert.equal(dto.eligible80cPaise, 240000);
  });

  it("treats a fully null expected/actual row as zero 80C eligibility", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        expectedEmployeePaise: null,
        expectedEmployerPaise: null,
        expectedEpsPaise: null,
        expectedVpfPaise: 0,
      }) as DtoRow,
    );
    assert.equal(dto.eligible80cPaise, 0);
    assert.equal(dto.expectedEmployeePaise, null);
    assert.equal(dto.expectedVpfPaise, 0);
  });

  it("carries a null payslipId for manual entries", () => {
    const dto = buildEpfContributionDto(makeRow({ payslipId: null }) as DtoRow);
    assert.equal(dto.payslipId, null);
  });

  it("carries a null employerName", () => {
    const dto = buildEpfContributionDto(makeRow({ employerName: null }) as DtoRow);
    assert.equal(dto.employerName, null);
  });

  it("carries gapReason through", () => {
    const dto = buildEpfContributionDto(
      makeRow({ gapReason: "employer defaulted on June remittance" }) as DtoRow,
    );
    assert.equal(dto.gapReason, "employer defaulted on June remittance");
  });

  it("carries the matched status through", () => {
    const updated = new Date("2025-08-05T06:00:00Z");
    const dto = buildEpfContributionDto(
      makeRow({
        actualEmployeePaise: 180000,
        actualEmployerPaise: 55000,
        actualEpsPaise: 125000,
        reconciliationStatus: "matched",
        updatedAt: updated,
      }) as DtoRow,
    );
    assert.equal(dto.reconciliationStatus, "matched");
    assert.equal(dto.updatedAt, updated.toISOString());
  });

  // grossEmployerContributionPaise tests (employer EPF/EPS invariant — P4)
  it("grossEmployerContributionPaise = expected employer + expected eps when no actuals", () => {
    // makeRow defaults: expectedEmployerPaise=55000, expectedEpsPaise=125000.
    const dto = buildEpfContributionDto(makeRow() as DtoRow);
    assert.equal(dto.grossEmployerContributionPaise, 55000 + 125000);
  });

  it("grossEmployerContributionPaise uses actual values when confirmed", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        actualEmployerPaise: 60000,
        actualEpsPaise: 130000,
      }) as DtoRow,
    );
    assert.equal(dto.grossEmployerContributionPaise, 60000 + 130000);
  });

  it("grossEmployerContributionPaise mixes actual employer + expected eps when only employer confirmed", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        actualEmployerPaise: 60000,
        actualEpsPaise: null,
      }) as DtoRow,
    );
    // actual employer 60000 + expected eps 125000
    assert.equal(dto.grossEmployerContributionPaise, 60000 + 125000);
  });

  it("grossEmployerContributionPaise is zero when all employer/eps values are null", () => {
    const dto = buildEpfContributionDto(
      makeRow({
        expectedEmployerPaise: null,
        expectedEpsPaise: null,
        actualEmployerPaise: null,
        actualEpsPaise: null,
      }) as DtoRow,
    );
    assert.equal(dto.grossEmployerContributionPaise, 0);
  });
});
