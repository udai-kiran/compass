import assert from "node:assert/strict";
import test from "node:test";
import { accountCanHaveGoal, sipDateRangeValid } from "@compass/shared";
import { HttpError } from "../lib/errors.ts";
import {
  assertLinkRowsMatched,
  classifySipTarget,
  committedSplit,
  dueInstallmentDate,
  firstOccurrenceOnOrAfter,
  installmentDateError,
  isArchived,
  isCheckViolation,
  isUniqueViolation,
  laterInstallmentDate,
  lastOccurrenceOnOrBefore,
  monthlyEquivalentPaise,
  nextSipDate,
  resolveSipDateRange,
  resolveSipFundingTarget,
  resolveTargetGoalDecision,
  sipOccurrencesInWindow,
} from "./sips.ts";

// ---------- committedSplit / classifySipTarget ----------

test("committedSplit sums active SIPs into their equity/debt legs", () => {
  assert.deepEqual(
    committedSplit([
      { amountPaise: 5_000_00, allocationClass: "equity" },
      { amountPaise: 3_000_00, allocationClass: "debt" },
      { amountPaise: 2_000_00, allocationClass: "equity" },
    ]),
    { committedEquityPaise: 7_000_00, committedDebtPaise: 3_000_00 },
  );
});

test("committedSplit ignores 'other' targets and handles an empty list", () => {
  assert.deepEqual(
    committedSplit([{ amountPaise: 1_000_00, allocationClass: "other" }]),
    { committedEquityPaise: 0, committedDebtPaise: 0 },
  );
  assert.deepEqual(committedSplit([]), { committedEquityPaise: 0, committedDebtPaise: 0 });
});

test("classifySipTarget: an mf_folio SIP takes its holding's classification", () => {
  assert.equal(
    classifySipTarget({
      targetKind: "mf_folio",
      holding: { assetClass: "mutual_fund", gainsTaxClass: "equity" },
      account: null,
    }),
    "equity",
  );
  assert.equal(
    classifySipTarget({
      targetKind: "mf_folio",
      holding: { assetClass: "mutual_fund", gainsTaxClass: "specified_fund" },
      account: null,
    }),
    "debt",
  );
});

test("classifySipTarget: credited schemes are debt while blended NPS stays other", () => {
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "ppf" } }),
    "debt",
  );
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "ssy" } }),
    "debt",
  );
  assert.equal(
    classifySipTarget({ targetKind: "account", holding: null, account: { type: "nps" } }),
    "other",
  );
});

test("classifySipTarget: a missing joined target (deleted row) degrades to 'other', not a crash", () => {
  assert.equal(classifySipTarget({ targetKind: "mf_folio", holding: null, account: null }), "other");
  assert.equal(classifySipTarget({ targetKind: "account", holding: null, account: null }), "other");
});

// ---------- frequency monthlyization ----------

test("monthlyEquivalentPaise: monthly passes through, quarterly/yearly divide down (rounded)", () => {
  assert.equal(monthlyEquivalentPaise(5_000_00, "monthly"), 5_000_00);
  assert.equal(monthlyEquivalentPaise(36_000_00, "quarterly"), 12_000_00);
  assert.equal(monthlyEquivalentPaise(1_20_000_00, "yearly"), 10_000_00);
  // rounds rather than truncating/erroring on a non-exact split
  assert.equal(monthlyEquivalentPaise(1_000_00, "quarterly"), 33_333); // 100000/3 = 33333.33
  assert.equal(monthlyEquivalentPaise(1_000_00, "yearly"), 8_333); // 100000/12 = 8333.33
});

test("committedSplit monthlyizes each SIP's contribution by its own frequency before summing", () => {
  assert.deepEqual(
    committedSplit([
      // MF SIP, monthly, equity
      { amountPaise: 10_000_00, frequency: "monthly", allocationClass: "equity" },
      // PPF SIP, quarterly, debt — contributes a third per month
      { amountPaise: 30_000_00, frequency: "quarterly", allocationClass: "debt" },
      // SSY SIP, yearly, debt — contributes a twelfth per month
      { amountPaise: 1_20_000_00, frequency: "yearly", allocationClass: "debt" },
    ]),
    { committedEquityPaise: 10_000_00, committedDebtPaise: 10_000_00 + 10_000_00 },
  );
});

test("committedSplit treats a missing frequency as monthly (backward compatible)", () => {
  assert.deepEqual(
    committedSplit([{ amountPaise: 5_000_00, allocationClass: "equity" }]),
    { committedEquityPaise: 5_000_00, committedDebtPaise: 0 },
  );
});

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

// ---------- resolveTargetGoalDecision (Fix 1: target-goal reconciliation) ----------

test("resolveTargetGoalDecision: an unmapped target gets linked to the SIP's goal", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", null), "link");
});

test("resolveTargetGoalDecision: a target already mapped to the SIP's own goal is allowed as a no-op", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", "goal-1"), "allow");
});

test("resolveTargetGoalDecision: a target mapped to a different goal is rejected", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", "goal-2"), "reject");
});

// ---------- sipDateRangeValid (Fix 4: endDate >= startDate) ----------

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

// ---------- account target type gate (Fix 2: bank/cash can't be a SIP target) ----------
// assertAccountTargetType (DB-backed, not unit-tested here) gates on
// accountCanHaveGoal — the same investment-scheme set accounts.goalId accepts.
// Bank/cash must be rejected: the 90-day forecast (cashflow.ts bankCashTotal)
// aggregates every bank+cash balance, so crediting one as a SIP target would
// fabricate a cash loss instead of moving money between two counted balances.

test("SIP account targets: bank/cash are rejected (would double-count against the cash forecast)", () => {
  assert.equal(accountCanHaveGoal("bank"), false);
  assert.equal(accountCanHaveGoal("cash"), false);
});

test("SIP account targets: liabilities are rejected", () => {
  assert.equal(accountCanHaveGoal("credit_card"), false);
  assert.equal(accountCanHaveGoal("loan"), false);
  assert.equal(accountCanHaveGoal("overdraft"), false);
  assert.equal(accountCanHaveGoal("home_loan_od"), false);
});

test("SIP account targets: investment-scheme accounts (including NPS) remain valid", () => {
  assert.equal(accountCanHaveGoal("investment"), true);
  assert.equal(accountCanHaveGoal("ppf"), true);
  assert.equal(accountCanHaveGoal("epf"), true);
  assert.equal(accountCanHaveGoal("ssy"), true);
  assert.equal(accountCanHaveGoal("nps"), true);
});

// ---------- resolveSipDateRange (Fix 4: resolved-pair validation on partial update) ----------

test("resolveSipDateRange: an untouched field keeps the stored value", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-12-31" }, {}),
    { startDate: "2026-01-01", endDate: "2026-12-31" },
  );
});

test("resolveSipDateRange: an update that only sends endDate resolves against the stored startDate", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-06-01", endDate: null }, { endDate: "2025-12-01" }),
    { startDate: "2026-06-01", endDate: "2025-12-01" },
  );
});

test("resolveSipDateRange: an explicit null endDate clears it (open-ended), distinct from 'not sent'", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-06-30" }, { endDate: null }),
    { startDate: "2026-01-01", endDate: null },
  );
});

test("an update that only changes endDate to before the stored startDate resolves to an invalid pair", () => {
  // Neither field is invalid in isolation — only the resolved pair is.
  const resolved = resolveSipDateRange({ startDate: "2026-06-01", endDate: null }, { endDate: "2025-12-01" });
  assert.equal(sipDateRangeValid(resolved.startDate, resolved.endDate), false);
});

test("an update that only changes startDate to after the stored endDate resolves to an invalid pair", () => {
  const resolved = resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-03-01" }, { startDate: "2026-06-01" });
  assert.equal(sipDateRangeValid(resolved.startDate, resolved.endDate), false);
});

// ---------- resolveSipFundingTarget (payroll+mf_folio resolved-pair validation on partial update) ----------

test("resolveSipFundingTarget: a patch that changes only fundingSource keeps the stored targetKind", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "mf_folio", fundingSource: "bank_debit" },
      { fundingSource: "payroll" },
    ),
    { targetKind: "mf_folio", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: a patch that changes only targetKind keeps the stored fundingSource", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "account", fundingSource: "payroll" },
      { targetKind: "mf_folio" },
    ),
    { targetKind: "mf_folio", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: a patch that changes both uses both new values", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "mf_folio", fundingSource: "bank_debit" },
      { targetKind: "account", fundingSource: "payroll" },
    ),
    { targetKind: "account", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: an empty patch keeps both stored values", () => {
  assert.deepEqual(
    resolveSipFundingTarget({ targetKind: "mf_folio", fundingSource: "bank_debit" }, {}),
    { targetKind: "mf_folio", fundingSource: "bank_debit" },
  );
});

// ---------- assertLinkRowsMatched (Fix 2: TOCTOU-safe conditional link) ----------

test("assertLinkRowsMatched: one matched row (the common case) does not throw", () => {
  assert.doesNotThrow(() => assertLinkRowsMatched(1));
});

test("assertLinkRowsMatched: zero matched rows means the conditional UPDATE lost a race — throws 409", () => {
  assert.throws(
    () => assertLinkRowsMatched(0),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
});

// ---------- isArchived (Fix 1: archived source/target must be rejected by SIP validation) ----------
// assertBankSource/assertAccountTargetType/ownedHoldingGoal are DB-backed (not
// unit-tested here, same as assertAccountTargetType's type gate above) but all
// three route their archived-rejection through this pure predicate.

test("isArchived: a null archivedAt is not archived", () => {
  assert.equal(isArchived(null), false);
});

test("isArchived: any non-null archivedAt (Date or ISO string) is archived", () => {
  assert.equal(isArchived(new Date("2026-01-01")), true);
  assert.equal(isArchived("2026-01-01T00:00:00.000Z"), true);
});

// ---------- laterInstallmentDate (merging holding_events + transactions installments) ----------

test("laterInstallmentDate: both null yields null", () => {
  assert.equal(laterInstallmentDate(null, null), null);
});

test("laterInstallmentDate: only the holding-event side set returns it", () => {
  assert.equal(laterInstallmentDate("2026-07-05", null), "2026-07-05");
});

test("laterInstallmentDate: only the transaction side set returns it", () => {
  assert.equal(laterInstallmentDate(null, "2026-07-05"), "2026-07-05");
});

test("laterInstallmentDate: both set returns the more recent (greater) date", () => {
  assert.equal(laterInstallmentDate("2026-06-05", "2026-07-05"), "2026-07-05");
  assert.equal(laterInstallmentDate("2026-07-05", "2026-06-05"), "2026-07-05");
});

// ---------- installmentDateError (recordSipInstallment: date must fall within the SIP's life) ----------

test("installmentDateError: a date before startDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: null }, "2025-12-31"),
    "Installment date is before the SIP started",
  );
});

test("installmentDateError: a date after endDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-07-01"),
    "Installment date is after the SIP ended",
  );
});

test("installmentDateError: a date inside the range is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-06-15"), null);
});

test("installmentDateError: a null endDate (open-ended) is valid for any date on/after start", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2030-01-01"), null);
});

test("installmentDateError: exactly on startDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2026-01-01"), null);
});

test("installmentDateError: exactly on endDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-06-30"), null);
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

// ---------- isUniqueViolation (Drizzle wraps driver errors — see lib/errors.ts pgError) ----------

test("isUniqueViolation: a wrapped 23505 with the matching constraint name is true", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "holding_events_sip_date_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), true);
});

test("isUniqueViolation: a wrapped 23505 with a different constraint name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "some_other_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), false);
});

test("isUniqueViolation: a wrapped 23503 (FK, not unique) with the matching name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23503", constraint: "holding_events_sip_date_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), false);
});

test("isUniqueViolation: a non-Postgres error is false", () => {
  assert.equal(isUniqueViolation(new Error("boom"), "holding_events_sip_date_idx"), false);
});

// ---------- isCheckViolation (Drizzle wraps driver errors — see lib/errors.ts pgError) ----------

test("isCheckViolation: a wrapped 23514 with the matching constraint name is true", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23514", constraint: "sips_payroll_requires_account_target" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), true);
});

test("isCheckViolation: a wrapped 23514 with a different constraint name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23514", constraint: "some_other_check" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), false);
});

test("isCheckViolation: a wrapped 23505 (unique, not check) with the matching name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "sips_payroll_requires_account_target" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), false);
});

test("isCheckViolation: a non-Postgres error is false", () => {
  assert.equal(isCheckViolation(new Error("boom"), "sips_payroll_requires_account_target"), false);
});

// ---------- dueInstallmentDate ----------

test("dueInstallmentDate: null for a paused SIP", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "paused" as const,
    targetKind: "mf_folio" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), null);
});

test("dueInstallmentDate: null for an account-target SIP", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    targetKind: "account" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), null);
});

test("dueInstallmentDate: the due date when lastInstallmentDate is null", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    targetKind: "mf_folio" as const,
  };
  assert.equal(dueInstallmentDate(sip, null, "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: null when lastInstallmentDate equals the due date", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    targetKind: "mf_folio" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-05", "2026-07-23"), null);
});

test("dueInstallmentDate: the due date when lastInstallmentDate is older than it", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    targetKind: "mf_folio" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-06-05", "2026-07-23"), "2026-07-05");
});

test("dueInstallmentDate: null when lastInstallmentDate is somehow newer than the due date", () => {
  const sip = {
    dayOfMonth: 5,
    startDate: "2026-01-01",
    endDate: null,
    status: "active" as const,
    targetKind: "mf_folio" as const,
  };
  assert.equal(dueInstallmentDate(sip, "2026-07-06", "2026-07-23"), null);
});
