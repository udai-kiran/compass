import assert from "node:assert/strict";
import test from "node:test";
import { editsOpeningBalanceAsAmount, openingBalanceFromInput, openingBalanceToInput } from "./opening-balance.ts";

test("a bank opening balance round-trips through the input", () => {
  assert.equal(openingBalanceToInput(5000000, "bank"), "50000");
  assert.equal(openingBalanceFromInput("50000", "bank"), 5000000);
});

test("a card's owed opening balance is shown unsigned and saved negative", () => {
  assert.equal(openingBalanceToInput(-4559100, "credit_card"), "45591");
  assert.equal(openingBalanceFromInput("45591", "credit_card"), -4559100);
});

test("a zero opening balance shows as an empty field", () => {
  assert.equal(openingBalanceToInput(0, "bank"), "");
  assert.equal(openingBalanceToInput(0, "credit_card"), "");
});

test("an empty field means zero", () => {
  assert.equal(openingBalanceFromInput("", "bank"), 0);
  assert.equal(openingBalanceFromInput("   ", "credit_card"), 0);
});

test("paise are preserved exactly", () => {
  assert.equal(openingBalanceFromInput("45591.75", "credit_card"), -4559175);
  assert.equal(openingBalanceFromInput("0.01", "bank"), 1);
});

test("more precision than paise is rejected rather than rounded away", () => {
  assert.equal(openingBalanceFromInput("10.005", "bank"), null);
});

test("sub-paise precision is rejected instead of being rounded through floating point", () => {
  // Math.round(2.675 * 100) is 268, not 267 — silently losing a paisa. Reject.
  assert.equal(openingBalanceFromInput("2.675", "bank"), null);
  assert.equal(openingBalanceFromInput("1.005", "credit_card"), null);
  assert.equal(openingBalanceFromInput("0.005", "bank"), null);
  // Two decimals or fewer stay exact.
  assert.equal(openingBalanceFromInput("2.67", "bank"), 267);
  assert.equal(openingBalanceFromInput("45591.75", "credit_card"), -4559175);
  assert.equal(openingBalanceFromInput("0.01", "bank"), 1);
  // A trailing dot is still accepted so the field works while being typed.
  assert.equal(openingBalanceFromInput("450.", "bank"), 45000);
});

test("junk input is rejected", () => {
  assert.equal(openingBalanceFromInput("abc", "bank"), null);
  assert.equal(openingBalanceFromInput("1,000", "bank"), null);
  assert.equal(openingBalanceFromInput(".", "bank"), null);
  assert.equal(openingBalanceFromInput("-", "bank"), null);
  assert.equal(openingBalanceFromInput("1.2.3", "bank"), null);
});

test("an explicitly negative entry on a liability is still treated as owed", () => {
  // Pins the liability re-signing itself: the same text must mean "owed" on a
  // card but "held" on a bank. Asserting only that a negative input stays
  // negative would pass without any liability handling at all.
  assert.equal(openingBalanceFromInput("45591", "credit_card"), -4559100);
  assert.equal(openingBalanceFromInput("45591", "bank"), 4559100);
  assert.equal(openingBalanceFromInput("-45591", "credit_card"), -4559100);
});

test("an explicitly negative entry on an asset is honoured", () => {
  assert.equal(openingBalanceFromInput("-500", "bank"), -50000);
});

test("an absurd amount is rejected rather than losing precision", () => {
  assert.equal(openingBalanceFromInput("999999999999999999", "bank"), null);
});

test("a card, loan or scheme edits its opening balance as an amount", () => {
  assert.equal(editsOpeningBalanceAsAmount("credit_card", -4559100), true);
  assert.equal(editsOpeningBalanceAsAmount("credit_card", 0), true);
  assert.equal(editsOpeningBalanceAsAmount("home_loan_od", -100000), true);
  assert.equal(editsOpeningBalanceAsAmount("ppf", 9200000), true);
});

test("bank and cash keep theirs as a ledger row, not an editable column", () => {
  assert.equal(editsOpeningBalanceAsAmount("bank", 0), false);
  assert.equal(editsOpeningBalanceAsAmount("cash", 0), false);
});

test("a bank or cash account still carrying a column amount stays correctable", () => {
  // Reachable when an account became bank/cash through a type change: the amount
  // sits on the column where no ledger row shows it, so the editor must appear.
  assert.equal(editsOpeningBalanceAsAmount("bank", 5000000), true);
  assert.equal(editsOpeningBalanceAsAmount("cash", -2500), true);
});
