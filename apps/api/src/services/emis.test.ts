import { test } from "node:test";
import assert from "node:assert/strict";
import { amortize, splitInstallments } from "./emis.ts";

// ---------- (a) on-schedule payments match amortize()'s per-row arithmetic exactly ----------

test("splitInstallments: on-schedule monthly payments match a hand-computed amortize()-style loop, per row", () => {
  const principalPaise = 100000;
  const annualRateBps = 1200; // 12% p.a. -> 1% monthly
  const startDate = "2026-01-05";
  const payments = [
    { transactionId: "t1", date: "2026-02-05", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-03-05", amountPaise: -34000 },
    { transactionId: "t3", date: "2026-04-05", amountPaise: -34000 },
  ];

  const rows = splitInstallments(principalPaise, annualRateBps, startDate, payments);

  // Hand-implemented amortize()-equivalent loop: one period per payment,
  // reducing-balance, same rounding rule — computed independently of
  // splitInstallments, not by calling amortize() (which only returns
  // aggregates) or splitInstallments itself.
  const r = annualRateBps / 10000 / 12;
  let balance = principalPaise;
  const expected: { principalPaise: number; interestPaise: number; balancePaise: number }[] = [];
  for (const p of payments) {
    const paid = Math.abs(p.amountPaise);
    const interest = Math.round(balance * r);
    const principalPart = Math.min(balance, paid - interest);
    balance -= principalPart;
    expected.push({ principalPaise: principalPart, interestPaise: interest, balancePaise: balance });
  }

  assert.equal(rows.length, 3);
  rows.forEach((row, i) => {
    assert.equal(row.principalPaise, expected[i]!.principalPaise);
    assert.equal(row.interestPaise, expected[i]!.interestPaise);
    assert.equal(row.balancePaise, expected[i]!.balancePaise);
  });

  // Exact hand-traced values (see task's review-2 hand-trace):
  assert.deepEqual(
    rows.map((row) => [row.principalPaise, row.interestPaise, row.balancePaise]),
    [
      [33000, 1000, 67000],
      [33330, 670, 33670],
      [33663, 337, 7],
    ],
  );
  rows.forEach((row) => {
    assert.equal(row.principalPaise + row.interestPaise, Math.abs(row.amountPaise));
  });

  // Tie the ledger-driven algorithm's aggregate back to the real,
  // production amortize() function — not just the test's own
  // hand-rolled parallel loop above.
  const totalInterest = rows.reduce((sum, row) => sum + row.interestPaise, 0);
  const installmentPaise = Math.abs(payments[0]!.amountPaise); // 34000, same for every payment in this fixture
  const { totalInterestPaise } = amortize(
    principalPaise,
    annualRateBps,
    installmentPaise,
    payments.length, // totalInstallments
    payments.length, // paidInstallments — all of them paid, for this fixture
  );
  assert.equal(totalInterest, totalInterestPaise);
});

// ---------- (b) prepayment ----------

test("splitInstallments: a payment larger than the period's interest (prepayment) reduces balance by more than the standard principal share", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -60000 },
  ]);
  assert.equal(row!.interestPaise, 1000);
  assert.equal(row!.principalPaise, 59000);
  assert.equal(row!.balancePaise, 41000);
  // A standard on-schedule installment of 34000 in the same period would
  // only have taken 33000 off principal (see case (a) row 1) — this
  // prepayment takes off more.
  assert.ok(row!.principalPaise > 33000);
});

// ---------- (c) underpayment / shortfall capitalizes ----------

test("splitInstallments: a payment smaller than the period's interest capitalizes the shortfall, interest capped at paid, principal 0", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-05", [
    { transactionId: "t1", date: "2026-02-05", amountPaise: -500 },
  ]);
  assert.equal(row!.principalPaise, 0);
  assert.equal(row!.interestPaise, 500);
  assert.equal(row!.principalPaise + row!.interestPaise, 500);
  // periodInterest was 1000 (1% of 100000); only 500 was paid, so the 500
  // shortfall capitalizes: 100000 + 500 = 100500.
  assert.equal(row!.balancePaise, 100500);
});

// ---------- (d) multi-month gap capitalizes skipped months' interest ----------

test("splitInstallments: a 3-calendar-month gap capitalizes the 2 skipped months' interest before charging the paid period", () => {
  const rows = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-05-01", amountPaise: -34000 },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    [rows[0]!.principalPaise, rows[0]!.interestPaise, rows[0]!.balancePaise],
    [33000, 1000, 67000],
  );
  // 2 skipped months capitalize: 67000 -> 67670 -> 68347; then the paid
  // period's own interest is round(68347 * 0.01) = 683.
  assert.deepEqual(
    [rows[1]!.principalPaise, rows[1]!.interestPaise, rows[1]!.balancePaise],
    [33317, 683, 35030],
  );
  assert.equal(rows[1]!.principalPaise + rows[1]!.interestPaise, 34000);
});

// ---------- (e) same-month duplicate payment accrues interest once ----------

test("splitInstallments: two payments in the same calendar month accrue interest once, not twice", () => {
  const rows = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-01-10", amountPaise: -20000 },
    { transactionId: "t2", date: "2026-01-25", amountPaise: -10000 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.interestPaise, 1000);
  // Second same-month payment: no new period, no new interest.
  assert.equal(rows[1]!.interestPaise, 0);
  assert.equal(rows[1]!.principalPaise, 10000);
  assert.equal(rows[1]!.balancePaise, 71000);
});

// ---------- (f) balance never goes negative (payoff/overpayment) ----------

test("splitInstallments: an overshoot payment floors balance at 0 without attributing the excess", () => {
  const [row] = splitInstallments(1000, 0, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -5000 },
  ]);
  assert.equal(row!.principalPaise, 1000);
  assert.equal(row!.interestPaise, 0);
  assert.equal(row!.balancePaise, 0);
  // principal + interest (1000) is strictly less than paid (5000) on a
  // payoff/overpayment row — the excess is unattributed by design.
  assert.ok(row!.principalPaise + row!.interestPaise < Math.abs(row!.amountPaise));
});

// ---------- (g) a payment after payoff produces a 0/0/0 row, no crash ----------

test("splitInstallments: a transaction landing after the loan is already paid off produces a 0/0/0 row", () => {
  const rows = splitInstallments(1000, 0, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -5000 },
    { transactionId: "t2", date: "2026-03-01", amountPaise: -2000 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.principalPaise, 0);
  assert.equal(rows[1]!.interestPaise, 0);
  assert.equal(rows[1]!.balancePaise, 0);
});

// ---------- (h) empty payments list ----------

test("splitInstallments: an empty payments list returns []", () => {
  assert.deepEqual(splitInstallments(100000, 1200, "2026-01-01", []), []);
});

// ---------- (i) first payment lands in the same calendar month as startDate ----------

test("splitInstallments: the first payment landing in the same calendar month as startDate still accrues one period of interest", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-01-15", amountPaise: -5000 },
  ]);
  // Unlike a later same-month payment (case (e), row 2), the very first
  // payment always charges at least one period — that month IS the first
  // period, even though calendarMonthsBetween(startDate, paymentDate) is 0.
  assert.equal(row!.interestPaise, 1000);
  assert.equal(row!.principalPaise, 4000);
  assert.equal(row!.balancePaise, 96000);
});

// ---------- (j) a December -> January gap computes the same elapsed-month count as an equal-length same-year gap ----------

test("splitInstallments: a gap crossing a December-January year boundary computes the same elapsed-month count as a same-year gap of equal length", () => {
  const crossesYearBoundary = splitInstallments(100000, 1200, "2025-10-01", [
    { transactionId: "t1", date: "2025-11-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-02-01", amountPaise: -34000 },
  ]);
  const sameYear = splitInstallments(100000, 1200, "2026-04-01", [
    { transactionId: "t1", date: "2026-05-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-08-01", amountPaise: -34000 },
  ]);
  const strip = (rows: ReturnType<typeof splitInstallments>) =>
    rows.map((row) => [row.principalPaise, row.interestPaise, row.balancePaise]);
  assert.deepEqual(strip(crossesYearBoundary), strip(sameYear));
});
