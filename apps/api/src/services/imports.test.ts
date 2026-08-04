import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeHash, linkedRollbackBlockers, parseRow, suggestMapping } from "./imports.ts";
import { heuristicNormalize, normalizeMerchant } from "../modules/ledger/services/merchants.ts";
import type { ImportMapping } from "@compass/shared";

const signedMapping: ImportMapping = {
  dateColumn: "Date",
  dateFormat: "YYYY-MM-DD",
  amountMode: "signed",
  amountColumn: "Amount",
  invertSign: false,
  merchantColumn: "Description",
};

test("parseRow parses a signed-amount row", () => {
  const p = parseRow(
    { Date: "2026-07-01", Amount: "-450.00", Description: "SWIGGY BANGALORE" },
    signedMapping,
    heuristicNormalize,
  );
  assert.equal(p.error, null);
  assert.equal(p.date, "2026-07-01");
  assert.equal(p.amountPaise, -45000);
  assert.equal(p.merchant, "Swiggy Bangalore");
  assert.equal(p.rawMerchant, "SWIGGY BANGALORE");
});

test("parseRow handles debit/credit columns", () => {
  const mapping: ImportMapping = {
    dateColumn: "Txn Date",
    dateFormat: "DD MMM YYYY",
    amountMode: "debit_credit",
    debitColumn: "Debit",
    creditColumn: "Credit",
    invertSign: false,
    merchantColumn: "Description",
  };
  const debit = parseRow(
    { "Txn Date": "3 Jul 2026", Debit: "1,200.00", Credit: "", Description: "AMAZON" },
    mapping,
    heuristicNormalize,
  );
  assert.equal(debit.amountPaise, -120000);
  const credit = parseRow(
    { "Txn Date": "3 Jul 2026", Debit: "", Credit: "5,000.00", Description: "SALARY" },
    mapping,
    heuristicNormalize,
  );
  assert.equal(credit.amountPaise, 500000);
});

test("parseRow collects malformed rows as errors, not throws", () => {
  const p = parseRow(
    { Date: "not-a-date", Amount: "xx", Description: "" },
    signedMapping,
    heuristicNormalize,
  );
  assert.equal(p.error, "Unparseable date");
  const p2 = parseRow(
    { Date: "2026-07-01", Amount: "xx", Description: "SHOP" },
    signedMapping,
    heuristicNormalize,
  );
  assert.equal(p2.error, "Unparseable amount");
});

test("dedupeHash is stable and case-insensitive on merchant", () => {
  const a = dedupeHash("acc1", "2026-07-01", -45000, "Swiggy");
  assert.equal(a, dedupeHash("acc1", "2026-07-01", -45000, "SWIGGY"));
  assert.notEqual(a, dedupeHash("acc1", "2026-07-02", -45000, "Swiggy"));
});

test("suggestMapping matches a built-in preset by headers", () => {
  const hit = suggestMapping(["Txn Date", "Description", "Debit", "Credit", "Balance"]);
  assert.equal(hit?.name, "SBI");
  assert.equal(suggestMapping(["colA", "colB"]), null);
});

test("HDFC statement: preset auto-matches its real headers", () => {
  const headers = [
    "Date",
    "Narration",
    "Chq./Ref.No.",
    "Value Dt",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
  ];
  assert.equal(suggestMapping(headers)?.name, "HDFC Bank");
});

test("HDFC statement: a withdrawal row parses (2-digit year, comma amount)", () => {
  const mapping = suggestMapping([
    "Date",
    "Narration",
    "Chq./Ref.No.",
    "Value Dt",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
  ])!.mapping;
  const withdrawal = parseRow(
    {
      Date: "01/04/26",
      Narration: "UPI-ACHAKALA SREENATH-ACHAKALA.SREENATH@IBL-UTIB0001628-982551223336-PAYMENT",
      "Chq./Ref.No.": "0000982551223336",
      "Value Dt": "01/04/26",
      "Withdrawal Amt.": "320.00",
      "Deposit Amt.": "",
      "Closing Balance": "6,394.15",
    },
    mapping,
    heuristicNormalize,
  );
  assert.equal(withdrawal.error, null);
  assert.equal(withdrawal.date, "2026-04-01"); // DD/MM/YY → 20YY
  assert.equal(withdrawal.amountPaise, -32000); // withdrawal is an outflow
  const deposit = parseRow(
    {
      Date: "05/04/26",
      Narration: "NEFT CR-SALARY",
      "Chq./Ref.No.": "N123",
      "Value Dt": "05/04/26",
      "Withdrawal Amt.": "",
      "Deposit Amt.": "50,000.00",
      "Closing Balance": "56,394.15",
    },
    mapping,
    heuristicNormalize,
  );
  assert.equal(deposit.amountPaise, 5_000_000); // deposit is an inflow
});

test("heuristicNormalize strips bank noise", () => {
  assert.equal(heuristicNormalize("POS 402911 AMAZON PAY INDIA BLR"), "Amazon Blr");
  assert.equal(heuristicNormalize("UPI-swiggy@ybl-9012"), "Swiggy");
  assert.equal(normalizeMerchant("POS AMAZON PAY 123", [{ match: "amazon", replacement: "Amazon" }]), "Amazon");
});

test("linkedRollbackBlockers: no candidates blocks nothing", () => {
  assert.equal(linkedRollbackBlockers([]), 0);
});

test("linkedRollbackBlockers: a linked, live row blocks", () => {
  assert.equal(linkedRollbackBlockers([{ sipId: "sip-1", deletedAt: null }]), 1);
});

test("linkedRollbackBlockers: a linked, soft-deleted row does not block", () => {
  assert.equal(linkedRollbackBlockers([{ sipId: "sip-1", deletedAt: new Date() }]), 0);
});
