/**
 * tax.test.ts — Shared-schema contract tests for income-event schemas (task 13.4).
 *
 * Covers:
 *   - IncomeEventSchema: shape, afterTdsPaise presence, section/sourcePriority presence
 *   - CreateIncomeEventBodySchema: PAN/TAN normalization, invalid position rejection,
 *     impossible-date rejection, no fy/sourceKind/sourceId/sourcePriority field,
 *     section field present, tdsPaise > grossPaise rejection
 *   - AcceptIncomeEventBodySchema: PAN/TAN normalization, invalid position rejection
 *   - IncomeEventSummarySchema: five-kinds-always-present shape
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  IncomeEventSchema,
  CreateIncomeEventBodySchema,
  AcceptIncomeEventBodySchema,
  IncomeEventSummarySchema,
} from "./tax.ts";

// ─── IncomeEventSchema ────────────────────────────────────────────────────────

describe("IncomeEventSchema", () => {
  /** A minimal valid IncomeEvent DTO object. */
  function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      fy: "2025-26",
      accrualDate: "2025-06-30",
      incomeKind: "salary",
      section: "192",
      sourceKind: "payslip",
      sourceId: "00000000-0000-4000-8000-000000000002",
      sourcePriority: 0,
      payerName: "ACME Corp",
      payerPan: null,
      payerTan: null,
      grossPaise: 5000000,
      tdsPaise: 300000,
      afterTdsPaise: 4700000,
      notes: null,
      status: "pending",
      acceptedAt: null,
      originalValues: null,
      createdAt: "2025-07-01T00:00:00.000Z",
      updatedAt: "2025-07-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("parses a valid income event DTO", () => {
    const result = IncomeEventSchema.safeParse(validEvent());
    assert.ok(result.success, JSON.stringify(result));
  });

  test("afterTdsPaise field is present on the schema", () => {
    const result = IncomeEventSchema.safeParse(validEvent());
    assert.ok(result.success);
    assert.equal("afterTdsPaise" in result.data, true);
    assert.equal(result.data.afterTdsPaise, 4700000);
  });

  test("section field is present on the schema and may be null", () => {
    const result = IncomeEventSchema.safeParse(validEvent({ section: null }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.section, null);
  });

  test("section field accepts a string value", () => {
    const result = IncomeEventSchema.safeParse(validEvent({ section: "194A" }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.section, "194A");
  });

  test("sourcePriority field is present on the schema and must be an integer", () => {
    const withPriority = IncomeEventSchema.safeParse(validEvent({ sourcePriority: 1 }));
    assert.ok(withPriority.success);
    assert.equal(withPriority.data.sourcePriority, 1);

    const notInt = IncomeEventSchema.safeParse(validEvent({ sourcePriority: 1.5 }));
    assert.ok(!notInt.success, "non-integer sourcePriority should fail");
  });

  test("rejects an event with a missing afterTdsPaise", () => {
    const bad = validEvent();
    delete bad["afterTdsPaise"];
    const result = IncomeEventSchema.safeParse(bad);
    assert.ok(!result.success, "missing afterTdsPaise should fail");
  });
});

// ─── CreateIncomeEventBodySchema ──────────────────────────────────────────────

describe("CreateIncomeEventBodySchema", () => {
  /** A minimal valid create body. */
  function validCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      accrualDate: "2025-06-30",
      incomeKind: "interest",
      grossPaise: 100000,
      tdsPaise: 10000,
      ...overrides,
    };
  }

  test("parses a valid minimal create body", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody());
    assert.ok(result.success, JSON.stringify(result));
  });

  test("rejects an impossible calendar date (2025-02-30)", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ accrualDate: "2025-02-30" }),
    );
    assert.ok(!result.success, "impossible date 2025-02-30 should fail validation");
  });

  test("rejects 2023-02-29 (non-leap year)", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ accrualDate: "2023-02-29" }),
    );
    assert.ok(!result.success, "2023-02-29 should fail on a non-leap year");
  });

  test("accepts 2024-02-29 (leap year)", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ accrualDate: "2024-02-29" }),
    );
    assert.ok(result.success, "2024-02-29 should be valid on a leap year");
  });

  // PAN normalization
  test("trims and uppercases a valid PAN", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ payerPan: "  abcde1234f  " }),
    );
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerPan, "ABCDE1234F");
  });

  test("rejects a PAN with letters/digits in wrong positions (digit where letter expected at pos 1)", () => {
    // ^[A-Z]{5}[0-9]{4}[A-Z]$ — position 1 must be A-Z, not a digit.
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ payerPan: "1BCDE1234F" }),
    );
    assert.ok(!result.success, "PAN with digit at position 1 should fail");
  });

  test("rejects a PAN that is too short", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ payerPan: "ABCDE123" }));
    assert.ok(!result.success, "short PAN should fail");
  });

  test("accepts a null PAN (optional nullable)", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ payerPan: null }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerPan, null);
  });

  // TAN normalization
  test("trims and uppercases a valid TAN", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ payerTan: "  abcd01234e  " }),
    );
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerTan, "ABCD01234E");
  });

  test("rejects a TAN with letters/digits in wrong positions (letter where digit expected at pos 5)", () => {
    // ^[A-Z]{4}[0-9]{5}[A-Z]$ — positions 5-9 must be 0-9.
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ payerTan: "ABCDA1234E" }),
    );
    assert.ok(!result.success, "TAN with letter at position 5 should fail");
  });

  test("accepts a null TAN (optional nullable)", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ payerTan: null }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerTan, null);
  });

  // Schema exclusions (server-controlled fields must not be accepted from client)
  test("CreateIncomeEventBodySchema has no 'fy' field — fy is always server-computed", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ fy: "2025-26" }));
    // Zod strips unknown fields by default — presence of fy in input is silently dropped.
    // The key assertion is that the output does NOT contain fy.
    assert.ok(result.success, JSON.stringify(result));
    assert.ok(!("fy" in result.data), "'fy' must not appear in parsed body");
  });

  test("CreateIncomeEventBodySchema has no 'sourceKind' field — forced to 'manual' by service", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ sourceKind: "payslip" }),
    );
    assert.ok(result.success, JSON.stringify(result));
    assert.ok(!("sourceKind" in result.data), "'sourceKind' must not appear in parsed body");
  });

  test("CreateIncomeEventBodySchema has no 'sourceId' field", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ sourceId: "00000000-0000-4000-8000-000000000002" }),
    );
    assert.ok(result.success, JSON.stringify(result));
    assert.ok(!("sourceId" in result.data), "'sourceId' must not appear in parsed body");
  });

  test("CreateIncomeEventBodySchema has no 'sourcePriority' field — server-controlled", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ sourcePriority: 99 }));
    assert.ok(result.success, JSON.stringify(result));
    assert.ok(
      !("sourcePriority" in result.data),
      "'sourcePriority' must not appear in parsed body",
    );
  });

  test("CreateIncomeEventBodySchema accepts a 'section' field (e.g. '194A')", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ section: "194A" }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.section, "194A");
  });

  test("CreateIncomeEventBodySchema accepts section as null", () => {
    const result = CreateIncomeEventBodySchema.safeParse(validCreateBody({ section: null }));
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.section, null);
  });

  test("rejects tdsPaise > grossPaise", () => {
    const result = CreateIncomeEventBodySchema.safeParse(
      validCreateBody({ grossPaise: 1000, tdsPaise: 2000 }),
    );
    assert.ok(!result.success, "tdsPaise > grossPaise should fail");
  });
});

// ─── AcceptIncomeEventBodySchema ──────────────────────────────────────────────

describe("AcceptIncomeEventBodySchema", () => {
  test("parses an empty accept body (no corrections)", () => {
    const result = AcceptIncomeEventBodySchema.safeParse({});
    assert.ok(result.success, JSON.stringify(result));
  });

  test("trims and uppercases a valid PAN on accept", () => {
    const result = AcceptIncomeEventBodySchema.safeParse({ payerPan: "  abcde1234f  " });
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerPan, "ABCDE1234F");
  });

  test("rejects a PAN with digits/letters transposed (digit at position 6, letter expected)", () => {
    // ^[A-Z]{5}[0-9]{4}[A-Z]$ — positions 6-9 must be digits.
    // "ABCDEF234F" has a letter at position 6 where a digit is required.
    const result = AcceptIncomeEventBodySchema.safeParse({ payerPan: "ABCDEF234F" });
    assert.ok(!result.success, "PAN with letter at position 6 should fail");
  });

  test("trims and uppercases a valid TAN on accept", () => {
    const result = AcceptIncomeEventBodySchema.safeParse({ payerTan: "  abcd01234e  " });
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerTan, "ABCD01234E");
  });

  test("rejects a TAN with a digit/letter transposed (letter at position 5)", () => {
    // ^[A-Z]{4}[0-9]{5}[A-Z]$ — position 5 must be a digit.
    const result = AcceptIncomeEventBodySchema.safeParse({ payerTan: "ABCDE1234F" });
    assert.ok(!result.success, "TAN with letter at position 5 should fail");
  });

  test("accepts null payerPan and null payerTan", () => {
    const result = AcceptIncomeEventBodySchema.safeParse({ payerPan: null, payerTan: null });
    assert.ok(result.success, JSON.stringify(result));
    assert.equal(result.data.payerPan, null);
    assert.equal(result.data.payerTan, null);
  });
});

// ─── IncomeEventSummarySchema ─────────────────────────────────────────────────

describe("IncomeEventSummarySchema", () => {
  /** A minimal valid summary with all five kinds. */
  function zeroKind() {
    return { grossPaise: 0, tdsPaise: 0, count: 0 };
  }

  function validSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      fy: "2025-26",
      totalGrossPaise: 0,
      totalTdsPaise: 0,
      isEstimate: true,
      acceptedCount: 0,
      pendingCount: 0,
      notes: ["Salary amounts are GROSS"],
      byKind: {
        salary: zeroKind(),
        interest: zeroKind(),
        dividend: zeroKind(),
        rent: zeroKind(),
        other: zeroKind(),
      },
      ...overrides,
    };
  }

  test("parses a valid summary with all five income kinds", () => {
    const result = IncomeEventSummarySchema.safeParse(validSummary());
    assert.ok(result.success, JSON.stringify(result));
  });

  test("all five income kinds are present in byKind", () => {
    const result = IncomeEventSummarySchema.safeParse(validSummary());
    assert.ok(result.success);
    const kinds = Object.keys(result.data.byKind);
    assert.deepEqual(kinds.sort(), ["dividend", "interest", "other", "rent", "salary"]);
  });

  test("rejects a summary missing one income kind (e.g. dividend omitted)", () => {
    const bad = validSummary();
    const byKind = bad["byKind"] as Record<string, unknown>;
    delete byKind["dividend"];
    const result = IncomeEventSummarySchema.safeParse(bad);
    assert.ok(!result.success, "missing dividend in byKind should fail");
  });

  test("acceptedCount and pendingCount are required integer fields", () => {
    const noAccepted = validSummary();
    delete (noAccepted as Record<string, unknown>)["acceptedCount"];
    const r1 = IncomeEventSummarySchema.safeParse(noAccepted);
    assert.ok(!r1.success, "missing acceptedCount should fail");

    const noPending = validSummary();
    delete (noPending as Record<string, unknown>)["pendingCount"];
    const r2 = IncomeEventSummarySchema.safeParse(noPending);
    assert.ok(!r2.success, "missing pendingCount should fail");
  });

  test("notes is a required array-of-strings field", () => {
    const noNotes = validSummary();
    delete (noNotes as Record<string, unknown>)["notes"];
    const result = IncomeEventSummarySchema.safeParse(noNotes);
    assert.ok(!result.success, "missing notes should fail");
  });
});

// ─── CreateDeductionEntrySchema ───────────────────────────────────────────────

import {
  CreateDeductionEntrySchema,
  UpdateDeductionEntrySchema,
  DeductionEntrySchema,
  DeductionBasketSchema,
} from "./tax.ts";

describe("CreateDeductionEntrySchema", () => {
  test("accepts a valid 80C entry", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80C",
      deductionKind: "other_80c",
      amountPaise: 1_000_000,
    });
    assert.ok(r.success, `should accept valid 80C: ${JSON.stringify(r.error)}`);
  });

  test("rejects mismatched section/kind (80C + nps_additional)", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80C",
      deductionKind: "nps_additional",
      amountPaise: 1_000_000,
    });
    assert.ok(!r.success, "should reject 80C + nps_additional");
    assert.ok(
      r.error.issues.some((i) => i.path.includes("deductionKind")),
      "error should reference deductionKind",
    );
  });

  test("accepts valid 80CCD1B entry", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80CCD1B",
      deductionKind: "nps_additional",
      amountPaise: 2_000_000,
    });
    assert.ok(r.success, `should accept valid 80CCD1B: ${JSON.stringify(r.error)}`);
  });

  test("accepts valid 80CCD2 entry with required fields", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80CCD2",
      deductionKind: "employer_nps_ccd2",
      amountPaise: 5_000_000,
      employerType: "private",
      salaryBasePaise: 50_000_000,
    });
    assert.ok(r.success, `should accept valid 80CCD2: ${JSON.stringify(r.error)}`);
  });

  test("rejects 80CCD2 without employerType", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80CCD2",
      deductionKind: "employer_nps_ccd2",
      amountPaise: 5_000_000,
      salaryBasePaise: 50_000_000,
    });
    assert.ok(!r.success, "should reject 80CCD2 without employerType");
    assert.ok(
      r.error.issues.some((i) => i.path.includes("employerType")),
      "error should reference employerType",
    );
  });

  test("rejects 80CCD2 without salaryBasePaise", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80CCD2",
      deductionKind: "employer_nps_ccd2",
      amountPaise: 5_000_000,
      employerType: "government",
    });
    assert.ok(!r.success, "should reject 80CCD2 without salaryBasePaise");
    assert.ok(
      r.error.issues.some((i) => i.path.includes("salaryBasePaise")),
      "error should reference salaryBasePaise",
    );
  });

  test("accepts valid 80D preventive_checkup entry with eightyDGroup", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80D",
      deductionKind: "preventive_checkup",
      amountPaise: 300_000,
      eightyDGroup: "self_family",
    });
    assert.ok(r.success, `should accept valid 80D preventive: ${JSON.stringify(r.error)}`);
  });

  test("rejects 80D entry without eightyDGroup", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80D",
      deductionKind: "other_80d",
      amountPaise: 300_000,
    });
    assert.ok(!r.success, "should reject 80D without eightyDGroup");
    assert.ok(
      r.error.issues.some((i) => i.path.includes("eightyDGroup")),
      "error should reference eightyDGroup",
    );
  });

  test("rejects negative amountPaise", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80C",
      deductionKind: "other_80c",
      amountPaise: -1000,
    });
    assert.ok(!r.success, "should reject negative amount");
  });

  test("rejects unknown section", () => {
    const r = CreateDeductionEntrySchema.safeParse({
      fy: "2025-26",
      section: "80E",
      deductionKind: "other_80c",
      amountPaise: 1_000_000,
    });
    assert.ok(!r.success, "should reject unknown section");
  });
});

// ─── UpdateDeductionEntrySchema ───────────────────────────────────────────────

describe("UpdateDeductionEntrySchema", () => {
  test("accepts empty update object", () => {
    const r = UpdateDeductionEntrySchema.safeParse({});
    assert.ok(r.success, "empty update should be valid");
  });

  test("accepts partial updates", () => {
    const r = UpdateDeductionEntrySchema.safeParse({
      amountPaise: 2_000_000,
      description: "Updated description",
    });
    assert.ok(r.success, `partial update should be valid: ${JSON.stringify(r.error)}`);
  });

  test("rejects negative amountPaise", () => {
    const r = UpdateDeductionEntrySchema.safeParse({ amountPaise: -500 });
    assert.ok(!r.success, "should reject negative amount on update");
  });
});

// ─── DeductionEntrySchema ─────────────────────────────────────────────────────

describe("DeductionEntrySchema", () => {
  function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      fy: "2025-26",
      section: "80C",
      deductionKind: "other_80c",
      amountPaise: 1_000_000,
      description: "",
      employerType: null,
      salaryBasePaise: null,
      eightyDGroup: null,
      createdAt: "2025-07-01T00:00:00.000Z",
      updatedAt: "2025-07-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("accepts a valid entry", () => {
    const r = DeductionEntrySchema.safeParse(validEntry());
    assert.ok(r.success, `valid entry should parse: ${JSON.stringify(r.error)}`);
  });

  test("requires id (UUID)", () => {
    const entry = validEntry();
    delete (entry as Record<string, unknown>)["id"];
    assert.ok(!DeductionEntrySchema.safeParse(entry).success, "missing id should fail");
  });

  test("requires fy", () => {
    const entry = validEntry({ fy: "20-21" });
    assert.ok(!DeductionEntrySchema.safeParse(entry).success, "malformed fy should fail");
  });

  test("employer fields are present for 80CCD2 variant", () => {
    const entry = validEntry({
      section: "80CCD2",
      deductionKind: "employer_nps_ccd2",
      employerType: "private",
      salaryBasePaise: 100_000_000,
    });
    const r = DeductionEntrySchema.safeParse(entry);
    assert.ok(r.success, `80CCD2 entry should parse: ${JSON.stringify(r.error)}`);
    if (r.success) {
      assert.equal(r.data.employerType, "private");
      assert.equal(r.data.salaryBasePaise, 100_000_000);
    }
  });
});

// ─── DeductionBasketSchema (shape contract) ───────────────────────────────────

describe("DeductionBasketSchema", () => {
  function validBasket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      fy: "2025-26",
      regime: "old",
      eightyC: {
        sources: [],
        npsRemainderPaise: 0,
        contributedPaise: 0,
        capPaise: 15_000_000,
        eligiblePaise: 0,
        headroomPaise: 15_000_000,
        assumptions: [],
      },
      eightyCcd1b: {
        contributedPaise: 0,
        capPaise: 5_000_000,
        eligiblePaise: 0,
        headroomPaise: 5_000_000,
      },
      eightyCcd2: {
        entries: [],
        contributedPaise: 0,
        eligiblePaise: 0,
      },
      eightyD: {
        selfFamily: {
          contributedPaise: 0,
          seniorApplies: false,
          capPaise: 2_500_000,
          eligiblePaise: 0,
          preventiveCheckupPaise: 0,
          headroomPaise: 2_500_000,
        },
        parents: {
          contributedPaise: 0,
          seniorApplies: false,
          capPaise: 2_500_000,
          eligiblePaise: 0,
          preventiveCheckupPaise: 0,
          headroomPaise: 2_500_000,
        },
        unallocatedPolicies: [],
      },
      emiInterestEstimatePaise: 0,
      generatedAt: "2025-07-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("accepts a valid basket (old regime)", () => {
    const r = DeductionBasketSchema.safeParse(validBasket());
    assert.ok(r.success, `valid basket should parse: ${JSON.stringify(r.error)}`);
  });

  test("accepts new regime with null headrooms", () => {
    const r = DeductionBasketSchema.safeParse(
      validBasket({
        regime: "new",
        eightyC: {
          sources: [],
          npsRemainderPaise: 0,
          contributedPaise: 0,
          capPaise: 15_000_000,
          eligiblePaise: 0,
          headroomPaise: null,
          assumptions: [],
        },
        eightyCcd1b: {
          contributedPaise: 0,
          capPaise: 5_000_000,
          eligiblePaise: 0,
          headroomPaise: null,
        },
        eightyD: {
          selfFamily: {
            contributedPaise: 0,
            seniorApplies: false,
            capPaise: 2_500_000,
            eligiblePaise: 0,
            preventiveCheckupPaise: 0,
            headroomPaise: null,
          },
          parents: {
            contributedPaise: 0,
            seniorApplies: false,
            capPaise: 2_500_000,
            eligiblePaise: 0,
            preventiveCheckupPaise: 0,
            headroomPaise: null,
          },
          unallocatedPolicies: [],
        },
      }),
    );
    assert.ok(r.success, `new regime basket should parse: ${JSON.stringify(r.error)}`);
  });

  test("rejects basket without fy", () => {
    const basket = validBasket();
    delete (basket as Record<string, unknown>)["fy"];
    assert.ok(!DeductionBasketSchema.safeParse(basket).success, "missing fy should fail");
  });

  test("rejects basket without eightyCcd2.entries", () => {
    const basket = validBasket({
      eightyCcd2: { contributedPaise: 0, eligiblePaise: 0 },
    });
    assert.ok(!DeductionBasketSchema.safeParse(basket).success, "missing entries should fail");
  });

  test("rejects unallocated policy with unknown reason", () => {
    const basket = validBasket({
      eightyD: {
        ...(validBasket().eightyD as object),
        unallocatedPolicies: [
          { policyId: "abc", name: "Test", reason: "wrong_reason" },
        ],
      },
    });
    assert.ok(!DeductionBasketSchema.safeParse(basket).success, "unknown reason should fail");
  });
});
