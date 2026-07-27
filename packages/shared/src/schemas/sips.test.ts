import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateSipSchema, RecordSipInstallmentSchema, defaultSipDate, sipDateRangeValid, unitsForInstallment } from "./sips.ts";
import { todayInIST } from "../date.ts";

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

test("unitsForInstallment: derives units from paise amount and NAV", () => {
  assert.equal(unitsForInstallment(500000, 91.1262), 54.869);
});

test("unitsForInstallment: rounds to 4 decimals", () => {
  // 1000 rupees / 33.333 NAV = 30.00030000300003... units, rounded to 30.0003
  assert.equal(unitsForInstallment(100000, 33.333), 30.0003);
});

test("unitsForInstallment: throws on a zero NAV", () => {
  assert.throws(() => unitsForInstallment(100000, 0), /nav must be positive/);
});

test("unitsForInstallment: throws on a negative NAV", () => {
  assert.throws(() => unitsForInstallment(100000, -1), /nav must be positive/);
});

test("RecordSipInstallmentSchema: rejects both units and nav missing", () => {
  const result = RecordSipInstallmentSchema.safeParse({});
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((i) => i.path.includes("units") && i.message === "provide either units or nav"));
  }
});

test("RecordSipInstallmentSchema: rejects both units and nav set", () => {
  const result = RecordSipInstallmentSchema.safeParse({ units: 10, nav: 91.1262 });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some((i) => i.path.includes("units") && i.message === "provide units or nav, not both"),
    );
  }
});

test("RecordSipInstallmentSchema: accepts units alone", () => {
  const result = RecordSipInstallmentSchema.safeParse({ units: 54.869 });
  assert.equal(result.success, true);
});

test("RecordSipInstallmentSchema: accepts nav alone", () => {
  const result = RecordSipInstallmentSchema.safeParse({ nav: 91.1262 });
  assert.equal(result.success, true);
});

test("RecordSipInstallmentSchema: rejects a zero or negative amountPaise", () => {
  assert.equal(RecordSipInstallmentSchema.safeParse({ nav: 91.1262, amountPaise: 0 }).success, false);
  assert.equal(RecordSipInstallmentSchema.safeParse({ nav: 91.1262, amountPaise: -100 }).success, false);
});

// 19:00 UTC on the 5th is 00:30 IST on the 6th — the window where the UTC day
// and the IST day differ. Pinning the helper at this fixed instant is what makes
// the IST-vs-UTC choice testable at any wall-clock hour; the two schema tests
// below can only compare against a live clock, so they'd pass either way for
// ~18.5 hours of the day.
const ACROSS_IST_MIDNIGHT = new Date("2026-01-05T19:00:00.000Z");

test("defaultSipDate: at 00:30 IST it returns the IST day, not the earlier UTC day", () => {
  assert.equal(defaultSipDate(ACROSS_IST_MIDNIGHT), "2026-01-06");
  assert.notEqual(defaultSipDate(ACROSS_IST_MIDNIGHT), ACROSS_IST_MIDNIGHT.toISOString().slice(0, 10));
});

test("defaultSipDate: defaults its clock to now and yields today in IST", () => {
  // One clock read, used on both sides: comparing two separate `new Date()`
  // reads would flake on the tick where IST midnight falls between them.
  const now = new Date();
  assert.equal(defaultSipDate(now), todayInIST(now));
});

test("RecordSipInstallmentSchema: an omitted date defaults to today in IST", () => {
  // The zod default reads its own clock, so there's nothing to inject — bracket
  // the parse instead and accept either day. Only on the one tick per day where
  // IST midnight lands mid-test do `before` and `after` differ.
  const before = todayInIST();
  const result = RecordSipInstallmentSchema.safeParse({ nav: 91.1262 });
  const after = todayInIST();
  assert.equal(result.success, true);
  if (result.success) assert.ok([before, after].includes(result.data.date));
});

test("CreateSipSchema: an omitted startDate defaults to today in IST", () => {
  const before = todayInIST();
  const result = CreateSipSchema.safeParse({ ...base, startDate: undefined });
  const after = todayInIST();
  assert.equal(result.success, true);
  if (result.success) assert.ok([before, after].includes(result.data.startDate));
});
