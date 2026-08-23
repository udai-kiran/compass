/**
 * payslip-review.test.ts — Unit tests for payslip review pure helpers.
 *
 * Tests the hermetically-testable pure functions:
 *   - buildPayslipDto: DB row → DTO conversion
 *   - buildComponentDto: component row → DTO conversion
 *   - computeFyTdsPaise: FY TDS aggregate (D4)
 *
 * State machine transition correctness (D3) is exercised by the service
 * integration tests that run against a real DB in CI.
 *
 * No DB, no network — all tests are synchronous and fast.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPayslipDto, buildComponentDto, computeFyTdsPaise } from "./payslip-review.ts";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-30T12:00:00Z");

function makePayslipRow(overrides: Partial<{
  id: string;
  userId: string;
  fy: string;
  payMonth: string;
  employerName: string | null;
  documentKey: string | null;
  status: string;
  grossPaise: number | null;
  netPaise: number | null;
  tdsCurrentPaise: number | null;
  tdsYtdPaise: number | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "payslip-uuid-1",
    userId: overrides.userId ?? "user-uuid-1",
    fy: overrides.fy ?? "2025-26",
    payMonth: overrides.payMonth ?? "2025-06",
    employerName: overrides.employerName !== undefined ? overrides.employerName : "ACME Corp",
    documentKey: overrides.documentKey !== undefined ? overrides.documentKey : null,
    status: overrides.status ?? "pending",
    grossPaise: overrides.grossPaise !== undefined ? overrides.grossPaise : 5000000,
    netPaise: overrides.netPaise !== undefined ? overrides.netPaise : 4200000,
    tdsCurrentPaise: overrides.tdsCurrentPaise !== undefined ? overrides.tdsCurrentPaise : 300000,
    tdsYtdPaise: overrides.tdsYtdPaise !== undefined ? overrides.tdsYtdPaise : 1500000,
    acceptedAt: overrides.acceptedAt !== undefined ? overrides.acceptedAt : null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

function makeComponentRow(overrides: Partial<{
  id: string;
  payslipId: string;
  rawLabel: string;
  canonicalKind: string;
  category: string;
  currentPaise: number;
  ytdPaise: number | null;
  sourceQuote: string | null;
  confidence: number | null;
  displayOrder: number;
  createdAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "comp-uuid-1",
    payslipId: overrides.payslipId ?? "payslip-uuid-1",
    rawLabel: overrides.rawLabel ?? "Basic Salary",
    canonicalKind: overrides.canonicalKind ?? "basic",
    category: overrides.category ?? "earning",
    currentPaise: overrides.currentPaise ?? 2500000,
    ytdPaise: overrides.ytdPaise !== undefined ? overrides.ytdPaise : 12500000,
    sourceQuote: overrides.sourceQuote !== undefined ? overrides.sourceQuote : "Basic Salary: ₹25,000",
    confidence: overrides.confidence !== undefined ? overrides.confidence : 0.99,
    displayOrder: overrides.displayOrder ?? 0,
    createdAt: overrides.createdAt ?? NOW,
  };
}

// ─── buildComponentDto ────────────────────────────────────────────────────────

describe("buildComponentDto", () => {
  it("converts DB row to component DTO", () => {
    const row = makeComponentRow();
    const dto = buildComponentDto(row);

    assert.equal(dto.id, "comp-uuid-1");
    assert.equal(dto.payslipId, "payslip-uuid-1");
    assert.equal(dto.rawLabel, "Basic Salary");
    assert.equal(dto.canonicalKind, "basic");
    assert.equal(dto.category, "earning");
    assert.equal(dto.currentPaise, 2500000);
    assert.equal(dto.ytdPaise, 12500000);
    assert.equal(dto.sourceQuote, "Basic Salary: ₹25,000");
    assert.equal(dto.confidence, 0.99);
    assert.equal(dto.displayOrder, 0);
    assert.equal(dto.createdAt, NOW.toISOString());
  });

  it("handles null optional fields", () => {
    const row = makeComponentRow({ ytdPaise: null, sourceQuote: null, confidence: null });
    const dto = buildComponentDto(row);

    assert.equal(dto.ytdPaise, null);
    assert.equal(dto.sourceQuote, null);
    assert.equal(dto.confidence, null);
  });
});

// ─── buildPayslipDto ──────────────────────────────────────────────────────────

describe("buildPayslipDto", () => {
  it("converts DB row to payslip DTO with components", () => {
    const row = makePayslipRow({ status: "accepted", acceptedAt: NOW });
    const components = [
      makeComponentRow({ displayOrder: 1 }),
      makeComponentRow({ id: "comp-uuid-2", rawLabel: "HRA", canonicalKind: "hra", displayOrder: 0 }),
    ];
    const dto = buildPayslipDto(row, components);

    assert.equal(dto.id, "payslip-uuid-1");
    assert.equal(dto.fy, "2025-26");
    assert.equal(dto.payMonth, "2025-06");
    assert.equal(dto.employerName, "ACME Corp");
    assert.equal(dto.documentKey, null);
    assert.equal(dto.status, "accepted");
    assert.equal(dto.grossPaise, 5000000);
    assert.equal(dto.netPaise, 4200000);
    assert.equal(dto.tdsCurrentPaise, 300000);
    assert.equal(dto.tdsYtdPaise, 1500000);
    assert.equal(dto.acceptedAt, NOW.toISOString());
    assert.equal(dto.createdAt, NOW.toISOString());
    assert.equal(dto.updatedAt, NOW.toISOString());
    assert.equal(dto.components.length, 2);
    // Components should be sorted by displayOrder
    assert.equal(dto.components[0]!.canonicalKind, "hra"); // displayOrder=0
    assert.equal(dto.components[1]!.canonicalKind, "basic"); // displayOrder=1
  });

  it("handles null optional header fields", () => {
    const row = makePayslipRow({
      employerName: null,
      documentKey: null,
      grossPaise: null,
      netPaise: null,
      tdsCurrentPaise: null,
      tdsYtdPaise: null,
      acceptedAt: null,
    });
    const dto = buildPayslipDto(row, []);

    assert.equal(dto.employerName, null);
    assert.equal(dto.documentKey, null);
    assert.equal(dto.grossPaise, null);
    assert.equal(dto.netPaise, null);
    assert.equal(dto.tdsCurrentPaise, null);
    assert.equal(dto.tdsYtdPaise, null);
    assert.equal(dto.acceptedAt, null);
    assert.deepEqual(dto.components, []);
  });

  it("sets status correctly for pending payslip", () => {
    const row = makePayslipRow({ status: "pending" });
    const dto = buildPayslipDto(row, []);
    assert.equal(dto.status, "pending");
  });

  it("sets status correctly for rejected payslip", () => {
    const row = makePayslipRow({ status: "rejected" });
    const dto = buildPayslipDto(row, []);
    assert.equal(dto.status, "rejected");
  });
});

// ─── computeFyTdsPaise (D4) ───────────────────────────────────────────────────

describe("computeFyTdsPaise", () => {
  it("sums tds_current_paise for accepted payslips only", () => {
    const rows = [
      makePayslipRow({ status: "accepted", tdsCurrentPaise: 300000 }),
      makePayslipRow({ status: "accepted", tdsCurrentPaise: 250000 }),
      makePayslipRow({ status: "pending", tdsCurrentPaise: 200000 }), // excluded
      makePayslipRow({ status: "rejected", tdsCurrentPaise: 100000 }), // excluded
    ];

    const total = computeFyTdsPaise(rows);
    assert.equal(total, 550000, "Only accepted payslips should contribute to FY TDS");
  });

  it("NEVER sums tds_ytd_paise (D4 invariant)", () => {
    const rows = [
      makePayslipRow({
        status: "accepted",
        tdsCurrentPaise: 300000,
        tdsYtdPaise: 1500000, // YTD must never be summed
      }),
      makePayslipRow({
        status: "accepted",
        tdsCurrentPaise: 300000,
        tdsYtdPaise: 1800000, // YTD must never be summed
      }),
    ];

    const total = computeFyTdsPaise(rows);
    // Correct: 300000 + 300000 = 600000
    // Wrong (if YTD were summed): 1500000 + 1800000 = 3300000
    assert.equal(total, 600000);
    assert.notEqual(total, 3300000, "tds_ytd_paise must not be summed");
  });

  it("returns 0 for empty list", () => {
    assert.equal(computeFyTdsPaise([]), 0);
  });

  it("returns 0 when all payslips are pending", () => {
    const rows = [
      makePayslipRow({ status: "pending", tdsCurrentPaise: 300000 }),
      makePayslipRow({ status: "pending", tdsCurrentPaise: 250000 }),
    ];
    assert.equal(computeFyTdsPaise(rows), 0);
  });

  it("excludes accepted payslips with null tds_current_paise", () => {
    const rows = [
      makePayslipRow({ status: "accepted", tdsCurrentPaise: 300000 }),
      makePayslipRow({ status: "accepted", tdsCurrentPaise: null }), // no TDS this month
    ];
    assert.equal(computeFyTdsPaise(rows), 300000);
  });

  it("handles multiple employers in the same FY (D4 multi-employer)", () => {
    // Separate payslip records per employer — each contributes its monthly TDS
    const rows = [
      makePayslipRow({ status: "accepted", tdsCurrentPaise: 200000, employerName: "ACME Corp" }),
      makePayslipRow({ status: "accepted", tdsCurrentPaise: 150000, employerName: "Widgets Ltd" }),
    ];
    // Total FY TDS from both employers
    assert.equal(computeFyTdsPaise(rows), 350000);
  });
});
