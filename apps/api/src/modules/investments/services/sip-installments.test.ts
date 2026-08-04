import assert from "node:assert/strict";
import test from "node:test";
import {
  accountInstallmentSipIssue,
  candidateDateBounds,
  installmentDateError,
  linkInstallmentIssue,
} from "./sip-installments.ts";

// ---------- installmentDateError (recordSipInstallment: date must fall within the SIP's life) ----------

test("installmentDateError: a date before startDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: null }, "2025-12-31"),
    "Installment date is before the SIP started",
  );
});

test("installmentDateError: a date after endDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-07-01"),
    "Installment date is after the SIP ended",
  );
});

test("installmentDateError: a date inside the range is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-06-15"), null);
});

test("installmentDateError: a null endDate (open-ended) is valid for any date on/after start", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2030-01-01"), null);
});

test("installmentDateError: exactly on startDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2026-01-01"), null);
});

test("installmentDateError: exactly on endDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-06-30"), null);
});

// ---------- linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds ----------

const linkSip = {
  id: "sip-1",
  targetKind: "account" as const,
  targetAccountId: "acc-ppf",
  fundingSource: "bank_debit" as const,
  startDate: "2026-01-01",
  endDate: null,
};
const linkTx = { accountId: "acc-ppf", amountPaise: 150000, date: "2026-07-02", isOpening: false, sipId: null };

test("linkInstallmentIssue: a credit into the target account inside the window passes", () => {
  assert.equal(linkInstallmentIssue(linkSip, linkTx), null);
});

test("linkInstallmentIssue: an mf_folio SIP is rejected", () => {
  assert.deepEqual(linkInstallmentIssue({ ...linkSip, targetKind: "mf_folio" }, linkTx), {
    status: 400,
    message: "Only an account-target SIP records by linking a ledger transaction",
  });
});

test("linkInstallmentIssue: an account SIP funded by payroll is rejected", () => {
  assert.deepEqual(linkInstallmentIssue({ ...linkSip, fundingSource: "payroll" }, linkTx), {
    status: 400,
    message: "A payroll-funded SIP is recorded from your payslip, not manually",
  });
});

test("linkInstallmentIssue: a transaction in some other account is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, accountId: "acc-other" }), {
    status: 400,
    message: "That transaction isn't in this SIP's target account",
  });
});

test("linkInstallmentIssue: an opening-balance row is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, isOpening: true }), {
    status: 400,
    message: "An opening-balance entry can't be a SIP installment",
  });
});

test("linkInstallmentIssue: a negative amount (the transfer's outgoing leg) is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, amountPaise: -150000 }), {
    status: 400,
    message: "A SIP installment must be money arriving in the target account",
  });
});

test("linkInstallmentIssue: a zero amount is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, amountPaise: 0 }), {
    status: 400,
    message: "A SIP installment must be money arriving in the target account",
  });
});

test("linkInstallmentIssue: a row already linked to a different SIP is rejected 409", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, sipId: "sip-2" }), {
    status: 409,
    message: "That transaction is already linked to another SIP's installment",
  });
});

test("linkInstallmentIssue: a row already linked to this SIP passes — the idempotent re-link", () => {
  assert.equal(linkInstallmentIssue(linkSip, { ...linkTx, sipId: "sip-1" }), null);
});

test("linkInstallmentIssue: a date before startDate is rejected with installmentDateError's own message", () => {
  const tx = { ...linkTx, date: "2025-12-31" };
  assert.deepEqual(linkInstallmentIssue(linkSip, tx), {
    status: 400,
    message: installmentDateError(linkSip, tx.date)!,
  });
});

test("linkInstallmentIssue: a date after endDate is rejected with installmentDateError's own message", () => {
  const sip = { ...linkSip, endDate: "2026-06-30" };
  const tx = { ...linkTx, date: "2026-07-01" };
  assert.deepEqual(linkInstallmentIssue(sip, tx), {
    status: 400,
    message: installmentDateError(sip, tx.date)!,
  });
});

test("accountInstallmentSipIssue: null for an account+bank_debit SIP", () => {
  assert.equal(accountInstallmentSipIssue({ targetKind: "account", fundingSource: "bank_debit" }), null);
});

test("candidateDateBounds: asOf inside the window returns { from: startDate, to: asOf }", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2026-07-23"), {
    from: "2026-01-01",
    to: "2026-07-23",
  });
});

test("candidateDateBounds: asOf past endDate clamps to to endDate", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-07-23"), {
    from: "2026-01-01",
    to: "2026-06-30",
  });
});

test("candidateDateBounds: an open-ended SIP (endDate: null) never clamps", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2099-12-31"), {
    from: "2026-01-01",
    to: "2099-12-31",
  });
});

test("candidateDateBounds: asOf before startDate yields an inverted (empty) window", () => {
  const { from, to } = candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2025-12-01");
  assert.ok(to < from);
});
