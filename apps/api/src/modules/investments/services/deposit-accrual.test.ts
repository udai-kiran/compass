/**
 * deposit-accrual.ts — pure schedule computation tests.
 *
 * All values are hand-computed independently from the implementation's formula
 * and cross-checked. Amounts in paise; rates in basis points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccrualSchedule, addMonths } from "./deposit-accrual.ts";
import type { DepositTerms } from "./deposit-accrual.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function totalPayouts(schedule: ReturnType<typeof computeAccrualSchedule>): number {
  return schedule.periods.reduce((s, p) => s + p.payoutPaise, 0);
}

// ── FD: quarterly compounding, reinvest ──────────────────────────────────────

test("FD 1-year at 710 bps quarterly compounding (reinvest): correct maturity value", () => {
  // Principal ₹10,00,000 = 100,000,000 paise; rate 7.10 % quarterly compounding.
  // Quarterly rate = 710 / (10000 * 4) = 0.01775
  // Expected hand-trace (each period rounded independently):
  //   Q1: 100,000,000 * 0.01775 = 1,775,000 → closing 101,775,000
  //   Q2: 101,775,000 * 0.01775 = 1,806,506.25 → round = 1,806,506 → closing 103,581,506
  //   Q3: 103,581,506 * 0.01775 = 1,838,571.98 → round = 1,838,572 → closing 105,420,078
  //   Q4: round(105,420,078 * 710 / 40000) = round(1,871,206.38) = 1,871,206 → closing 107,291,284
  // Total interest = 7,291,284; maturity = 107,291,284.
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 100_000_000,
    annualRateBps: 710,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);

  assert.equal(schedule.periods.length, 4, "must have exactly 4 quarterly periods");
  assert.equal(schedule.totalDepositPaise, 100_000_000);

  // Check each period exactly.
  // All computed via Math.round(balance * 710 / 40000) — integer arithmetic.
  assert.equal(schedule.periods[0]!.interestPaise, 1_775_000);
  assert.equal(schedule.periods[0]!.closingPaise, 101_775_000);

  assert.equal(schedule.periods[1]!.interestPaise, 1_806_506);
  assert.equal(schedule.periods[1]!.closingPaise, 103_581_506);

  assert.equal(schedule.periods[2]!.interestPaise, 1_838_572);
  assert.equal(schedule.periods[2]!.closingPaise, 105_420_078);

  // Q4: round(105,420,078 * 710 / 40,000) = round(1,871,206.3845) = 1,871,206
  assert.equal(schedule.periods[3]!.interestPaise, 1_871_206);
  assert.equal(schedule.periods[3]!.closingPaise, 107_291_284);

  assert.equal(schedule.totalInterestPaise, 7_291_284);
  assert.equal(schedule.maturityValuePaise, 107_291_284);

  // Reinvest mode: no payouts.
  assert.equal(totalPayouts(schedule), 0);
});

// ── FD: monthly payout ───────────────────────────────────────────────────────

test("FD monthly payout: interest paid out each month, principal unchanged at maturity", () => {
  // Principal 10,000,000 paise (₹1 lakh); rate 720 bps monthly payout.
  // Monthly rate = 720 / (10000 * 12) = 0.006
  // Each month: interest = round(10,000,000 * 0.006) = 60,000; payout = 60,000; closing = 10,000,000.
  // 6 months → total interest = 360,000; maturity value = 10,000,000.
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 10_000_000,
    annualRateBps: 720,
    compoundingFrequency: "monthly",
    interestDisposition: "payout",
    startDate: "2024-01-01",
    maturityDate: "2024-07-01",
  };

  const schedule = computeAccrualSchedule(terms);

  assert.equal(schedule.periods.length, 6, "must have 6 monthly periods");
  assert.equal(schedule.totalDepositPaise, 10_000_000);

  // Every period: interest = payout = 60,000; closing = principal (10M).
  for (const period of schedule.periods) {
    assert.equal(period.interestPaise, 60_000);
    assert.equal(period.payoutPaise, 60_000);
    assert.equal(period.closingPaise, 10_000_000);
  }

  assert.equal(schedule.totalInterestPaise, 360_000);
  assert.equal(schedule.maturityValuePaise, 10_000_000, "principal unchanged in payout mode");
  assert.equal(totalPayouts(schedule), 360_000);
});

// ── FD: half-yearly compounding ──────────────────────────────────────────────

test("FD half-yearly 2-year at 800 bps (reinvest): 4 periods, correct maturity", () => {
  // Principal 50,000,000 paise; rate 800 bps; half-yearly → 2 periods/year → 4 total.
  // Half-yearly rate = 800 / (10000 * 2) = 0.04
  // P1: round(50,000,000 * 0.04) = 2,000,000 → closing = 52,000,000
  // P2: round(52,000,000 * 0.04) = 2,080,000 → closing = 54,080,000
  // P3: round(54,080,000 * 0.04) = 2,163,200 → closing = 56,243,200
  // P4: round(56,243,200 * 0.04) = 2,249,728 → closing = 58,492,928
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 50_000_000,
    annualRateBps: 800,
    compoundingFrequency: "half_yearly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2026-01-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 4);
  assert.equal(schedule.maturityValuePaise, 58_492_928);
  assert.equal(schedule.totalInterestPaise, 8_492_928);
});

// ── RD: 12-month quarterly compounding ───────────────────────────────────────
//
// Per-installment date-based accrual model (Actual/365 Fixed from each deposit date).
// Installment dates anchored at addMonths("2024-01-01", k) for k=0..11.
// 2024 is a leap year (Feb has 29 days).
//
// Per-period formula:
//   rawInterest = opening*bps/(10000*4) + sum_over_installments(inst*bps*days/(10000*365))
//   interestPaise = Math.round(rawInterest)
//
// Q1 [2024-01-01, 2024-04-01): opening=0, installments Jan1, Feb1, Mar1
//   days: Jan1→Apr1=91, Feb1→Apr1=60, Mar1→Apr1=31
//   raw = 0 + 1M*700*(91+60+31)/3650000 = 1M*700*182/3650000 = 34904.109...
//   → 34904; deposit=3M; closing=3,034,904
//
// Q2 [2024-04-01, 2024-07-01): opening=3,034,904, installments Apr1, May1, Jun1
//   opening raw = 3034904*700/40000 = 53110.82
//   days: Apr1→Jul1=91, May1→Jul1=61, Jun1→Jul1=30
//   installment raw = 1M*700*(91+61+30)/3650000 = 1M*700*182/3650000 = 34904.109...
//   total raw = 53110.82+34904.109=88014.929... → 88015; deposit=3M; closing=6,122,919
//
// Q3 [2024-07-01, 2024-10-01): opening=6,122,919, installments Jul1, Aug1, Sep1
//   opening raw = 6122919*700/40000 = 107151.0825
//   days: Jul1→Oct1=92, Aug1→Oct1=61, Sep1→Oct1=30
//   installment raw = 1M*700*183/3650000 = 35095.890...
//   total raw = 107151.082+35095.890=142246.972... → 142247; deposit=3M; closing=9,265,166
//
// Q4 [2024-10-01, 2025-01-01): opening=9,265,166, installments Oct1, Nov1, Dec1
//   opening raw = 9265166*700/40000 = 162140.405
//   days: Oct1→Jan1=92, Nov1→Jan1=61, Dec1→Jan1=31
//   installment raw = 1M*700*184/3650000 = 35287.671...
//   total raw = 162140.405+35287.671=197428.076... → 197428; deposit=3M; closing=12,462,594

test("RD 12-month at 700 bps quarterly compounding: correct maturity value (per-installment date-based)", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 1_000_000,
    totalInstallments: 12,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);

  assert.equal(schedule.periods.length, 4, "must have 4 quarterly periods");
  assert.equal(schedule.totalDepositPaise, 12_000_000);

  assert.equal(schedule.periods[0]!.depositPaise, 3_000_000);
  assert.equal(schedule.periods[0]!.interestPaise, 34_904);
  assert.equal(schedule.periods[0]!.closingPaise, 3_034_904);

  assert.equal(schedule.periods[1]!.depositPaise, 3_000_000);
  assert.equal(schedule.periods[1]!.interestPaise, 88_015);
  assert.equal(schedule.periods[1]!.closingPaise, 6_122_919);

  assert.equal(schedule.periods[2]!.depositPaise, 3_000_000);
  assert.equal(schedule.periods[2]!.interestPaise, 142_247);
  assert.equal(schedule.periods[2]!.closingPaise, 9_265_166);

  assert.equal(schedule.periods[3]!.depositPaise, 3_000_000);
  assert.equal(schedule.periods[3]!.interestPaise, 197_428);
  assert.equal(schedule.periods[3]!.closingPaise, 12_462_594);

  assert.equal(
    schedule.totalInterestPaise,
    34_904 + 88_015 + 142_247 + 197_428,
    "total interest = sum of period interests",
  );
  assert.equal(schedule.maturityValuePaise, 12_462_594);
});

// ── NSC: 5-year annual reinvest ───────────────────────────────────────────────

test("NSC 5-year annual reinvest at 765 bps: correct taxable interest per year and maturity", () => {
  // Principal 1,000,000 paise (₹10,000); rate 765 bps; annual compounding; reinvest.
  // Annual rate as decimal = 765/10000 = 0.0765
  //
  // Y1: interest = round(1,000,000 * 0.0765) = 76,500  → closing = 1,076,500
  // Y2: interest = round(1,076,500 * 0.0765) = round(82,352.25)  = 82,352 → closing = 1,158,852
  // Y3: interest = round(1,158,852 * 0.0765) = round(88,652.178) = 88,652 → closing = 1,247,504
  // Y4: interest = round(1,247,504 * 0.0765) = round(95,434.056) = 95,434 → closing = 1,342,938
  // Y5: interest = round(1,342,938 * 0.0765) = round(102,734.757) = 102,735 → closing = 1,445,673
  const terms: DepositTerms = {
    depositKind: "nsc",
    principalPaise: 1_000_000,
    annualRateBps: 765,
    compoundingFrequency: "annually",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2029-01-01",
  };

  const schedule = computeAccrualSchedule(terms);

  assert.equal(schedule.periods.length, 5, "NSC must have exactly 5 annual periods");
  assert.equal(schedule.totalDepositPaise, 1_000_000);

  const expectedInterests = [76_500, 82_352, 88_652, 95_434, 102_735];
  const expectedClosings = [1_076_500, 1_158_852, 1_247_504, 1_342_938, 1_445_673];

  schedule.periods.forEach((period, i) => {
    assert.equal(
      period.interestPaise,
      expectedInterests[i],
      `Year ${i + 1}: interest should be ${expectedInterests[i]}`,
    );
    assert.equal(
      period.closingPaise,
      expectedClosings[i],
      `Year ${i + 1}: closing should be ${expectedClosings[i]}`,
    );
    // NSC interest is taxable in the holder's hands each year (even though
    // not received until maturity). taxableInterestPaise must equal interestPaise.
    assert.equal(
      period.taxableInterestPaise,
      period.interestPaise,
      `Year ${i + 1}: taxableInterestPaise must equal interestPaise`,
    );
    // Reinvest mode: nothing paid out.
    assert.equal(period.payoutPaise, 0, `Year ${i + 1}: payoutPaise must be 0`);
  });

  assert.equal(schedule.maturityValuePaise, 1_445_673);
  assert.equal(schedule.totalInterestPaise, 76_500 + 82_352 + 88_652 + 95_434 + 102_735);
});

// ── Tax-saver FD: treated as regular FD ──────────────────────────────────────

test("Tax-saver FD uses identical compound-interest math as a regular FD", () => {
  // Validate that tax_saver_fd produces the same schedule as fd with the same terms.
  const commonTerms = {
    principalPaise: 50_000_000,
    annualRateBps: 650,
    compoundingFrequency: "quarterly" as const,
    interestDisposition: "reinvest" as const,
    startDate: "2024-01-01",
    maturityDate: "2029-01-01", // 5-year lock-in
  };

  const fdSchedule = computeAccrualSchedule({ ...commonTerms, depositKind: "fd" });
  const tsfdSchedule = computeAccrualSchedule({ ...commonTerms, depositKind: "tax_saver_fd" });

  assert.equal(fdSchedule.periods.length, tsfdSchedule.periods.length);
  assert.equal(fdSchedule.maturityValuePaise, tsfdSchedule.maturityValuePaise);
  assert.equal(fdSchedule.totalInterestPaise, tsfdSchedule.totalInterestPaise);

  fdSchedule.periods.forEach((p, i) => {
    assert.equal(p.interestPaise, tsfdSchedule.periods[i]!.interestPaise);
    assert.equal(p.closingPaise, tsfdSchedule.periods[i]!.closingPaise);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("zero-rate FD: no interest earned, maturity value equals principal", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 10_000_000,
    annualRateBps: 0,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);

  assert.equal(schedule.totalInterestPaise, 0);
  assert.equal(schedule.maturityValuePaise, 10_000_000);
  for (const period of schedule.periods) {
    assert.equal(period.interestPaise, 0);
  }
});

test("one-paise FD: schedule does not throw and returns non-negative interest", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 1,
    annualRateBps: 710,
    compoundingFrequency: "annually",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);
  // 1 paise * 0.071 = 0.071 → rounds to 0 paise interest.
  assert.ok(schedule.totalInterestPaise >= 0);
  assert.ok(schedule.maturityValuePaise >= 1);
});

test("large safe-integer amount: paise arithmetic stays within safe integer bounds", () => {
  // 9,007,199,254 paise ≈ ₹9 crore — comfortably within Number.MAX_SAFE_INTEGER.
  // After 1 year at 10 % quarterly: closing ≈ 9.9 × 10^9, still safe.
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 9_007_199_254,
    annualRateBps: 1000,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.ok(Number.isSafeInteger(schedule.maturityValuePaise));
  assert.ok(schedule.maturityValuePaise > 9_007_199_254);
});

test("leap-year FD: Feb 28 + 1 month → Mar 28, no crash", () => {
  // Starts on Jan 28 in a leap year, monthly compounding, 3 months.
  // Feb 28 in 2024 is valid (2024 is a leap year — Feb has 29 days).
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 5_000_000,
    annualRateBps: 720,
    compoundingFrequency: "monthly",
    interestDisposition: "reinvest",
    startDate: "2024-01-28",
    maturityDate: "2024-04-28",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 3);
  // Anchored boundaries: addMonths("2024-01-28", n) for n=1,2,3
  // n=1: min(28, 29)=28 → Feb 28
  // n=2: min(28, 31)=28 → Mar 28
  // n=3: min(28, 30)=28 → Apr 28 = maturity
  assert.equal(schedule.periods[0]!.periodEnd, "2024-02-28");
  assert.equal(schedule.periods[1]!.periodEnd, "2024-03-28");
  assert.equal(schedule.periods[2]!.periodEnd, "2024-04-28");
  assert.ok(schedule.maturityValuePaise > 5_000_000);
});

test("end-of-month FD: Jan 31 anchored boundaries avoid drift", () => {
  // Jan 31 anchored monthly:
  //   n=0: "2025-01-31"
  //   n=1: addMonths("2025-01-31", 1) = "2025-02-28" (non-leap)
  //   n=2: addMonths("2025-01-31", 2) = "2025-03-31"
  //   n=3: addMonths("2025-01-31", 3) = "2025-04-30" = maturity
  // 3 full periods (no spurious stub).
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 1_000_000,
    annualRateBps: 700,
    compoundingFrequency: "monthly",
    interestDisposition: "reinvest",
    startDate: "2025-01-31",
    maturityDate: "2025-04-30",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods[0]!.periodEnd, "2025-02-28");
  assert.equal(
    schedule.periods.length,
    3,
    "anchored EOM boundaries must produce EXACTLY 3 periods (not 4)",
  );
  assert.ok(schedule.maturityValuePaise > 1_000_000);
});

test("stub final period uses Actual/365 Fixed day-count", () => {
  // FD that doesn't end on a quarter boundary: maturity 2 months after start.
  // Quarterly compounding means the first full period is 3 months, so the
  // entire 2-month term is a single stub period.
  // Stub interest = round(P * annualRateBps * days / (10000 * 365))
  // days from Jan 1 to Mar 1 = 59 days (non-leap year 2025).
  // = round(10,000,000 * 700 * 59 / (10000 * 365))
  // = round(10,000,000 * 700 * 59 / 3,650,000)
  // = round(113,150.68…) = 113,151
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 10_000_000,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2025-01-01",
    maturityDate: "2025-03-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 1, "single stub period");
  // 2025-01-01 to 2025-03-01: Jan=31 days, Feb=28 days → 59 days.
  assert.equal(schedule.periods[0]!.interestPaise, 113_151);
});

// ── RD: fewer than one full period of installments ───────────────────────────
//
// 3 installments × 500,000 paise at 700 bps quarterly, 2024-01-01 to 2024-04-01.
// 2024 is a leap year (Feb has 29 days).
// Opening=0. Installments Jan1, Feb1, Mar1.
// days: Jan1→Apr1=91, Feb1→Apr1=60, Mar1→Apr1=31
// raw = 500000*700*(91+60+31)/3650000 = 500000*700*182/3650000 = 17452.054...
// Math.round = 17452; deposit=1,500,000; closing=1,517,452.

test("RD with fewer than one full period of installments", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 500_000,
    totalInstallments: 3,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 1);
  assert.equal(schedule.totalDepositPaise, 1_500_000);
  // Per-date accrual: round(500000*700*182/3650000) = round(17452.054...) = 17452
  assert.equal(schedule.periods[0]!.interestPaise, 17_452);
  assert.equal(schedule.periods[0]!.closingPaise, 1_517_452);
});

// ── Regression: RD Q1 installment-date accrual (3×₹10,000 @ 700bps) ─────────
//
// Exact per-spec computation. ₹10,000 = 1,000,000 paise.
// 3 installments × 1,000,000 paise at 700 bps quarterly, Jan1–Apr1.
// Deposit dates: Jan1, Feb1, Mar1 (2024, leap year).
// daysDiff: 91, 60, 31.
// raw = 1M*700*(91+60+31)/3650000 = 1M*700*182/3650000
//     = 127,400,000/3,650,000 = 34,904.109...
// Math.round = 34,904 (not 52,500 from the old front-loaded shortcut).

test("RD Q1 installment-date accrual: 3×1,000,000 paise @700bps = 34,904 paise interest", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 1_000_000,
    totalInstallments: 3,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 1);
  assert.equal(schedule.periods[0]!.depositPaise, 3_000_000);
  // Exact per-spec: round(1M*700*182/3650000) = round(34904.109...) = 34904
  assert.equal(schedule.periods[0]!.interestPaise, 34_904);
  assert.equal(schedule.periods[0]!.closingPaise, 3_034_904);
  assert.equal(schedule.maturityValuePaise, 3_034_904);
});

// ── Regression: maturity beyond final installment ────────────────────────────
//
// 3 installments, quarterly compounding, maturity 2 quarters after start.
// All installments fall in Q1; Q2 has no new deposits but opening balance
// continues to accrue at the nominal quarterly rate.
//
// Q1 [2024-01-01, 2024-04-01): deposit=3M, interest=34904, closing=3,034,904
// Q2 [2024-04-01, 2024-07-01): deposit=0, opening=3,034,904
//   raw = 3034904*700/40000 = 53110.82 → round = 53111; closing=3,088,015

test("RD: maturity beyond final installment continues to accrue stub interest", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 1_000_000,
    totalInstallments: 3,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-07-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 2, "must have Q1 + Q2 (post-installment)");

  // Q1: installments deposited, interest per-date accrual
  assert.equal(schedule.periods[0]!.depositPaise, 3_000_000);
  assert.equal(schedule.periods[0]!.interestPaise, 34_904);
  assert.equal(schedule.periods[0]!.closingPaise, 3_034_904);

  // Q2: no new deposits, opening balance earns nominal quarterly rate
  assert.equal(schedule.periods[1]!.depositPaise, 0);
  // raw = 3034904 * 700 / 40000 = 53110.82 → round = 53111
  assert.equal(schedule.periods[1]!.interestPaise, 53_111);
  assert.equal(schedule.periods[1]!.closingPaise, 3_088_015);

  assert.equal(schedule.maturityValuePaise, 3_088_015);
  assert.ok(schedule.maturityValuePaise > 3_034_904, "post-installment balance still grows");

  // ── RD: stub final period with pro-rated opening interest ──────────────────
  //
  // 3 installments, quarterly compounding, but maturity NOT on a quarter boundary.
  // All installments in Q1; stub final period from Q1 end to maturity.
  // Q1 [2024-01-01, 2024-04-01): deposit=3M, interest per-date accrual
  // Stub [2024-04-01, 2024-04-15): 14 days, opening=3,034,904
  //   opening interest (pro-rated Actual/365F):
  //   raw = 3034904 * 700 * 14 / (10000 * 365) = 29742059200 / 3650000 = 8148.509... → 8149
  //   closing = 3034904 + 0 + 8149 = 3,043,053

  test("RD: stub final period uses pro-rated opening balance (Actual/365 Fixed)", () => {
    const terms: DepositTerms = {
      depositKind: "rd",
      installmentPaise: 1_000_000,
      totalInstallments: 3,
      annualRateBps: 700,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2024-04-15", // stub: not on quarter boundary
    };

    const schedule = computeAccrualSchedule(terms);
    assert.equal(schedule.periods.length, 2, "must have Q1 (full) + stub (14 days)");

    // Q1: full quarterly period with per-installment accrual
    assert.equal(schedule.periods[0]!.depositPaise, 3_000_000);
    assert.equal(schedule.periods[0]!.interestPaise, 34_904);
    assert.equal(schedule.periods[0]!.closingPaise, 3_034_904);
    assert.equal(schedule.periods[0]!.periodEnd, "2024-04-01");

    // Stub: 14 days from 2024-04-01 to 2024-04-15, opening balance pro-rated
    // Opening interest = round((3034904 * 700 * 14) / (10000 * 365))
    //   = round(29742059200 / 3650000)
    //   = round(8148.509...) = 8149
    assert.equal(schedule.periods[1]!.depositPaise, 0, "no new deposits in stub");
    assert.equal(schedule.periods[1]!.periodStart, "2024-04-01");
    assert.equal(schedule.periods[1]!.periodEnd, "2024-04-15");
    assert.equal(schedule.periods[1]!.interestPaise, 8_149);
    assert.equal(schedule.periods[1]!.closingPaise, 3_043_053);

    assert.equal(schedule.maturityValuePaise, 3_043_053);
    assert.equal(schedule.totalInterestPaise, 34_904 + 8_149);
  });
});

// ── Property: deterministic generated coverage (seeded LCG, no Math.random) ──
//
// A seeded LCG generates a reproducible matrix of DepositTerms covering all
// kinds, rates, frequencies, dispositions, and start dates. Each generated
// case is verified for: balance identity, period continuity, totals
// reconciliation, maturityValue = last closing, non-negativity, and safe-integer
// post-conditions. The suite also includes required explicit cases (payout-mode
// RD and EOM Jan-31 monthly FD) to ensure they are always exercised.

test("property: deterministic LCG-generated coverage over kind/rate/frequency/disposition matrix", () => {
  // Seeded LCG (Numerical Recipes parameters): m=2^32, a=1664525, c=1013904223.
  let lcgState = 0xdead_beef;
  function lcgNext(): number {
    lcgState = (1664525 * lcgState + 1013904223) >>> 0;
    return lcgState;
  }
  function pick<T>(arr: readonly T[]): T {
    return arr[lcgNext() % arr.length]!;
  }

  const FD_FREQS = ["monthly", "quarterly", "half_yearly", "annually"] as const;
  const DISPOSITIONS = ["reinvest", "payout"] as const;
  const BPS = [0, 100, 500, 710, 1000, 1500, 2500] as const;
  const PRINCIPALS = [1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000] as const;
  const INSTALLMENTS = [100_000, 500_000, 1_000_000, 5_000_000] as const;
  const TOTAL_INST = [3, 6, 12, 24, 36] as const;
  const START_DATES = ["2024-01-01", "2024-03-15", "2023-07-01", "2022-04-01"] as const;
  const YEARS = [1, 2, 3, 5] as const;

  const cases: DepositTerms[] = [];

  // 25 LCG-generated cases across all kinds
  for (let i = 0; i < 25; i++) {
    const kindSelector = lcgNext() % 4;
    const startDate = pick(START_DATES);
    const bps = pick(BPS);
    const disposition = pick(DISPOSITIONS);

    if (kindSelector === 0) {
      // NSC: 5-year, annual compounding, reinvest
      cases.push({
        depositKind: "nsc",
        principalPaise: pick(PRINCIPALS),
        annualRateBps: bps,
        compoundingFrequency: "annually",
        interestDisposition: "reinvest",
        startDate,
        maturityDate: addMonths(startDate, 60),
      });
    } else if (kindSelector === 1) {
      // RD: quarterly (enforced by convention)
      cases.push({
        depositKind: "rd",
        installmentPaise: pick(INSTALLMENTS),
        totalInstallments: pick(TOTAL_INST),
        annualRateBps: bps,
        compoundingFrequency: "quarterly",
        interestDisposition: disposition,
        startDate,
        maturityDate: addMonths(startDate, pick(YEARS) * 12),
      });
    } else if (kindSelector === 2) {
      // tax_saver_fd: 5-year
      cases.push({
        depositKind: "tax_saver_fd",
        principalPaise: pick(PRINCIPALS),
        annualRateBps: bps,
        compoundingFrequency: pick(FD_FREQS),
        interestDisposition: disposition,
        startDate,
        maturityDate: addMonths(startDate, 60),
      });
    } else {
      // fd: any term
      cases.push({
        depositKind: "fd",
        principalPaise: pick(PRINCIPALS),
        annualRateBps: bps,
        compoundingFrequency: pick(FD_FREQS),
        interestDisposition: disposition,
        startDate,
        maturityDate: addMonths(startDate, pick(YEARS) * 12),
      });
    }
  }

  // Required explicit case: payout-mode RD (must be directly exercised)
  cases.push({
    depositKind: "rd",
    installmentPaise: 1_000_000,
    totalInstallments: 12,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "payout",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  });

  // Required explicit case: EOM Jan-31 monthly FD (exactly 3 periods)
  const eomTerms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 1_000_000,
    annualRateBps: 700,
    compoundingFrequency: "monthly",
    interestDisposition: "reinvest",
    startDate: "2025-01-31",
    maturityDate: "2025-04-30",
  };
  cases.push(eomTerms);

  for (const terms of cases) {
    const schedule = computeAccrualSchedule(terms);
    const label = `${terms.depositKind}/${terms.compoundingFrequency}/${terms.interestDisposition}/${terms.startDate}`;

    // 1. Balance identity: closing = opening + deposit + interest - payout
    for (const p of schedule.periods) {
      assert.equal(
        p.closingPaise,
        p.openingPaise + p.depositPaise + p.interestPaise - p.payoutPaise,
        `balance identity for ${label}`,
      );
    }

    // 2. Period continuity: opening[n+1] = closing[n]
    for (let i = 1; i < schedule.periods.length; i++) {
      assert.equal(
        schedule.periods[i]!.openingPaise,
        schedule.periods[i - 1]!.closingPaise,
        `period continuity at period ${i} for ${label}`,
      );
    }

    // 3. Totals reconcile with period sums
    const sumInterest = schedule.periods.reduce((s, p) => s + p.interestPaise, 0);
    assert.equal(
      schedule.totalInterestPaise,
      sumInterest,
      `total interest reconciliation for ${label}`,
    );

    const sumDeposit = schedule.periods.reduce((s, p) => s + p.depositPaise, 0);
    assert.equal(
      schedule.totalDepositPaise,
      sumDeposit,
      `total deposit reconciliation for ${label}`,
    );

    // 4. maturityValue = last period's closing
    const last = schedule.periods[schedule.periods.length - 1]!;
    assert.equal(
      schedule.maturityValuePaise,
      last.closingPaise,
      `maturity = last closing for ${label}`,
    );

    // 5. Non-negative values and safe integers for all period fields
    for (const p of schedule.periods) {
      assert.ok(p.interestPaise >= 0, `non-negative interest for ${label}`);
      assert.ok(p.depositPaise >= 0, `non-negative deposit for ${label}`);
      assert.ok(p.closingPaise >= 0, `non-negative closing for ${label}`);
      assert.ok(Number.isSafeInteger(p.openingPaise), `safe integer openingPaise for ${label}`);
      assert.ok(Number.isSafeInteger(p.depositPaise), `safe integer depositPaise for ${label}`);
      assert.ok(Number.isSafeInteger(p.interestPaise), `safe integer interestPaise for ${label}`);
      assert.ok(Number.isSafeInteger(p.payoutPaise), `safe integer payoutPaise for ${label}`);
      assert.ok(Number.isSafeInteger(p.closingPaise), `safe integer closingPaise for ${label}`);
      assert.ok(
        Number.isSafeInteger(p.taxableInterestPaise),
        `safe integer taxableInterestPaise for ${label}`,
      );
    }
  }

  // EOM Jan-31 specific assertion: must produce EXACTLY 3 periods (not 4)
  const eomSchedule = computeAccrualSchedule(eomTerms);
  assert.equal(
    eomSchedule.periods.length,
    3,
    "EOM Jan-31 monthly FD (Jan31→Apr30) must have exactly 3 periods: [Jan31,Feb28), [Feb28,Mar31), [Mar31,Apr30)",
  );
});

// ── Half-up rounding boundary cases ─────────────────────────────────────────
//
// Tests that Math.round (half-up for positive values) is applied correctly.
// For quarterly compounding, interest = Math.round(balance * bps / 40000).
// balance=8000, bps=500: 8000*500/40000 = 100.0 → 100 (no rounding)
// balance=8040, bps=500: 8040*500/40000 = 100.5 → 101 (half-up rounds UP)
// balance=8039, bps=500: 8039*500/40000 = 100.4875 → 100 (rounds DOWN)

test("half-up rounding: exact .0 → no rounding", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 8_000,
    annualRateBps: 500,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };
  const schedule = computeAccrualSchedule(terms);
  // 8000 * 500 / 40000 = 100.0 exactly
  assert.equal(schedule.periods[0]!.interestPaise, 100);
});

test("half-up rounding: .5 fractional rounds UP", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 8_040,
    annualRateBps: 500,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };
  const schedule = computeAccrualSchedule(terms);
  // 8040 * 500 / 40000 = 100.5 → Math.round = 101
  assert.equal(schedule.periods[0]!.interestPaise, 101);
});

test("half-up rounding: below .5 rounds DOWN", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 8_039,
    annualRateBps: 500,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };
  const schedule = computeAccrualSchedule(terms);
  // 8039 * 500 / 40000 = 100.4875 → Math.round = 100
  assert.equal(schedule.periods[0]!.interestPaise, 100);
});

test("schedule fields form a coherent balance sheet: closing = opening + deposit + interest - payout", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: 20_000_000,
    annualRateBps: 750,
    compoundingFrequency: "quarterly",
    interestDisposition: "payout",
    startDate: "2024-03-15",
    maturityDate: "2025-03-15",
  };

  const schedule = computeAccrualSchedule(terms);
  for (const p of schedule.periods) {
    assert.equal(
      p.closingPaise,
      p.openingPaise + p.depositPaise + p.interestPaise - p.payoutPaise,
      "closing balance identity must hold for every period",
    );
  }
  // Each period's closing should be the next period's opening.
  for (let i = 1; i < schedule.periods.length; i++) {
    assert.equal(schedule.periods[i]!.openingPaise, schedule.periods[i - 1]!.closingPaise);
  }
});

// ── R4 regression: M-NEW1 exact rational result at large safe-integer input ──
//
// Demonstrates that BigInt arithmetic produces the correct half-up result where
// float multiplication loses precision. Inputs are valid safe integers but their
// product (installment × bps × days) exceeds 2^53, causing float to round wrong.
//
// Exact-rational oracle (all BigInt):
//   installmentPaise = 955_173_831_910_025n
//   bps = 1184n, 2024-01-01 (leap year): days [Jan1→Apr1=91, Feb1→Apr1=60, Mar1→Apr1=31]
//   periodsPerYear = 4n (quarterly)
//   common_den = 10000n × 4n × 365n = 14_600_000n
//   Opening = 0, so only installment contributions:
//     sum_num = 955173831910025n × 1184n × (91n+60n+31n) × 4n
//             = 955173831910025n × 1184n × 728n
//             = 823_313_994_762_509_868_800n
//   q = 823313994762509868800n / 14600000n = 56_391_369_504_281n
//   r = 823313994762509868800n % 14600000n = 7_268_800n
//   r × 2n = 14_537_600n  <  14_600_000n  →  rounds DOWN  →  56_391_369_504_281
//
// The float implementation returns 56_391_369_504_282 (one paise too high) because
// intermediate products exceed 2^53 and the accumulated sum is rounded before division.

test("R4 regression (M-NEW1): RD Q1 with large installment rounds to exact paise 56_391_369_504_281", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 955_173_831_910_025,
    totalInstallments: 3,
    annualRateBps: 1184,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 1, "single Q1 period");
  assert.equal(schedule.periods[0]!.depositPaise, 3 * 955_173_831_910_025);
  // Exact-rational result: 56_391_369_504_281 (rounds DOWN because r×2 < den)
  // Float gives 56_391_369_504_282 (rounds UP due to precision loss in multiplication).
  assert.equal(
    schedule.periods[0]!.interestPaise,
    56_391_369_504_281,
    "exact BigInt half-up must yield 56_391_369_504_281, not 56_391_369_504_282",
  );
});

// ── RD payout mode direct regression ────────────────────────────────────────
//
// Verifies that payout-mode RD correctly disburses interest and does NOT add it
// to the closing balance. The closing balance in payout mode equals:
//   opening + deposit (no interest reinvested).

test("RD payout mode: interest disbursed each period, closing = opening + deposit only", () => {
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise: 1_000_000,
    totalInstallments: 12,
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "payout",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };

  const schedule = computeAccrualSchedule(terms);
  assert.equal(schedule.periods.length, 4, "4 quarterly periods");

  for (const p of schedule.periods) {
    // Balance identity holds in all modes.
    assert.equal(
      p.closingPaise,
      p.openingPaise + p.depositPaise + p.interestPaise - p.payoutPaise,
      "balance identity",
    );
    // In payout mode every paise of interest is immediately disbursed.
    assert.equal(p.payoutPaise, p.interestPaise, "payout equals interest in payout mode");
    // So closing = opening + deposit (interest does not compound).
    assert.equal(
      p.closingPaise,
      p.openingPaise + p.depositPaise,
      "closing = opening + deposit (payout mode: no compounding)",
    );
    assert.ok(p.interestPaise >= 0, "non-negative interest");
    assert.ok(Number.isSafeInteger(p.closingPaise), "safe integer closing");
  }

  // Total payouts == total interest (all interest paid out, none compounded).
  assert.equal(
    totalPayouts(schedule),
    schedule.totalInterestPaise,
    "total payouts must equal total interest in payout mode",
  );
});

// ── R5 regressions: BigInt balance arithmetic ──────────────────────────────

test("R5 regression (M-NEW3): RD payout Q1 preserves the exact large closing balance", () => {
  const installmentPaise = 3_000_000_000_000_001;
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise,
    totalInstallments: 3,
    annualRateBps: 1184,
    compoundingFrequency: "quarterly",
    interestDisposition: "payout",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };

  const schedule = computeAccrualSchedule(terms);
  const q1 = schedule.periods[0]!;

  // BigInt derivation (Q1 installment day counts: 91 + 60 + 31 = 182):
  // numerator = 2_585_856_000_000_000_861_952; denominator = 14_600_000;
  // q = 177_113_424_657_534 and r = 4_461_952, so 2r < denominator and
  // interest = 177_113_424_657_534. Payout mode returns all of that interest.
  const numerator = BigInt(installmentPaise) * 1184n * (91n + 60n + 31n) * 4n;
  const denominator = 10000n * 4n * 365n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const expectedInterest = Number(remainder * 2n >= denominator ? quotient + 1n : quotient);
  const expectedClosing = Number(BigInt(installmentPaise) * 3n);

  assert.equal(
    q1.interestPaise,
    expectedInterest,
    "Q1 interest follows the exact BigInt derivation",
  );
  assert.equal(q1.payoutPaise, q1.interestPaise, "payout mode disburses all Q1 interest");
  assert.equal(q1.closingPaise, expectedClosing);
  assert.equal(q1.closingPaise, 9_000_000_000_000_003);
});

test("R5 regression: high-value RD reinvest Q1 preserves its exact BigInt closing balance", () => {
  const installmentPaise = 2_900_000_000_000_001;
  const terms: DepositTerms = {
    depositKind: "rd",
    installmentPaise,
    totalInstallments: 3,
    annualRateBps: 1184,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2024-04-01",
  };

  const schedule = computeAccrualSchedule(terms);
  const q1 = schedule.periods[0]!;

  // BigInt derivation: base = 8_700_000_000_000_003; numerator =
  // 2_499_660_800_000_000_861_952; denominator = 14_600_000; q =
  // 171_209_643_835_616 and r = 7_261_952, so 2r < denominator. Therefore
  // interest = 171_209_643_835_616 and reinvested closing = 8_871_209_643_835_619.
  const base = BigInt(installmentPaise) * 3n;
  const numerator = BigInt(installmentPaise) * 1184n * (91n + 60n + 31n) * 4n;
  const denominator = 10000n * 4n * 365n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const expectedInterest = remainder * 2n >= denominator ? quotient + 1n : quotient;
  const expectedClosing = base + expectedInterest;

  assert.equal(q1.interestPaise, Number(expectedInterest));
  assert.equal(q1.payoutPaise, 0);
  assert.equal(q1.closingPaise, Number(expectedClosing));
  assert.equal(q1.closingPaise, 8_871_209_643_835_619);
  assert.ok(Number.isSafeInteger(q1.closingPaise), "the high-value exact result remains safe");
});

// ── Post-condition: throws on safe-integer overflow ──────────────────────────
//
// A principal at Number.MAX_SAFE_INTEGER with a non-zero rate causes the Q1
// closing balance to exceed MAX_SAFE_INTEGER (closing ≈ principal + interest,
// where interest ≈ principal × 0.0175 ≈ 1.58×10^14 — itself safe — but
// closingPaise ≈ 9.16×10^15 > MAX_SAFE_INTEGER = 9.007×10^15).

test("post-condition throws when closing paise exceeds safe integer range", () => {
  const terms: DepositTerms = {
    depositKind: "fd",
    principalPaise: Number.MAX_SAFE_INTEGER, // 9_007_199_254_740_991
    annualRateBps: 700,
    compoundingFrequency: "quarterly",
    interestDisposition: "reinvest",
    startDate: "2024-01-01",
    maturityDate: "2025-01-01",
  };
  assert.throws(
    () => computeAccrualSchedule(terms),
    /deposit accrual: value exceeds safe integer range/,
    "must throw when closing paise would exceed Number.MAX_SAFE_INTEGER",
  );
});
