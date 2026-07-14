import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeHash, parseRow, suggestMapping } from "./imports.ts";
import { heuristicNormalize, normalizeMerchant } from "./merchants.ts";
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

test("heuristicNormalize strips bank noise", () => {
  assert.equal(heuristicNormalize("POS 402911 AMAZON PAY INDIA BLR"), "Amazon Blr");
  assert.equal(heuristicNormalize("UPI-swiggy@ybl-9012"), "Swiggy");
  assert.equal(normalizeMerchant("POS AMAZON PAY 123", [{ match: "amazon", replacement: "Amazon" }]), "Amazon");
});
