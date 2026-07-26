import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReportQuery } from "@compass/shared";
import { MAX_REPORT_RANGE_DAYS } from "@compass/shared";
import { resolveReportRange } from "./reports.ts";

/** ISO date shifted by `days` (may be negative), via UTC epoch arithmetic. */
function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test("resolveReportRange resolves monthly bounds", () => {
  const q: ReportQuery = { period: "monthly", key: "2026-02" };
  assert.deepEqual(resolveReportRange(q), {
    from: "2026-02-01",
    to: "2026-02-28",
    periodKey: "2026-02",
  });
});

test("resolveReportRange resolves leap-February bounds", () => {
  const q: ReportQuery = { period: "monthly", key: "2028-02" };
  assert.deepEqual(resolveReportRange(q), {
    from: "2028-02-01",
    to: "2028-02-29",
    periodKey: "2028-02",
  });
});

test("resolveReportRange resolves annual bounds", () => {
  const q: ReportQuery = { period: "annual", key: "2026" };
  assert.deepEqual(resolveReportRange(q), {
    from: "2026-01-01",
    to: "2026-12-31",
    periodKey: "2026",
  });
});

test("resolveReportRange passes a custom range through and joins the periodKey", () => {
  const q: ReportQuery = { period: "custom", from: "2026-03-05", to: "2026-04-10" };
  assert.deepEqual(resolveReportRange(q), {
    from: "2026-03-05",
    to: "2026-04-10",
    periodKey: "2026-03-05..2026-04-10",
  });
});

test("resolveReportRange throws when a custom range lacks from/to", () => {
  assert.throws(() => resolveReportRange({ period: "custom", to: "2026-04-10" } as ReportQuery));
  assert.throws(() => resolveReportRange({ period: "custom", from: "2026-04-10" } as ReportQuery));
});

test("resolveReportRange throws when monthly/annual lacks a key", () => {
  assert.throws(() => resolveReportRange({ period: "monthly" } as ReportQuery));
});

test("resolveReportRange throws for a custom range with an impossible calendar date", () => {
  const q: ReportQuery = { period: "custom", from: "2026-02-30", to: "2026-03-01" };
  assert.throws(() => resolveReportRange(q));
});

test("resolveReportRange throws for a custom range exceeding MAX_REPORT_RANGE_DAYS", () => {
  const from = "2020-01-01";
  const to = shiftIsoDate(from, MAX_REPORT_RANGE_DAYS);
  const q: ReportQuery = { period: "custom", from, to };
  assert.throws(() => resolveReportRange(q));
});

test("resolveReportRange does not throw at exactly MAX_REPORT_RANGE_DAYS", () => {
  const from = "2020-01-01";
  const to = shiftIsoDate(from, MAX_REPORT_RANGE_DAYS - 1);
  const q: ReportQuery = { period: "custom", from, to };
  assert.doesNotThrow(() => resolveReportRange(q));
});

test("resolveReportRange throws for a malformed monthly key", () => {
  const q: ReportQuery = { period: "monthly", key: "2026-13" };
  assert.throws(() => resolveReportRange(q));
});
