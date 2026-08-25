import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPii, type RedactionIdentity } from "./redact.ts";

const me: RedactionIdentity = {
  names: ["Udai Kiran"],
  emails: ["udai@gmail.com"],
  upiIds: ["udai@oksbi"],
};

test("masks the user's own name but keeps merchant names", () => {
  const out = redactPii("Dear Udai Kiran, you paid SWIGGY and Amazon.", me);
  assert.ok(!out.includes("Udai Kiran"));
  assert.ok(out.includes("SWIGGY"));
  assert.ok(out.includes("Amazon"));
});

test("masks a salutation name even when it isn't the stored user", () => {
  const out = redactPii("Hi Rajesh, your statement is ready.", me);
  assert.match(out, /Hi \[name\]/);
});

test("masks the user's VPA but keeps a merchant's VPA", () => {
  const out = redactPii("Paid to swiggy@ybl from udai@oksbi", me);
  assert.ok(out.includes("swiggy@ybl"), "merchant VPA survives");
  assert.ok(!out.includes("udai@oksbi"), "user VPA masked");
  assert.match(out, /\[upi\]/);
});

test("masks a VPA whose handle matches a user name token even if unsaved", () => {
  const out = redactPii("Sent from udai@paytm", me);
  assert.match(out, /\[upi\]/);
  assert.ok(!out.includes("udai@paytm"));
});

test("masks all email addresses in the body", () => {
  const out = redactPii("Contact udai@gmail.com or care@bank.co.in", me);
  assert.ok(!out.includes("udai@gmail.com"));
  assert.ok(!out.includes("care@bank.co.in"));
});

test("keeps the bank-masked last-4 and rupee amounts, masks full account numbers", () => {
  const out = redactPii("A/C XXXX5739 debited Rs 12,345.67 (ref 500123456789012)", me);
  assert.ok(out.includes("5739"), "last-4 preserved for matching");
  assert.ok(out.includes("12,345.67"), "amount preserved");
  assert.ok(!out.includes("500123456789012"), "full account number masked");
  assert.match(out, /\[account\]/);
});

test("masks phone, PAN and Aadhaar", () => {
  const out = redactPii("Call 9876543210, PAN ABCDE1234F, Aadhaar 1234 5678 9012", me);
  assert.match(out, /\[phone\]/);
  assert.match(out, /\[pan\]/);
  assert.match(out, /\[aadhaar\]/);
  assert.ok(!out.includes("9876543210"));
});

test("masks lowercase and mixed-case PAN (case-insensitive, §156 i-flag regression)", () => {
  const lower = redactPii("PAN abcde1234f on record", me);
  assert.match(lower, /\[pan\]/, "all-lowercase PAN must be masked");
  assert.ok(!lower.includes("abcde1234f"));

  const mixed = redactPii("PAN AbCdE1234f on record", me);
  assert.match(mixed, /\[pan\]/, "mixed-case PAN must be masked");
  assert.ok(!mixed.includes("AbCdE1234f"));
});

test("masks a labelled PIN code but leaves a bare 6-digit amount alone", () => {
  const labelled = redactPii("Bengaluru, Karnataka PIN 560103", me);
  assert.match(labelled, /\[pin\]/);
  const amount = redactPii("Total spend 150000 this cycle", me);
  assert.ok(amount.includes("150000"), "a bare 6-digit number is not treated as a PIN");
});

test("structural:false leaves sender routing but still strips the user's own identifiers", () => {
  const from = redactPii("Udai Kiran <udai@gmail.com>", me, { structural: false });
  assert.ok(!from.includes("Udai Kiran"));
  assert.ok(!from.includes("udai@gmail.com"));
  const bank = redactPii("HDFC Bank <alerts@hdfcbank.net>", me, { structural: false });
  assert.ok(bank.includes("alerts@hdfcbank.net"), "bank sender kept for classification");
});

test("masks a hyphen-grouped card number", () => {
  const out = redactPii("Card 4111-1111-1111-1111 charged Rs 500.00", me);
  assert.ok(!out.includes("4111-1111-1111-1111"));
  assert.ok(!/\d{4}-\d{4}/.test(out));
});

test("masks a space-grouped card number", () => {
  const out = redactPii("Card 4111 1111 1111 1111 charged Rs 500.00", me);
  assert.ok(!out.includes("4111 1111 1111 1111"));
});

test("masks a spaced account number", () => {
  const out = redactPii("Account 5010 0123 4535 10 credited", me);
  assert.ok(!out.includes("5010 0123 4535 10"));
});

test("masks a spaced mobile number", () => {
  const out = redactPii("Call me on 98765 43210 today", me);
  assert.ok(!out.includes("98765 43210"));
});

test("masks a +91-prefixed spaced mobile number", () => {
  const out = redactPii("Reach +91 98765 43210 for help", me);
  assert.ok(!out.includes("98765 43210"));
});

test("masks a hyphenated Aadhaar", () => {
  const out = redactPii("Aadhaar 1234-5678-9012 on file", me);
  assert.ok(!out.includes("1234-5678-9012"));
  assert.match(out, /\[aadhaar\]/);
});

test("masks a labelled multi-line address but leaves the following transaction line intact", () => {
  const out = redactPii(
    "Billing Address: 221B Baker Street\nNear Central Park\nBengaluru, Karnataka 560103\n20/07/2026 SWIGGY BANGALORE 450.00",
    me,
  );
  assert.ok(!out.includes("221B Baker Street"));
  assert.ok(!out.includes("Central Park"));
  assert.ok(!out.includes("560103"));
  assert.match(out, /\[address\]/);
  assert.ok(out.includes("20/07/2026 SWIGGY BANGALORE 450.00"), "transaction line survives");
});

test("masks an address ending in a labelled PIN and leaves the following transaction line intact", () => {
  const out = redactPii(
    "Billing Address: 221B Baker Street\nNear Central Park\nBengaluru, Karnataka PIN 560103\n20/07/2026 SWIGGY BANGALORE 450.00",
    me,
  );
  assert.ok(!out.includes("221B Baker Street"));
  assert.ok(!out.includes("Central Park"));
  assert.ok(!out.includes("560103"));
  assert.match(out, /\[address\]/);
  assert.ok(out.includes("20/07/2026 SWIGGY BANGALORE 450.00"), "transaction line survives");
});

test("a PIN-less address followed by a dated transaction line does not swallow the transaction", () => {
  const out = redactPii(
    "Address: 221B Baker Street\nNear Central Park\n20/07/2026 SWIGGY BANGALORE 450.00",
    me,
  );
  assert.ok(out.includes("20/07/2026 SWIGGY BANGALORE 450.00"), "transaction line survives");
});

test("a PIN-less address followed by an amount line does not swallow that line", () => {
  const out = redactPii("Address: 221B Baker Street\nNear Central Park\nAmount charged 1,234.56", me);
  assert.ok(out.includes("1,234.56"), "amount line survives");
});

test("does not touch Indian-grouped rupee amounts, dates, masked last-4, or statement lines", () => {
  const amount = redactPii("Total due 1,23,456.78 this month", me);
  assert.ok(amount.includes("1,23,456.78"));
  const date = redactPii("Statement date 20-07-2026", me);
  assert.ok(date.includes("20-07-2026"));
  const lastFour = redactPii("Card ending XXXX 5739", me);
  assert.ok(lastFour.includes("XXXX 5739"));
  const line = redactPii("20/07/2026 SWIGGY BANGALORE 450.00", me);
  assert.equal(line, "20/07/2026 SWIGGY BANGALORE 450.00");
});

test("a hyphenated date followed by a space-separated amount survives completely intact", () => {
  const out = redactPii("20-07-2026 450.00 SWIGGY BANGALORE", me);
  assert.equal(out, "20-07-2026 450.00 SWIGGY BANGALORE", "date, amount and merchant all untouched");
});

test("a uniformly space-grouped account number is masked but a trailing decimal amount survives", () => {
  // Digit groups chosen so the run isn't also a coincidental 4-4-4 Aadhaar
  // shape (that pass runs first and takes priority by design), isolating
  // the grouped-digit/account pass's decimal-tail backtracking.
  const out = redactPii("Account No 50100 123 4535 10 450.00", me);
  assert.ok(!out.includes("50100 123 4535 10"), "account digits masked");
  assert.match(out, /\[account\]/);
  assert.ok(out.includes("450.00"), "trailing amount survives");
});

test("a spaced account number that happens to be Aadhaar-shaped is still masked, and the trailing amount still survives", () => {
  const out = redactPii("Account No 5010 0123 4535 10 450.00", me);
  assert.ok(!out.includes("5010 0123 4535"), "digits masked (Aadhaar pass claims the 4-4-4 run first)");
  assert.ok(out.includes("450.00"), "trailing amount survives");
});

test("empty text and empty identity are safe", () => {
  const empty: RedactionIdentity = { names: [], emails: [], upiIds: [] };
  assert.equal(redactPii("", me), "");
  assert.equal(redactPii("Paid SWIGGY 500", empty), "Paid SWIGGY 500");
});
