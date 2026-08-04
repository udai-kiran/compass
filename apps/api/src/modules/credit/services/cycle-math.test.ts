import assert from "node:assert/strict";
import test from "node:test";
import {
  activityWindow,
  cardCycle,
  isBilledIn,
  lastOccurrence,
  nextOccurrence,
  splitByCycle,
} from "./cycle-math.ts";

/** Statement-generation lag in cycle-math.ts — a cycle is only billed this long after it closes. */
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
