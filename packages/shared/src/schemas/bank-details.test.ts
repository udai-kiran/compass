import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AccountNumberSchema,
  IfscSchema,
  UpiIdSchema,
  UpiIdsSchema,
  UpsertBankDetailsSchema,
  isBankAccount,
} from "./ledger.ts";

test("account numbers accept the range Indian banks actually issue", () => {
  // No single length works: SBI is 11, HDFC 14, ICICI 12, Kotak 16.
  assert.equal(AccountNumberSchema.safeParse("50100123453510").success, true);
  assert.equal(AccountNumberSchema.safeParse("123456789").success, true, "9 digits is the floor");
  assert.equal(AccountNumberSchema.safeParse("123456789012345678").success, true, "18 is the ceiling");
  assert.equal(AccountNumberSchema.safeParse("12345678").success, false, "8 digits is too short");
  assert.equal(AccountNumberSchema.safeParse("1234567890123456789").success, false);
});

test("account numbers reject anything that isn't digits", () => {
  // "50100 1234 5351" pasted from a passbook must fail loudly, not get stored
  // with spaces and then never match anything.
  assert.equal(AccountNumberSchema.safeParse("50100 1234 53510").success, false);
  assert.equal(AccountNumberSchema.safeParse("5010-0123-4535").success, false);
  assert.equal(AccountNumberSchema.safeParse("50100123453510 ").success, false);
});

test("IFSC is uppercased on the way in", () => {
  // Nobody types these in caps; storing both cases would split the key.
  assert.equal(IfscSchema.parse("hdfc0001234"), "HDFC0001234");
  assert.equal(IfscSchema.parse("  hdfc0001234  "), "HDFC0001234");
});

test("IFSC enforces the 5th-character zero", () => {
  // The reserved 0 is what separates a real IFSC from four letters and digits.
  assert.equal(IfscSchema.safeParse("HDFC0001234").success, true);
  assert.equal(IfscSchema.safeParse("HDFC1001234").success, false);
  assert.equal(IfscSchema.safeParse("HDF00001234").success, false, "bank code is 4 letters");
  assert.equal(IfscSchema.safeParse("HDFC000123").success, false, "too short");
  assert.equal(IfscSchema.safeParse("HDFC00012345").success, false, "too long");
});

test("IFSC allows digits in the branch code", () => {
  assert.equal(IfscSchema.safeParse("SBIN0000456").success, true);
  assert.equal(IfscSchema.safeParse("ICIC0001234").success, true);
  assert.equal(IfscSchema.safeParse("UTIB0CCH274").success, true, "branch codes can be alphanumeric");
});

test("UPI IDs normalise to lowercase", () => {
  assert.equal(UpiIdSchema.parse("Udai@OKHDFCBank"), "udai@okhdfcbank");
  assert.equal(UpiIdSchema.parse(" udai@ybl "), "udai@ybl");
});

test("UPI IDs accept the shapes banks hand out", () => {
  assert.equal(UpiIdSchema.safeParse("udai.kiran@okhdfcbank").success, true);
  assert.equal(UpiIdSchema.safeParse("udai-kiran@ybl").success, true);
  assert.equal(UpiIdSchema.safeParse("udai_kiran@paytm").success, true);
  assert.equal(UpiIdSchema.safeParse("9876543210@ybl").success, true, "a bare mobile is a valid VPA");
});

test("UPI IDs reject things that aren't handles", () => {
  assert.equal(UpiIdSchema.safeParse("udai").success, false, "no PSP");
  assert.equal(UpiIdSchema.safeParse("@okhdfcbank").success, false, "no handle");
  assert.equal(UpiIdSchema.safeParse("udai@").success, false);
  assert.equal(UpiIdSchema.safeParse("udai@@ybl").success, false);
  assert.equal(UpiIdSchema.safeParse("udai kiran@ybl").success, false, "no spaces");
});

test("a UPI ID can't be listed twice on one account", () => {
  // Duplicates would make "the first one is primary" ambiguous on removal.
  assert.equal(UpiIdsSchema.safeParse(["udai@ybl", "udai@okhdfcbank"]).success, true);
  assert.equal(UpiIdsSchema.safeParse(["udai@ybl", "udai@ybl"]).success, false);
  // Case-only differences collapse first, so they count as duplicates too.
  assert.equal(UpiIdsSchema.safeParse(["udai@ybl", "Udai@YBL"]).success, false);
});

test("empty string clears a bank detail rather than failing validation", () => {
  // The form sends "" for "I don't want this recorded" — that must not 400.
  const cleared = UpsertBankDetailsSchema.parse({});
  assert.deepEqual(cleared, { accountNumber: "", ifsc: "", branch: "", subtype: null });
  assert.equal(UpsertBankDetailsSchema.safeParse({ ifsc: "" }).success, true);
});

test("a half-typed IFSC is still rejected when other fields are fine", () => {
  const res = UpsertBankDetailsSchema.safeParse({
    accountNumber: "50100123453510",
    ifsc: "HDFC001",
    branch: "Kondapur",
    subtype: "savings",
  });
  assert.equal(res.success, false);
});

test("only bank accounts carry bank details", () => {
  // PPF/EPF numbers live in retirement_details.referenceNumber — one home each.
  assert.equal(isBankAccount("bank"), true);
  assert.equal(isBankAccount("ppf"), false);
  assert.equal(isBankAccount("epf"), false);
  assert.equal(isBankAccount("credit_card"), false);
  assert.equal(isBankAccount("cash"), false);
});
