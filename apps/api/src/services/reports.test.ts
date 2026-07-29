import { test } from "node:test";
import assert from "node:assert/strict";
import type { Report, ReportQuery } from "@compass/shared";
import { MAX_REPORT_RANGE_DAYS, formatINR } from "@compass/shared";
import type { NecessitySpendRow } from "./periods.ts";
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

test("splitByNecessity sorts rows into essential, non-essential and unclassified by resolved necessity", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: null, catKind: "expense", spentPaise: 123451 },
    { txNecessity: "non_essential", catNecessity: null, catKind: "expense", spentPaise: 98763 },
    { txNecessity: null, catNecessity: null, catKind: "expense", spentPaise: 55551 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 123451,
    nonEssentialPaise: 98763,
    unclassifiedPaise: 55551,
  });
});

test("a transaction override routes spend away from its category's default bucket", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: "non_essential", catKind: "expense", spentPaise: 71317 },
  ];
  const result = splitByNecessity(rows);
  assert.equal(result.essentialPaise, 71317);
  assert.equal(result.nonEssentialPaise, 0);
});

test("uncategorized spend is unclassified, never assumed", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: null, catNecessity: null, catKind: null, spentPaise: 42503 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 42503,
  });
});

test("a category with no necessity default set is unclassified", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: null, catNecessity: null, catKind: "expense", spentPaise: 31009 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 31009,
  });
});

test("spend booked against an income category's default is unclassified", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: null, catNecessity: "essential", catKind: "income", spentPaise: 75031 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 0,
    nonEssentialPaise: 0,
    unclassifiedPaise: 75031,
  });
});

test("a transaction override classifies spend that has no category at all", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: null, catKind: null, spentPaise: 60107 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 60107,
    nonEssentialPaise: 0,
    unclassifiedPaise: 0,
  });
});

test("a transaction override applies across all of its split category rows", () => {
  // One transaction split across two categories that disagree with each other and
  // with the override; the override is transaction-level, so every part follows it.
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: "non_essential", catKind: "expense", spentPaise: 40903 },
    { txNecessity: "essential", catNecessity: null, catKind: "expense", spentPaise: 15101 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 56004,
    nonEssentialPaise: 0,
    unclassifiedPaise: 0,
  });
});

test("two rows resolving to the same necessity sum rather than overwrite", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: null, catKind: "expense", spentPaise: 11117 },
    { txNecessity: null, catNecessity: "essential", catKind: "expense", spentPaise: 22229 },
  ];
  assert.deepEqual(splitByNecessity(rows), {
    essentialPaise: 33346,
    nonEssentialPaise: 0,
    unclassifiedPaise: 0,
  });
});

test("the three buckets always sum to the total spend across all input rows", () => {
  const rows: NecessitySpendRow[] = [
    { txNecessity: "essential", catNecessity: null, catKind: "expense", spentPaise: 105007 },
    { txNecessity: null, catNecessity: "non_essential", catKind: "expense", spentPaise: 62003 },
    { txNecessity: null, catNecessity: null, catKind: null, spentPaise: 38009 },
    { txNecessity: null, catNecessity: "essential", catKind: "income", spentPaise: 14501 },
  ];
  const result = splitByNecessity(rows);
  const total = rows.reduce((sum, r) => sum + r.spentPaise, 0);
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
