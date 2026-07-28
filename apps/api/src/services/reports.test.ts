import { test } from "node:test";
import assert from "node:assert/strict";
import type { Report, ReportQuery } from "@compass/shared";
import { MAX_REPORT_RANGE_DAYS, formatINR } from "@compass/shared";
import { reportToCsv, resolveReportRange, splitByNecessity } from "./reports.ts";

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

test("splitByNecessity sorts spend into essential, non-essential and unclassified by category", () => {
  const byCategory = new Map<string | null, number>([
    ["cat-essential", 1234500],
    ["cat-non-essential", 987600],
    ["cat-unset", 555500],
  ]);
  const categoryRows = [
    { id: "cat-essential", kind: "expense" as const, necessity: "essential" as const },
    { id: "cat-non-essential", kind: "expense" as const, necessity: "non_essential" as const },
    { id: "cat-unset", kind: "expense" as const, necessity: null },
  ];
  assert.deepEqual(splitByNecessity(byCategory, categoryRows), {
    essentialPaise: 1234500,
    nonEssentialPaise: 987600,
    unclassifiedPaise: 555500,
  });
});

test("uncategorized spend is unclassified, never assumed", () => {
  const byCategory = new Map<string | null, number>([[null, 425000]]);
  assert.deepEqual(splitByNecessity(byCategory, []), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 425000,
  });
});

test("a category with no necessity set is unclassified", () => {
  const byCategory = new Map<string | null, number>([["cat-unset", 310000]]);
  const categoryRows = [{ id: "cat-unset", kind: "expense" as const, necessity: null }];
  assert.deepEqual(splitByNecessity(byCategory, categoryRows), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 310000,
  });
});

test("a category id absent from the list is unclassified", () => {
  const byCategory = new Map<string | null, number>([["cat-unknown", 199900]]);
  assert.deepEqual(splitByNecessity(byCategory, []), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 199900,
  });
});

test("spend booked against an income category is unclassified", () => {
  const byCategory = new Map<string | null, number>([["cat-income", 750000]]);
  const categoryRows = [
    { id: "cat-income", kind: "income" as const, necessity: "essential" as const },
  ];
  assert.deepEqual(splitByNecessity(byCategory, categoryRows), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 750000,
  });
});

test("the three buckets always sum to the total spend", () => {
  const byCategory = new Map<string | null, number>([
    ["cat-essential", 1050000],
    ["cat-non-essential", 620000],
    [null, 380000],
    ["cat-unknown", 145000],
  ]);
  const categoryRows = [
    { id: "cat-essential", kind: "expense" as const, necessity: "essential" as const },
    { id: "cat-non-essential", kind: "expense" as const, necessity: "non_essential" as const },
  ];
  const result = splitByNecessity(byCategory, categoryRows);
  const total = [...byCategory.values()].reduce((sum, v) => sum + v, 0);
  assert.equal(result.essentialPaise + result.nonEssentialPaise + result.unclassifiedPaise, total);
});

test("reportToCsv emits the necessity rows with distinct labels and values", () => {
  const report: Report = {
    period: "monthly",
    periodKey: "2026-07",
    from: "2026-07-01",
    to: "2026-07-31",
    incomePaise: 10000000,
    expensePaise: 6000000,
    netPaise: 4000000,
    savingsRatePct: 40,
    necessity: {
      essentialPaise: 4500000,
      nonEssentialPaise: 1200000,
      unclassifiedPaise: 300000,
    },
    categories: [],
    topMerchants: [],
  };
  const csv = reportToCsv(report);
  assert.ok(csv.includes(`Essential spend,"${formatINR(4500000)}"`));
  assert.ok(csv.includes(`Non-essential spend,"${formatINR(1200000)}"`));
  assert.ok(csv.includes(`Unclassified spend,"${formatINR(300000)}"`));
});
