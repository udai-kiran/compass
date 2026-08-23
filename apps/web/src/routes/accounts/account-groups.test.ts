import assert from "node:assert/strict";
import test from "node:test";
import type { AccountWithBalance } from "@compass/shared";
import { splitAccounts, owedPaise, balanceSummary } from "./account-groups.ts";

const account = (overrides: Partial<AccountWithBalance> = {}): AccountWithBalance => ({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  name: "Test Account",
  type: "bank",
  institution: "Test Bank",
  accountLast4: "1234",
  holderName: "Test Holder",
  holderId: null,
  upiIds: [],
  currency: "INR",
  openingBalancePaise: 0,
  openingTransactionPaise: 0,
  goalId: null,
  linkedAccountId: null,
  schemeOpenedDate: null,
  sortOrder: 0,
  archivedAt: null,
  balancePaise: 0,
  subtype: null,
  ...overrides,
});

test("bank and cash land in savings; overdraft and home_loan_od land in loans", () => {
  const accounts = [
    account({ id: "1", type: "bank", name: "Bank" }),
    account({ id: "2", type: "cash", name: "Cash" }),
    account({ id: "3", type: "overdraft", name: "Overdraft" }),
    account({ id: "4", type: "home_loan_od", name: "Home Loan OD" }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.accounts.length, 2);
  assert.equal(groups.loans.accounts.length, 2);
  assert.deepEqual(
    groups.savings.accounts.map((a) => a.name),
    ["Bank", "Cash"],
  );
  assert.deepEqual(
    groups.loans.accounts.map((a) => a.name),
    ["Overdraft", "Home Loan OD"],
  );
});

test("an overdraft with a POSITIVE balance still lands in loans", () => {
  const accounts = [
    account({ id: "1", type: "overdraft", balancePaise: 50000, name: "OD in Credit" }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.accounts.length, 0);
  assert.equal(groups.loans.accounts.length, 1);
  assert.equal(groups.loans.accounts[0]!.name, "OD in Credit");
});

test("subtotals are signed sums and reconcile", () => {
  const accounts = [
    account({ id: "1", type: "bank", balancePaise: 100000 }),
    account({ id: "2", type: "cash", balancePaise: 5000 }),
    account({ id: "3", type: "overdraft", balancePaise: -50000 }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.totalPaise, 105000);
  assert.equal(groups.loans.totalPaise, -50000);
  assert.equal(groups.totalPaise, 55000);
  assert.equal(groups.totalPaise, groups.savings.totalPaise + groups.loans.totalPaise);
  const plainReduce = accounts.reduce((s, a) => s + a.balancePaise, 0);
  assert.equal(groups.totalPaise, plainReduce);
});

test("subtotals reconcile when account types are interleaved", () => {
  // The test above feeds savings first, so it never checks that a row is routed
  // by type rather than by its position in the input. Interleaving does, and the
  // positive home_loan_od keeps the loans subtotal honest while it is at it.
  const accounts = [
    account({ id: "1", type: "overdraft", balancePaise: -250000, sortOrder: 10 }),
    account({ id: "2", type: "bank", balancePaise: 400000, sortOrder: 20 }),
    account({ id: "3", type: "home_loan_od", balancePaise: 75000, sortOrder: 30 }),
    account({ id: "4", type: "cash", balancePaise: 12500, sortOrder: 40 }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.totalPaise, 412500);
  assert.equal(groups.loans.totalPaise, -175000);
  assert.equal(groups.totalPaise, 237500);
  assert.equal(groups.count, 4);
});

test("archived accounts are excluded from both groups and from count/totalPaise", () => {
  const accounts = [
    account({ id: "1", type: "bank", balancePaise: 10000, archivedAt: null }),
    account({ id: "2", type: "cash", balancePaise: 5000, archivedAt: "2026-07-01T00:00:00Z" }),
    account({ id: "3", type: "overdraft", balancePaise: -2000, archivedAt: "2026-07-01T00:00:00Z" }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.accounts.length, 1);
  assert.equal(groups.loans.accounts.length, 0);
  assert.equal(groups.count, 1);
  assert.equal(groups.totalPaise, 10000);
});

test("non-operating types are excluded", () => {
  const accounts = [
    account({ id: "1", type: "bank", name: "Bank" }),
    account({ id: "2", type: "credit_card", name: "Credit Card" }),
    account({ id: "3", type: "loan", name: "Loan" }),
    account({ id: "4", type: "investment", name: "Investment" }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(groups.savings.accounts.length, 1);
  assert.equal(groups.loans.accounts.length, 0);
  assert.equal(groups.count, 1);
  assert.equal(groups.savings.accounts[0]!.name, "Bank");
});

test("sortOrder is honoured within each group and input array is not mutated", () => {
  const accounts = [
    account({ id: "1", type: "bank", name: "Bank B", sortOrder: 20 }),
    account({ id: "2", type: "overdraft", name: "OD B", sortOrder: 40 }),
    account({ id: "3", type: "cash", name: "Cash A", sortOrder: 10 }),
    account({ id: "4", type: "home_loan_od", name: "OD A", sortOrder: 30 }),
  ];
  const originalOrder = accounts.map((a) => a.name);
  const groups = splitAccounts(accounts);
  assert.deepEqual(
    groups.savings.accounts.map((a) => a.name),
    ["Cash A", "Bank B"],
  );
  assert.deepEqual(
    groups.loans.accounts.map((a) => a.name),
    ["OD A", "OD B"],
  );
  assert.deepEqual(
    accounts.map((a) => a.name),
    originalOrder,
  );
});

test("empty input results in both groups empty and all totals 0", () => {
  const groups = splitAccounts([]);
  assert.equal(groups.savings.accounts.length, 0);
  assert.equal(groups.loans.accounts.length, 0);
  assert.equal(groups.savings.totalPaise, 0);
  assert.equal(groups.loans.totalPaise, 0);
  assert.equal(groups.totalPaise, 0);
  assert.equal(groups.count, 0);
});

test("undefined input is treated as empty — the page passes it before the query resolves", () => {
  const groups = splitAccounts(undefined);
  assert.deepEqual(groups.savings, { accounts: [], totalPaise: 0 });
  assert.deepEqual(groups.loans, { accounts: [], totalPaise: 0 });
  assert.equal(groups.totalPaise, 0);
  assert.equal(groups.count, 0);
  assert.equal(balanceSummary(groups), "0 accounts");
});

test("owedPaise converts negative total to positive; positive total to 0; 0 stays 0", () => {
  assert.equal(owedPaise(-50000), 50000);
  assert.equal(owedPaise(10000), 0);
  assert.equal(owedPaise(0), 0);
});

test("balanceSummary with both groups present contains all three segments", () => {
  const accounts = [
    account({ id: "1", type: "bank", balancePaise: 100000 }),
    account({ id: "2", type: "overdraft", balancePaise: -50000 }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(balanceSummary(groups), "₹1,000.00 in savings · ₹500.00 owed · 2 accounts");
});

test("balanceSummary with no loans omits the owed segment", () => {
  const accounts = [
    account({ id: "1", type: "bank", balancePaise: 100000 }),
    account({ id: "2", type: "cash", balancePaise: 5000 }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(balanceSummary(groups), "₹1,050.00 in savings · 2 accounts");
});

test("balanceSummary with no savings omits the savings segment", () => {
  const accounts = [
    account({ id: "1", type: "overdraft", balancePaise: -50000 }),
  ];
  const groups = splitAccounts(accounts);
  assert.equal(balanceSummary(groups), "₹500.00 owed · 1 account");
});

test("balanceSummary renders singular account correctly", () => {
  const accounts = [account({ id: "1", type: "bank", balancePaise: 10000 })];
  const groups = splitAccounts(accounts);
  assert.equal(balanceSummary(groups), "₹100.00 in savings · 1 account");
});
