import assert from "node:assert/strict";
import test from "node:test";
import { activityWindow, cardCycle, isBilledIn, lastOccurrence, nextOccurrence, splitByCycle, summarizeStatementLines } from "./cards.ts";

/** Statement-generation lag in cards.ts — a cycle is only billed this long after it closes. */
const GEN_LAG_DAYS = 4;

/** An ISO date shifted by whole days — local to the tests. */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("cardCycle: a cycle starts on the previous close day and ends the day before the next", () => {
  assert.deepEqual(cardCycle("2026-07-26", 20), {
    start: "2026-06-20",
    end: "2026-07-19",
    close: "2026-07-20",
  });
});

test("isBilledIn: a charge dated on the cycle's first day is billed by that statement", () => {
  const cycle = cardCycle("2026-07-26", 20);
  // This is the regression — HDFC's 20 Jul statement bills 20 Jun, and treating
  // the window as exclusive dropped ₹34,134 + ₹529 of real charges.
  assert.strictEqual(isBilledIn("2026-06-20", cycle), true);
});

test("isBilledIn: a charge dated on the close day bills on the next statement, not this one", () => {
  const cycle = cardCycle("2026-07-26", 20);
  assert.strictEqual(isBilledIn("2026-07-20", cycle), false);
  assert.strictEqual(isBilledIn("2026-07-19", cycle), true);
});

test("cardCycle: consecutive cycles bill every date exactly once", () => {
  // Exactly one statement bills each date: no overlap and no gap. Sweep several
  // cycle days and a window of dates that crosses both a month and a year end.
  for (const cycleDay of [1, 5, 20, 28]) {
    for (const ref of ["2026-07-26", "2026-01-10", "2026-03-05"]) {
      const cur = cardCycle(ref, cycleDay);
      // Ask from just past the generation lag, so the cycle closing on cur.start
      // has actually been issued: asking on cur.start - 1 would (correctly) report
      // the cycle before it, since that statement doesn't exist yet.
      const prev = cardCycle(shiftIso(cur.start, GEN_LAG_DAYS), cycleDay);
      assert.strictEqual(prev.close, cur.start, `${ref}/${cycleDay}: cycles must abut`);
      for (const d of [prev.start, prev.end, cur.start, cur.end]) {
        const billed = Number(isBilledIn(d, prev)) + Number(isBilledIn(d, cur));
        assert.strictEqual(billed, 1, `${d} (ref ${ref}, day ${cycleDay}) billed ${billed} times`);
      }
    }
  }
});

test("cardCycle: a cycle that closed only days ago is not billed yet", () => {
  assert.deepEqual(cardCycle("2026-07-22", 20), {
    start: "2026-05-20",
    end: "2026-06-19",
    close: "2026-06-20",
  });
});

test("cardCycle: crosses a year boundary", () => {
  assert.deepEqual(cardCycle("2026-01-10", 1), {
    start: "2025-12-01",
    end: "2025-12-31",
    close: "2026-01-01",
  });
});

test("lastOccurrence / nextOccurrence: the close day itself is the boundary", () => {
  assert.strictEqual(lastOccurrence("2026-07-20", 20), "2026-07-20");
  assert.strictEqual(nextOccurrence("2026-07-20", 20), "2026-08-20");
  assert.strictEqual(nextOccurrence("2026-07-20", 7), "2026-08-07");
});

test("summarizeStatementLines: a line tied to a live ledger transaction counts as cleared", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 52900, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 3413400, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 3466300 }, lines);
  assert.strictEqual(stats.matchedCount, 1);
  assert.strictEqual(stats.unmatchedCount, 1);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 3466300);
  assert.strictEqual(stats.matchedPaise, 52900);
  assert.deepEqual(stats.matchedTxnIds, ["t1"]);
});

test("summarizeStatementLines: every line linked leaves nothing to review", () => {
  // This is the state card 2862 should reach once its accepted lines are
  // re-checked — the extractor stored 0/16 because it matched against an empty ledger.
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 200000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 3, lineDebitPaise: 600000 }, lines);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 600000);
  assert.strictEqual(stats.matchedPaise, stats.lineDebitPaise);
});

test("summarizeStatementLines: a cleared refund does not shrink the spend delta", () => {
  const lines = [
    { direction: "credit" as const, amountPaise: 4559100, ledgerTxnId: "t9" },
    { direction: "debit" as const, amountPaise: 519900, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 519900 }, lines);
  assert.strictEqual(stats.lineDebitPaise, 519900);
  assert.strictEqual(stats.matchedCount, 1);
  // The credit must NOT count as cleared spend.
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: the issuer's own totals survive a recompute that sees no lines", () => {
  // Card 3623's live state: the extractor skipped both lines as dedupe hits, so
  // recounting from surviving rows would wipe what the issuer actually billed.
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 14900 }, []);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 14900);
  assert.strictEqual(stats.matchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 2);
  assert.deepEqual(stats.matchedTxnIds, []);
});

test("summarizeStatementLines: a partly-deduplicated statement keeps the issuer's line count", () => {
  // Card 0515's live shape: the issuer billed 4 lines, but only 3 survived (the
  // fourth was never stored because its spend was already captured from an alert).
  // It reads as unmatched — conservative, never a false all-clear.
  const lines = [
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 417115, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 4, lineDebitPaise: 1173657 }, lines);
  assert.strictEqual(stats.lineCount, 4);
  assert.strictEqual(stats.lineDebitPaise, 1173657);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: more links than the issuer listed never yields a negative backlog", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t2" },
  ];
  const stats = summarizeStatementLines({ lineCount: 1, lineDebitPaise: 100000 }, lines);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedCount, 2);
});

test("activityWindow: the listed window starts on the cycle's first billed day", () => {
  const cycle = cardCycle("2026-07-26", 20);
  const w = activityWindow(cycle, "2026-07-26");
  // Inclusive: the SQL that loads rows must not exclude the start day, or the
  // billed split never sees the charges dated on it.
  assert.strictEqual(w.fromInclusive, "2026-06-20");
  assert.strictEqual(w.fromInclusive, cycle.start);
  assert.strictEqual(w.billedBefore, "2026-07-20");
  assert.strictEqual(w.billedBefore, cycle.close);
});

test("activityWindow: with no cycle configured, today's spend still counts as billed", () => {
  const w = activityWindow(null, "2026-07-26");
  assert.strictEqual(w.billedBefore, "2026-07-27");
  assert.strictEqual(w.fromInclusive, "2026-06-11");
});

test("splitByCycle: every row bills exactly once, and the start day bills now", () => {
  const cycle = cardCycle("2026-07-26", 20);
  const rows = [
    { date: "2026-06-19" }, // previous cycle
    { date: "2026-06-20" }, // start day — the regression
    { date: "2026-07-19" }, // last billed day
    { date: "2026-07-20" }, // close day — bills next cycle
    { date: "2026-07-25" },
  ];
  const { billed, unbilled } = splitByCycle(rows, cycle);
  assert.deepEqual(
    billed.map((r) => r.date),
    ["2026-06-20", "2026-07-19"],
  );
  assert.deepEqual(
    unbilled.map((r) => r.date),
    ["2026-06-19", "2026-07-20", "2026-07-25"],
  );
  // No row is lost or double-counted.
  assert.strictEqual(billed.length + unbilled.length, rows.length);
});

test("splitByCycle: with no cycle nothing is billed yet", () => {
  const rows = [{ date: "2026-07-01" }, { date: "2026-07-26" }];
  const { billed, unbilled } = splitByCycle(rows, null);
  assert.deepEqual(billed, []);
  assert.strictEqual(unbilled.length, 2);
});
