import assert from "node:assert/strict";
import test from "node:test";
import {
  dueInstallmentDate,
  firstOccurrenceOnOrAfter,
  lastOccurrenceOnOrBefore,
  nextSipDate,
  sipOccurrencesInWindow,
} from "./sip-schedule.ts";

// ---------- firstOccurrenceOnOrAfter / nextSipDate ----------

test("firstOccurrenceOnOrAfter: same month when the day hasn't passed, inclusive of today", () => {
  assert.equal(firstOccurrenceOnOrAfter("2026-07-01", 5), "2026-07-05");
  assert.equal(firstOccurrenceOnOrAfter("2026-07-05", 5), "2026-07-05"); // inclusive
});

test("firstOccurrenceOnOrAfter: rolls to next month (and next year across December)", () => {
  assert.equal(firstOccurrenceOnOrAfter("2026-07-06", 5), "2026-08-05");
  assert.equal(firstOccurrenceOnOrAfter("2026-12-10", 5), "2027-01-05");
});

test("nextSipDate: a paused SIP has no next date", () => {
  assert.equal(
    nextSipDate({ dayOfMonth: 5, startDate: "2026-01-01", endDate: null, status: "paused" }, "2026-07-23"),
    null,
  );
});

test("nextSipDate: an active SIP resolves to the next day-of-month on/after today", () => {
  assert.equal(
    nextSipDate({ dayOfMonth: 28, startDate: "2026-01-01", endDate: null, status: "active" }, "2026-07-23"),
    "2026-07-28",
  );
  assert.equal(
    nextSipDate({ dayOfMonth: 5, startDate: "2026-01-01", endDate: null, status: "active" }, "2026-07-23"),
    "2026-08-05",
  );
});

test("nextSipDate: a future start date pushes the first occurrence out, not backward", () => {
  assert.equal(
    nextSipDate({ dayOfMonth: 5, startDate: "2026-09-15", endDate: null, status: "active" }, "2026-07-23"),
    "2026-10-05", // first day-5 on/after the Sep-15 start, not July
  );
});

test("nextSipDate: null once the next occurrence would fall after endDate", () => {
  assert.equal(
    nextSipDate(
      { dayOfMonth: 5, startDate: "2026-01-01", endDate: "2026-07-01", status: "active" },
      "2026-07-23",
    ),
    null, // next occurrence (Aug 5) is past the end date
  );
});

// ---------- sipOccurrencesInWindow ----------

test("sipOccurrencesInWindow: steps monthly across the horizon", () => {
  const sip = { dayOfMonth: 5, startDate: "2026-01-01", endDate: null, status: "active" as const };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-07-23", "2026-10-31"), [
    "2026-08-05",
    "2026-09-05",
    "2026-10-05",
  ]);
});

test("sipOccurrencesInWindow: stops at endDate even mid-window", () => {
  const sip = { dayOfMonth: 5, startDate: "2026-01-01", endDate: "2026-09-05", status: "active" as const };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-07-23", "2026-12-31"), ["2026-08-05", "2026-09-05"]);
});

test("sipOccurrencesInWindow: a paused SIP contributes no occurrences", () => {
  const sip = { dayOfMonth: 5, startDate: "2026-01-01", endDate: null, status: "paused" as const };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-07-23", "2026-12-31"), []);
});

test("sipOccurrencesInWindow: an occurrence today counts (inclusive lower bound)", () => {
  const sip = { dayOfMonth: 23, startDate: "2026-01-01", endDate: null, status: "active" as const };
  const dates = sipOccurrencesInWindow(sip, "2026-07-23", "2026-08-01");
  assert.deepEqual(dates, ["2026-07-23"]);
});

// ---------- quarterly / yearly anchoring ----------

test("firstOccurrenceOnOrAfter: quarterly is anchored to the SIP's start month, not the ref month", () => {
  // Anchored months: Jan, Apr, Jul, Oct.
  assert.equal(firstOccurrenceOnOrAfter("2026-02-01", 5, "quarterly", "2026-01-01"), "2026-04-05");
  // Ref already inside an anchored month, day not yet passed — same month.
  assert.equal(firstOccurrenceOnOrAfter("2026-04-01", 5, "quarterly", "2026-01-01"), "2026-04-05");
});

test("nextSipDate: quarterly SIP resolves to the next anchored month (startDate's month), not the nearest month", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-03-15",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
  };
  // Anchored months from March: Mar, Jun, Sep, Dec. Jun 5 has already passed by Jul 23.
  assert.equal(nextSipDate(sip, "2026-07-23"), "2026-09-05");
});

test("sipOccurrencesInWindow: quarterly steps 3 months at a time, straddling a year boundary", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-03-15",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
  };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-10-23", "2027-04-30"), ["2026-12-05", "2027-03-05"]);
});

test("sipOccurrencesInWindow: yearly steps 12 months at a time across several years", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2020-01-01",
    endDate: null,
    status: "active" as const,
    frequency: "yearly" as const,
  };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-07-23", "2028-12-31"), ["2027-01-05", "2028-01-05"]);
});

test("sipOccurrencesInWindow: quarterly SIP whose next anchored occurrence falls outside a 90-day window", () => {
  // Anchored months: Mar, Jun, Sep, Dec. Today is the day after the March
  // occurrence, so the next one (Jun 1) is ~91 days out — one day past a
  // 90-day horizon from today.
  const sip = {
    dayOfMonth: 1,
    startDate: "2025-03-01",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
  };
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-03-02", "2026-05-31"), []);
});

test("sipOccurrencesInWindow: quarterly SIP stops at endDate even mid-window", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: "2027-01-05",
    status: "active" as const,
    frequency: "quarterly" as const,
  };
  // Anchored months from Jan: Jan, Apr, Jul, Oct. Next after Jul 23 is Oct 5,
  // then Jan 5 (== endDate, included), then Apr 5 would be past endDate.
  assert.deepEqual(sipOccurrencesInWindow(sip, "2026-07-23", "2027-06-30"), ["2026-10-05", "2027-01-05"]);
});

// ---------- lastOccurrenceOnOrBefore (mirror of firstOccurrenceOnOrAfter) ----------

test("lastOccurrenceOnOrBefore: monthly, today after dayOfMonth resolves to this month", () => {
  assert.equal(
    lastOccurrenceOnOrBefore({ dayOfMonth: 5, startDate: "2026-01-01", endDate: null }, "2026-07-23"),
    "2026-07-05",
  );
});

test("lastOccurrenceOnOrBefore: monthly, today before dayOfMonth resolves to last month", () => {
  assert.equal(
    lastOccurrenceOnOrBefore({ dayOfMonth: 28, startDate: "2026-01-01", endDate: null }, "2026-07-23"),
    "2026-06-28",
  );
});

test("lastOccurrenceOnOrBefore: today exactly on dayOfMonth resolves to today", () => {
  assert.equal(
    lastOccurrenceOnOrBefore({ dayOfMonth: 23, startDate: "2026-01-01", endDate: null }, "2026-07-23"),
    "2026-07-23",
  );
});

test("lastOccurrenceOnOrBefore: a quarterly SIP is anchored to its startDate month, not 3 months back from today", () => {
  // Anchored months from March: Mar, Jun, Sep, Dec. On Jul 23, Jun 5 is the
  // last anchored occurrence — not Apr 5 (naive 3-months-back) nor Apr 23.
  const sip = { dayOfMonth: 5, startDate: "2026-03-15", endDate: null, frequency: "quarterly" as const };
  assert.equal(lastOccurrenceOnOrBefore(sip, "2026-07-23"), "2026-06-05");
});

test("lastOccurrenceOnOrBefore: null when the result would precede startDate", () => {
  assert.equal(
    lastOccurrenceOnOrBefore({ dayOfMonth: 5, startDate: "2026-09-15", endDate: null }, "2026-07-23"),
    null,
  );
});

test("lastOccurrenceOnOrBefore: clamps to endDate when today is far past it", () => {
  const sip = { dayOfMonth: 5, startDate: "2026-01-01", endDate: "2026-07-01" };
  assert.equal(lastOccurrenceOnOrBefore(sip, "2030-01-01"), "2026-06-05");
});

test("lastOccurrenceOnOrBefore: a yearly SIP is anchored to its startDate month", () => {
  // startDate="2024-03-15" anchors the yearly cycle to March. dayOfMonth=5,
  // today="2026-07-23".
  //   ref = today = "2026-07-23" (no endDate to clamp against).
  //   d (ref's day-of-month) = 23; dayOfMonth = 5; 23 < 5 is false, so
  //   candidateIdx stays at monthIndex("2026-07-23") = 2026*12 + 6.
  //   step = 12 (yearly); anchorIdx = monthIndex("2024-03-15") = 2024*12 + 2.
  //   diff = (2026*12+6) - (2024*12+2) = 24 + 4 = 28.
  //   offset = ((28 % 12) + 12) % 12 = (4 + 12) % 12 = 4.
  //   candidateIdx -= 4 -> 2026*12 + 2 -> month index for 2026-03.
  //   date = dateFromMonthIndex(that, 5) = "2026-03-05", which is >= startDate.
  const sip = { dayOfMonth: 5, startDate: "2024-03-15", endDate: null, frequency: "yearly" as const };
  assert.equal(lastOccurrenceOnOrBefore(sip, "2026-07-23"), "2026-03-05");
});

test("lastOccurrenceOnOrBefore: quarterly, reference month precedes anchor month, pins the `+ step` negative-modulo guard", () => {
  // This is the case the `+ step` guard exists for: candidateIdx - anchorIdx is
  // negative, so JS's `%` (which keeps the dividend's sign) alone would give a
  // negative offset; without `+ step` the subsequent subtraction would move
  // candidateIdx the wrong way — forward instead of backward.
  //   startDate="2026-09-01" anchors to September. dayOfMonth=5, today="2026-07-23".
  //   IMPORTANT: startDate's day-of-month (1) must be earlier than dayOfMonth
  //   (5) for this test to actually distinguish correct from buggy — see the
  //   buggy-path arithmetic below. Do not "tidy" this back to a startDate day
  //   later than dayOfMonth (e.g. the 15th): both the correct and buggy paths
  //   then land before startDate and the assertion can no longer tell them apart.
  //   ref = today = "2026-07-23"; d = 23, dayOfMonth = 5, 23 < 5 is false, so
  //   candidateIdx = monthIndex("2026-07-23") = 2026*12 + 6.
  //   step = 3 (quarterly); anchorIdx = monthIndex("2026-09-01") = 2026*12 + 8.
  //   diff = 6 - 8 = -2. Plain `-2 % 3` in JS is -2 (sign of dividend).
  //   Correct path: the `+ step` guard turns this into (-2 + 3) % 3 = 1, so
  //   candidateIdx -= 1 -> 2026*12 + 5 -> dateFromMonthIndex(.., 5) = "2026-06-05",
  //   which is before startDate "2026-09-01" — the function returns null.
  //   Buggy path (guard removed): offset stays -2, so `candidateIdx -= (-2)`
  //   moves candidateIdx *forward* by 2 instead of back -> 2026*12 + 8 ->
  //   dateFromMonthIndex(.., 5) = "2026-09-05" — which is NOT before startDate
  //   "2026-09-01" (it's 4 days after it), so the buggy path would return
  //   "2026-09-05" instead of null. That's what makes this assertion able to
  //   catch the missing guard.
  const sip = { dayOfMonth: 5, startDate: "2026-09-01", endDate: null, frequency: "quarterly" as const };
  assert.equal(lastOccurrenceOnOrBefore(sip, "2026-07-23"), null);
});

test("lastOccurrenceOnOrBefore: yearly, reference month precedes anchor month, pins the `+ step` negative-modulo guard", () => {
  // Same rationale as the quarterly case above, but with step=12: the negative
  // diff still needs the `+ step` guard to land on a valid (non-negative) offset.
  //   startDate="2026-09-01" anchors to September. dayOfMonth=5, today="2026-07-23".
  //   IMPORTANT: startDate's day-of-month (1) must be earlier than dayOfMonth
  //   (5) for this test to actually distinguish correct from buggy — see the
  //   buggy-path arithmetic below. Do not "tidy" this back to a startDate day
  //   later than dayOfMonth (e.g. the 15th): both the correct and buggy paths
  //   then land before startDate and the assertion can no longer tell them apart.
  //   ref = today = "2026-07-23"; d = 23, dayOfMonth = 5, 23 < 5 is false, so
  //   candidateIdx = monthIndex("2026-07-23") = 2026*12 + 6.
  //   step = 12 (yearly); anchorIdx = monthIndex("2026-09-01") = 2026*12 + 8.
  //   diff = 6 - 8 = -2. Plain `-2 % 12` in JS is -2 (sign of dividend).
  //   Correct path: `((-2 % 12) + 12) % 12` = (-2 + 12) % 12 = 10, so
  //   candidateIdx -= 10 -> 2026*12 - 4 = 2025*12 + 8 -> dateFromMonthIndex(.., 5)
  //   = "2025-09-05", which is before startDate "2026-09-01" — the function
  //   returns null.
  //   Buggy path (guard removed): offset stays -2, so `candidateIdx -= (-2)`
  //   moves candidateIdx *forward* by 2 instead of back -> 2026*12 + 8 ->
  //   dateFromMonthIndex(.., 5) = "2026-09-05" — which is NOT before startDate
  //   "2026-09-01" (it's 4 days after it), so the buggy path would return
  //   "2026-09-05" instead of null. That's what makes this assertion able to
  //   catch the missing guard.
  const sip = { dayOfMonth: 5, startDate: "2026-09-01", endDate: null, frequency: "yearly" as const };
  assert.equal(lastOccurrenceOnOrBefore(sip, "2026-07-23"), null);
});

// ---------- dueInstallmentDate ----------

test("dueInstallmentDate: null for a paused SIP", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "paused" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), null);
});

test("dueInstallmentDate: an account-target SIP now prompts — it records by linking a ledger transaction", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: a payroll-funded SIP never prompts — the payslip records it directly and stamps no sip_id", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "payroll" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), null);
});

test("dueInstallmentDate: the due date when lastInstallmentDate is null", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: null when lastInstallmentDate equals the due date", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-05", "2026-07-23"), null);
});

test("dueInstallmentDate: the due date when lastInstallmentDate is older than it", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-06-05", "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: null when lastInstallmentDate is somehow newer than the due date", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-06", "2026-07-23"), null);
});

test("dueInstallmentDate: an early deposit earlier in the same cycle clears the due flag (AC1)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-01", "2026-07-10"), null);
});

test("dueInstallmentDate: an installment from a strictly earlier cycle still leaves due reported (AC3)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-06-28", "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: quarterly — a same-cycle-month deposit clears the due flag (AC4)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2025-12-05",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-06-01", "2026-06-23"), null);
});

test("dueInstallmentDate: yearly — a deposit in the prior cycle's final month still leaves due reported (AC4)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2024-03-05",
    endDate: null,
    status: "active" as const,
    frequency: "yearly" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-02-28", "2026-03-23"), "2026-03-05");
});

test("dueInstallmentDate: yearly — a deposit on the 1st of the occurrence month clears the due flag (AC4)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2024-03-05",
    endDate: null,
    status: "active" as const,
    frequency: "yearly" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-03-01", "2026-03-23"), null);
});

test("dueInstallmentDate: quarterly — a deposit from the prior full-cycle block still leaves due reported (AC5)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2025-12-05",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-06-05", "2026-09-23"), "2026-09-05");
  assert.equal(dueInstallmentDate(sip, "2026-06-30", "2026-09-23"), "2026-09-05");
});

test("dueInstallmentDate: quarterly — a later month within the current multi-month block clears the due flag (AC5)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2025-12-05",
    endDate: null,
    status: "active" as const,
    frequency: "quarterly" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-15", "2026-08-23"), null);
  assert.equal(dueInstallmentDate(sip, "2026-08-20", "2026-08-23"), null);
});

test("dueInstallmentDate: mid-month startDate — a deposit before dayOfMonth in the start month clears the due flag (AC6)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-03-03",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-03-03", "2026-03-23"), null);
  assert.equal(dueInstallmentDate(sip, "2026-03-04", "2026-03-23"), null);
});

test("dueInstallmentDate: mid-month startDate after dayOfMonth — no occurrence exists yet (AC6, pinned unchanged)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-03-15",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-03-23"), null);
});

test("dueInstallmentDate: ended SIP clamps the cycle to its endDate, not today (AC6)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: "2026-07-02",
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  // The final aligned occurrence is clamped to 2026-06-05 (July's 5th is past
  // endDate), so a June deposit clears it even though today is well past July.
  assert.equal(dueInstallmentDate(sip, "2026-06-01", "2026-07-23"), null);
  assert.equal(dueInstallmentDate(sip, "2026-05-20", "2026-07-23"), "2026-06-05");
});

test("dueInstallmentDate: exact threshold — the 1st of due's month clears, the last day of the prior month does not (AC7)", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    fundingSource: "bank_debit" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-01", "2026-07-23"), null);
  assert.equal(dueInstallmentDate(sip, "2026-06-30", "2026-07-23"), "2026-07-05");
});
