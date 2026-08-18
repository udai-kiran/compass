import assert from "node:assert/strict";
import test from "node:test";
import type { CardSummary, CardDetails } from "@compass/shared";
import { needsStatementPassword } from "./card-warnings.ts";

const cardDetails = (overrides: Partial<CardDetails> = {}): CardDetails => ({
  accountId: "b8e3a7f2-1c4d-4a8e-9d3f-6c2e1f4a7b8d",
  network: "visa",
  productName: "Test Card",
  cycleDay: 1,
  dueDay: 15,
  earnRatePer100: 1,
  hasStatementPassword: false,
  aprBps: null,
  cashAprBps: null,
  lateFeePaise: null,
  interestFreeDays: null,
  ...overrides,
});

const cardSummary = (overrides: Partial<CardSummary> = {}): CardSummary => ({
  accountId: "b8e3a7f2-1c4d-4a8e-9d3f-6c2e1f4a7b8d",
  name: "Test Card",
  bankName: "HDFC",
  last4: "1234",
  details: null,
  balancePaise: 0,
  statementStart: null,
  statementEnd: null,
  amountDuePaise: 0,
  dueDate: null,
  currentSpendPaise: 0,
  rewardPoints: 0,
  ...overrides,
});

test("a card with a stored statement password needs nothing", () => {
  const card = cardSummary({ details: cardDetails({ hasStatementPassword: true }) });
  assert.equal(needsStatementPassword(card), false);
});

test("a card whose details exist without a password needs one", () => {
  const card = cardSummary({ details: cardDetails({ hasStatementPassword: false }) });
  assert.equal(needsStatementPassword(card), true);
});

test("a card with no details row at all needs one", () => {
  const card = cardSummary({ details: null });
  assert.equal(needsStatementPassword(card), true);
});
