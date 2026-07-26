import assert from "node:assert/strict";
import test from "node:test";
import type { AccountAverageBalance } from "@compass/shared";
import { ambSummary, ambWindowNote } from "./amb-display.ts";

const amb = (overrides: Partial<AccountAverageBalance> = {}): AccountAverageBalance => ({
  accountId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  from: "2026-07-16",
  to: "2026-07-26",
  days: 11,
  daysInMonth: 31,
  averagePaise: 3563800,
  requiredPaise: 0,
  status: "none",
  shortfallPaise: 0,
  partialHistory: false,
  ...overrides,
});

test("ambSummary for status 'none' just shows the average, no shortfall wording", () => {
  const result = ambSummary(amb({ status: "none", averagePaise: 3563800 }));
  assert.equal(result.text, "AMB ₹35,638.00");
  assert.equal(result.short, false);
});

test("ambSummary for status 'ok' also just shows the average", () => {
  const result = ambSummary(amb({ status: "ok", requiredPaise: 1000000, averagePaise: 3563800 }));
  assert.equal(result.text, "AMB ₹35,638.00");
  assert.equal(result.short, false);
});

test("ambSummary for status 'short' appends 'below required average', not a bare 'short' amount — the value is the gap between two averages, not a deposit amount", () => {
  const result = ambSummary(
    amb({ status: "short", averagePaise: 850000, requiredPaise: 1000000, shortfallPaise: 150000 }),
  );
  assert.equal(result.text, "AMB ₹8,500.00 · ₹1,500.00 below required average");
  assert.equal(result.short, true);
});

test("short is true only for status 'short' — 'none' and 'ok' are never flagged", () => {
  assert.equal(ambSummary(amb({ status: "none" })).short, false);
  assert.equal(ambSummary(amb({ status: "ok" })).short, false);
  assert.equal(ambSummary(amb({ status: "short" })).short, true);
});

// partialHistory must be visible on the page itself, not only in a hover-only
// title tooltip (undiscoverable, unavailable on touch devices).
test("partialHistory appends a visible 'since <date>' segment to the summary text", () => {
  const result = ambSummary(
    amb({ status: "none", partialHistory: true, from: "2026-07-16", averagePaise: 3563800 }),
  );
  assert.equal(result.text, "AMB ₹35,638.00 · since 16 Jul");
});

// A short AND partial-history account must show both caveats at once — neither
// should silently override or hide the other.
test("short + partialHistory together produce both segments in the summary", () => {
  const result = ambSummary(
    amb({
      status: "short",
      averagePaise: 850000,
      requiredPaise: 1000000,
      shortfallPaise: 150000,
      partialHistory: true,
      from: "2026-07-16",
    }),
  );
  assert.equal(
    result.text,
    "AMB ₹8,500.00 · ₹1,500.00 below required average · since 16 Jul",
  );
  assert.equal(result.short, true);
});

test("a partial window (days < daysInMonth), not partialHistory, reads as month-to-date, not a completed month", () => {
  const note = ambWindowNote(
    amb({ from: "2026-07-01", to: "2026-07-26", days: 26, daysInMonth: 31, partialHistory: false }),
  );
  assert.equal(
    note,
    "Average of daily closing balances, 1–26 Jul (26 days so far this month). The month isn't over, so this can still change.",
  );
});

// The month-to-date case must convey that an "ok" status today isn't a
// guarantee for the whole month, since more days remain to be averaged in.
test("ambWindowNote for the not-partial month-to-date case conveys the month isn't over", () => {
  const note = ambWindowNote(
    amb({ from: "2026-07-01", to: "2026-07-26", days: 26, daysInMonth: 31, partialHistory: false }),
  );
  assert.ok(note.includes("month isn't over"));
});

test("a full month window (days === daysInMonth) reads as the full month", () => {
  const note = ambWindowNote(amb({ from: "2026-07-01", to: "2026-07-31", days: 31, daysInMonth: 31 }));
  assert.equal(note, "Average of daily closing balances, 1–31 Jul (31 days, full month)");
});

// partialHistory must NOT read like "so far this month" — that phrasing implies
// the month itself started on `from`, when in fact the window starts there only
// because earlier balances are missing (a genuinely different, riskier fact).
test("ambWindowNote for partialHistory does not say 'so far this month' and explains the missing earlier history", () => {
  const note = ambWindowNote(
    amb({ from: "2026-07-16", to: "2026-07-26", days: 11, daysInMonth: 31, partialHistory: true }),
  );
  assert.ok(!note.includes("so far this month"));
  assert.ok(note.includes("No balance is recorded earlier in the month"));
});

// A partial-history window that also doesn't cover the whole month is BOTH
// missing earlier balances AND still accumulating — an account first seen on
// 16 Jul is still month-to-date, so a currently-satisfactory average can still
// deteriorate before month end. Both warnings must be present.
test("ambWindowNote for partialHistory ALSO warns the month isn't over when days < daysInMonth", () => {
  const note = ambWindowNote(
    amb({ from: "2026-07-16", to: "2026-07-26", days: 11, daysInMonth: 31, partialHistory: true }),
  );
  assert.ok(note.includes("No balance is recorded earlier in the month"));
  assert.ok(note.includes("month isn't over"));
});

// partialHistory viewed on the month's last day must NOT claim the month isn't
// over. `days` (16) is short only because history before 16 Jul is missing, not
// because July is unfinished — `to` being the 31st means the month IS over. A
// full-history account on the same day (`days === daysInMonth`) correctly says
// "full month", so these two must not contradict each other.
test("partialHistory viewed on the month's last day must NOT claim the month isn't over", () => {
  const note = ambWindowNote(
    amb({ from: "2026-07-16", to: "2026-07-31", days: 16, daysInMonth: 31, partialHistory: true }),
  );
  assert.ok(!note.includes("month isn't over"));
  assert.ok(note.includes("No balance is recorded earlier in the month"));
});
