import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REPORT_RANGE_DAYS, ReportQuerySchema } from "./reports.ts";

test("period defaults to monthly when omitted", () => {
  const parsed = ReportQuerySchema.parse({ key: "2026-07" });
  assert.equal(parsed.period, "monthly");
});

test("valid monthly and annual queries are accepted", () => {
  assert.equal(ReportQuerySchema.safeParse({ period: "monthly", key: "2026-07" }).success, true);
  assert.equal(ReportQuerySchema.safeParse({ period: "annual", key: "2026" }).success, true);
});

test("custom period missing from is rejected", () => {
  const result = ReportQuerySchema.safeParse({ period: "custom", to: "2026-07-31" });
  assert.equal(result.success, false);
});

test("custom period missing to is rejected", () => {
  const result = ReportQuerySchema.safeParse({ period: "custom", from: "2026-07-01" });
  assert.equal(result.success, false);
});

test("custom period with from after to is rejected", () => {
  const result = ReportQuerySchema.safeParse({
    period: "custom",
    from: "2026-07-31",
    to: "2026-07-01",
  });
  assert.equal(result.success, false);
});

test("custom period with from === to (single-day range) is accepted", () => {
  const result = ReportQuerySchema.safeParse({
    period: "custom",
    from: "2026-07-15",
    to: "2026-07-15",
  });
  assert.equal(result.success, true);
});

test("custom period spanning more than MAX_REPORT_RANGE_DAYS is rejected", () => {
  // 2020-01-01 to 2030-01-08 is 3661 inclusive days — one more than the cap.
  const result = ReportQuerySchema.safeParse({
    period: "custom",
    from: "2020-01-01",
    to: "2030-01-08",
  });
  assert.equal(result.success, false);
});

test("custom period exactly at MAX_REPORT_RANGE_DAYS is accepted", () => {
  // 2020-01-01 to 2030-01-07 is exactly 3660 inclusive days.
  const result = ReportQuerySchema.safeParse({
    period: "custom",
    from: "2020-01-01",
    to: "2030-01-07",
  });
  assert.equal(result.success, true);
  assert.equal(MAX_REPORT_RANGE_DAYS, 3660);
});

test("monthly period with a bare-year key is rejected", () => {
  const result = ReportQuerySchema.safeParse({ period: "monthly", key: "2026" });
  assert.equal(result.success, false);
});

test("annual period with a month key is rejected", () => {
  const result = ReportQuerySchema.safeParse({ period: "annual", key: "2026-07" });
  assert.equal(result.success, false);
});

test("an out-of-range month key is rejected", () => {
  const result = ReportQuerySchema.safeParse({ period: "monthly", key: "2026-13" });
  assert.equal(result.success, false);
});
