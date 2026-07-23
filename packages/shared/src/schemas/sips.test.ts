import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateSipSchema, sipDateRangeValid } from "./sips.ts";

const base = {
  goalId: "11111111-1111-4111-8111-111111111111",
  sourceAccountId: "22222222-2222-4222-8222-222222222222",
  targetKind: "mf_folio" as const,
  targetHoldingId: "33333333-3333-4333-8333-333333333333",
  targetAccountId: null,
  amountPaise: 5_000_00,
  dayOfMonth: 5,
};

test("sipDateRangeValid: a null endDate (open-ended) is always valid", () => {
  assert.equal(sipDateRangeValid("2026-01-01", null), true);
});

test("sipDateRangeValid: endDate on or after startDate is valid", () => {
  assert.equal(sipDateRangeValid("2026-01-01", "2026-01-01"), true);
  assert.equal(sipDateRangeValid("2026-01-01", "2026-06-30"), true);
});

test("sipDateRangeValid: endDate before startDate is invalid", () => {
  assert.equal(sipDateRangeValid("2026-06-30", "2026-01-01"), false);
});

test("CreateSipSchema: accepts a valid startDate/endDate pair", () => {
  const result = CreateSipSchema.safeParse({ ...base, startDate: "2026-01-01", endDate: "2026-12-31" });
  assert.equal(result.success, true);
});

test("CreateSipSchema: accepts a null (open-ended) endDate", () => {
  const result = CreateSipSchema.safeParse({ ...base, startDate: "2026-01-01", endDate: null });
  assert.equal(result.success, true);
});

test("CreateSipSchema: rejects endDate before startDate", () => {
  const result = CreateSipSchema.safeParse({ ...base, startDate: "2026-06-30", endDate: "2026-01-01" });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((i) => i.path.includes("endDate")));
  }
});
