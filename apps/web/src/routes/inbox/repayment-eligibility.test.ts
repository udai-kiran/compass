import assert from "node:assert/strict";
import test from "node:test";
import type { Account, ExtractedTransaction } from "@compass/shared";
import { isRepaymentEligible } from "./repayment-eligibility.ts";

const account = (overrides: Partial<Account> = {}): Account => ({
  id: "b8e3a7f2-1c4d-4a8e-9d3f-6c2e1f4a7b8d",
  name: "Test Card",
  type: "credit_card",
  institution: "HDFC",
  accountLast4: "1234",
  holderName: null,
  holderId: null,
  upiIds: [],
  currency: "INR",
  openingBalancePaise: 0,
  goalId: null,
  linkedAccountId: null,
  schemeOpenedDate: null,
  nominee: "",
  nomineePersonId: null,
  sortOrder: 0,
  archivedAt: null,
  ...overrides,
});

const draft = (overrides: Partial<ExtractedTransaction> = {}): ExtractedTransaction => ({
  id: "c9f4b8e3-2d5e-5b9f-a4e6-7d3f2a5b8c9e",
  ingestionId: "d1a5c9f4-3e6f-4c1a-b5f7-8e4a3b6c9d1f",
  amountPaise: 150000,
  direction: "credit",
  occurredAt: "2025-01-15",
  counterparty: "Card Bill Payment",
  suggestedAccountId: null,
  suggestedCategoryId: null,
  intent: null,
  bankRef: null,
  sourceQuote: "",
  confidence: 0.9,
  status: "pending",
  transactionId: null,
  matchedTransactionId: null,
  transferPartnerId: null,
  createdAt: "2025-01-15T10:00:00.000Z",
  subject: "Payment received",
  fromAddr: "alerts@bank.example",
  receivedAt: null,
  ...overrides,
});

test("a credit draft with a credit_card account selected is eligible", () => {
  assert.equal(isRepaymentEligible(draft(), account({ type: "credit_card" })), true);
});

test("a credit draft with a non-card account selected is not eligible", () => {
  assert.equal(isRepaymentEligible(draft(), account({ type: "bank" })), false);
});

test("a debit draft with a credit_card account selected is not eligible", () => {
  assert.equal(
    isRepaymentEligible(draft({ direction: "debit" }), account({ type: "credit_card" })),
    false,
  );
});

test("no account selected is not eligible", () => {
  assert.equal(isRepaymentEligible(draft(), undefined), false);
});

test("intent: repayment never overrides a non-card account", () => {
  assert.equal(
    isRepaymentEligible(draft({ intent: "repayment" }), account({ type: "bank" })),
    false,
  );
});

test("intent: null never blocks a card-selected credit draft", () => {
  assert.equal(
    isRepaymentEligible(draft({ intent: null }), account({ type: "credit_card" })),
    true,
  );
});
