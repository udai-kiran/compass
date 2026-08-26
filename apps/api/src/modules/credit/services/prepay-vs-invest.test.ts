import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRateResetImpact, computePrepayVsInvest } from "./prepay-vs-invest.ts";
import { standardEmiPaise } from "@compass/shared";

// -- Rate-reset impact --

test("rate increase: same EMI -> longer tenure + more interest; same tenure -> higher EMI", () => {
  const principal = 50_000_000_00;
  const currentRate = 850;
  const totalInstallments = 240;
  const emi = standardEmiPaise(principal, currentRate, totalInstallments);
  const paid = 60;

  const result = computeRateResetImpact({
    currentRateBps: currentRate, newRateBps: 900,
    principalPaise: principal, currentInstallmentPaise: emi,
    currentTotalInstallments: totalInstallments, paidInstallments: paid,
  });

  assert.equal(result.remainingInstallments, 180);
  assert.ok(result.outstandingPaise > 0);
  assert.ok(result.sameEmi.tenureChangedBy > 0, "tenure should increase on rate hike");
  assert.ok(result.sameEmi.interestDeltaPaise > 0, "interest should increase");
  assert.ok(result.sameTenure.installmentDeltaPaise > 0, "EMI should increase");
  assert.ok(result.sameTenure.interestDeltaPaise > 0, "interest should increase");
});

test("rate decrease: same EMI -> shorter tenure; same tenure -> lower EMI", () => {
  const principal = 50_000_000_00;
  const currentRate = 900;
  const totalInstallments = 240;
  const emi = standardEmiPaise(principal, currentRate, totalInstallments);
  const paid = 60;

  const result = computeRateResetImpact({
    currentRateBps: currentRate, newRateBps: 850,
    principalPaise: principal, currentInstallmentPaise: emi,
    currentTotalInstallments: totalInstallments, paidInstallments: paid,
  });

  assert.ok(result.sameEmi.tenureChangedBy < 0, "tenure should decrease on rate cut");
  assert.ok(result.sameEmi.interestDeltaPaise < 0);
  assert.ok(result.sameTenure.installmentDeltaPaise < 0, "EMI should decrease");
});

test("rate unchanged: zero deltas", () => {
  const principal = 10_000_000_00;
  const rate = 850;
  const total = 120;
  const emi = standardEmiPaise(principal, rate, total);

  const result = computeRateResetImpact({
    currentRateBps: rate, newRateBps: rate,
    principalPaise: principal, currentInstallmentPaise: emi,
    currentTotalInstallments: total, paidInstallments: 0,
  });

  assert.equal(result.sameEmi.tenureChangedBy, 0);
  assert.equal(result.sameEmi.interestDeltaPaise, 0);
  assert.equal(result.sameTenure.installmentDeltaPaise, 0);
  assert.equal(result.sameTenure.interestDeltaPaise, 0);
});

// -- Prepay vs invest --

const basePrepayInput = {
  outstandingPaise: 30_000_000_00,
  annualRateBps: 850,
  installmentPaise: standardEmiPaise(30_000_000_00, 850, 180),
  remainingInstallments: 180,
  lumpSumPaise: 5_000_000_00,
  prepaymentChargesPaise: 0,
  regime: "new" as const,
  investReturnBps: 1200,
  isHomeLoan: true,
  emergencyFundedPaise: 3_000_000_00,
  emergencyTargetPaise: 3_000_000_00,
  highInterestDebtPaise: 0,
};

test("tenure reduction: saves installments and interest", () => {
  const result = computePrepayVsInvest(basePrepayInput);
  assert.equal(result.tenureReduction.strategy, "tenure_reduction");
  assert.ok(result.tenureReduction.tenureSavedInstallments! > 0);
  assert.ok(result.tenureReduction.interestSavedPaise > 0);
  assert.ok(result.tenureReduction.newOutstandingPaise < basePrepayInput.outstandingPaise);
});

test("EMI reduction: reduces monthly EMI", () => {
  const result = computePrepayVsInvest(basePrepayInput);
  assert.equal(result.emiReduction.strategy, "emi_reduction");
  assert.ok(result.emiReduction.installmentReductionPaise! > 0);
  assert.ok(result.emiReduction.interestSavedPaise > 0);
});

test("tenure reduction saves at least as much interest as EMI reduction", () => {
  const result = computePrepayVsInvest(basePrepayInput);
  assert.ok(result.tenureReduction.interestSavedPaise >= result.emiReduction.interestSavedPaise);
});

test("full payoff when lump sum exceeds outstanding", () => {
  const result = computePrepayVsInvest({
    ...basePrepayInput,
    outstandingPaise: 2_000_000_00,
    lumpSumPaise: 5_000_000_00,
  });
  assert.equal(result.tenureReduction.newOutstandingPaise, 0);
  assert.equal(result.tenureReduction.newRemainingInstallments, 0);
});

test("emergency fund first when underfunded", () => {
  const result = computePrepayVsInvest({
    ...basePrepayInput,
    emergencyFundedPaise: 1_000_000_00,
    emergencyTargetPaise: 3_000_000_00,
  });
  assert.equal(result.recommendation, "emergency_fund_first");
  assert.ok(result.recommendationReason.includes("emergency fund"));
});

test("high-interest debt first when revolving debt exists", () => {
  const result = computePrepayVsInvest({
    ...basePrepayInput,
    highInterestDebtPaise: 50_000_00,
  });
  assert.equal(result.recommendation, "high_interest_debt_first");
  assert.ok(result.recommendationReason.includes("revolving debt"));
});

test("24(b) applied for old-regime home loan", () => {
  const result = computePrepayVsInvest({ ...basePrepayInput, regime: "old", isHomeLoan: true });
  assert.ok(result.section24bApplied);
  assert.ok(result.effectiveLoanRateBps < basePrepayInput.annualRateBps);
});

test("24(b) NOT applied for new regime", () => {
  const result = computePrepayVsInvest({ ...basePrepayInput, regime: "new", isHomeLoan: true });
  assert.ok(!result.section24bApplied);
  assert.equal(result.effectiveLoanRateBps, basePrepayInput.annualRateBps);
});

test("24(b) NOT applied for non-home loan", () => {
  const result = computePrepayVsInvest({ ...basePrepayInput, regime: "old", isHomeLoan: false });
  assert.ok(!result.section24bApplied);
});

test("prepayment charges reduce effective lump sum", () => {
  const charges = 25_000_00;
  const result = computePrepayVsInvest({ ...basePrepayInput, prepaymentChargesPaise: charges });
  assert.equal(result.effectiveLumpSumPaise, basePrepayInput.lumpSumPaise - charges);
});

test("investment alternative includes risk note", () => {
  const result = computePrepayVsInvest(basePrepayInput);
  assert.ok(result.investAlternative.riskNote.includes("not guaranteed"));
  assert.ok(result.investAlternative.projectedGainPaise > 0);
});

test("all amounts are integer paise", () => {
  const result = computePrepayVsInvest(basePrepayInput);
  assert.ok(Number.isInteger(result.outstandingPaise));
  assert.ok(Number.isInteger(result.effectiveLumpSumPaise));
  assert.ok(Number.isInteger(result.tenureReduction.interestSavedPaise));
  assert.ok(Number.isInteger(result.emiReduction.interestSavedPaise));
  assert.ok(Number.isInteger(result.investAlternative.projectedValuePaise));
  assert.ok(Number.isInteger(result.investAlternative.postTaxGainPaise));
});
