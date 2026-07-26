import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REPORT_RANGE_DAYS } from "@compass/shared";
import {
  isSelectionValid,
  previousSelection,
  reportQueryString,
  selectionError,
  type ReportSelection,
} from "./report-query.ts";

test("isSelectionValid accepts valid monthly, annual, and custom selections", () => {
  assert.equal(isSelectionValid({ period: "monthly", key: "2026-07" }), true);
  assert.equal(isSelectionValid({ period: "annual", key: "2026" }), true);
  assert.equal(isSelectionValid({ period: "custom", from: "2026-07-01", to: "2026-07-31" }), true);
  assert.equal(isSelectionValid({ period: "custom", from: "2026-07-15", to: "2026-07-15" }), true);
});

test("isSelectionValid rejects malformed keys and inverted ranges", () => {
  assert.equal(isSelectionValid({ period: "monthly", key: "2026" }), false);
  assert.equal(isSelectionValid({ period: "annual", key: "2026-07" }), false);
  assert.equal(
    isSelectionValid({ period: "custom", from: "2026-07-31", to: "2026-07-01" }),
    false,
  );
  assert.equal(isSelectionValid({ period: "custom", from: "not-a-date", to: "2026-07-01" }), false);
});

test("reportQueryString builds the exact literal query string", () => {
  assert.equal(reportQueryString({ period: "monthly", key: "2026-07" }), "period=monthly&key=2026-07");
  assert.equal(reportQueryString({ period: "annual", key: "2026" }), "period=annual&key=2026");
  assert.equal(
    reportQueryString({ period: "custom", from: "2026-07-01", to: "2026-07-31" }),
    "period=custom&from=2026-07-01&to=2026-07-31",
  );
});

test("previousSelection rolls over months and years", () => {
  assert.deepEqual(previousSelection({ period: "monthly", key: "2026-01" }), {
    period: "monthly",
    key: "2025-12",
  });
  assert.deepEqual(previousSelection({ period: "annual", key: "2026" }), {
    period: "annual",
    key: "2025",
  });
});

test("previousSelection returns an equal-length window preceding a custom range", () => {
  assert.deepEqual(
    previousSelection({ period: "custom", from: "2026-03-01", to: "2026-03-31" }),
    { period: "custom", from: "2026-01-29", to: "2026-02-28" },
  );
});

test("previousSelection for a single-day custom range returns the previous single day", () => {
  assert.deepEqual(previousSelection({ period: "custom", from: "2026-07-15", to: "2026-07-15" }), {
    period: "custom",
    from: "2026-07-14",
    to: "2026-07-14",
  });
});

test("previousSelection returns null for an invalid selection", () => {
  const invalid: ReportSelection = { period: "monthly", key: "2026" };
  assert.equal(previousSelection(invalid), null);
});

test("previousSelection handles a custom range crossing a leap-year February", () => {
  assert.deepEqual(
    previousSelection({ period: "custom", from: "2028-03-01", to: "2028-03-31" }),
    { period: "custom", from: "2028-01-30", to: "2028-02-29" },
  );
});

test("previousSelection handles a custom range that rolls over a year boundary", () => {
  assert.deepEqual(
    previousSelection({ period: "custom", from: "2026-01-01", to: "2026-01-31" }),
    { period: "custom", from: "2025-12-01", to: "2025-12-31" },
  );
});

/** ISO date shifted by `days` (may be negative), via UTC epoch arithmetic. */
function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

test("selectionError returns null for valid monthly, annual, and custom selections", () => {
  assert.equal(selectionError({ period: "monthly", key: "2026-07" }), null);
  assert.equal(selectionError({ period: "annual", key: "2026" }), null);
  assert.equal(selectionError({ period: "custom", from: "2026-07-01", to: "2026-07-31" }), null);
});

test("selectionError reports an inverted custom range", () => {
  assert.equal(
    selectionError({ period: "custom", from: "2026-07-31", to: "2026-07-01" }),
    "The end date must not be before the start date.",
  );
});

test("selectionError reports a custom range spanning MAX_REPORT_RANGE_DAYS + 1 days", () => {
  const from = "2020-01-01";
  const to = shiftIsoDate(from, MAX_REPORT_RANGE_DAYS);
  assert.equal(
    selectionError({ period: "custom", from, to }),
    `Choose a range of ${MAX_REPORT_RANGE_DAYS} days or fewer.`,
  );
});

test("selectionError accepts a custom range spanning exactly MAX_REPORT_RANGE_DAYS days", () => {
  const from = "2020-01-01";
  const to = shiftIsoDate(from, MAX_REPORT_RANGE_DAYS - 1);
  assert.equal(selectionError({ period: "custom", from, to }), null);
});

test("selectionError reports an impossible calendar date", () => {
  assert.equal(
    selectionError({ period: "custom", from: "2026-02-30", to: "2026-03-01" }),
    "Choose a start and end date.",
  );
});

test("selectionError reports a malformed monthly key", () => {
  assert.equal(
    selectionError({ period: "monthly", key: "2026" }),
    "Choose a valid reporting period.",
  );
});
