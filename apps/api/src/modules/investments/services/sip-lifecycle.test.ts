import assert from "node:assert/strict";
import test from "node:test";
import { accountCanHaveGoal, sipDateRangeValid } from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import {
  assertLinkRowsMatched,
  isArchived,
  isCheckViolation,
  isUniqueViolation,
  laterInstallmentDate,
  resolveSipDateRange,
  resolveSipFundingTarget,
  resolveTargetGoalDecision,
  sipEditOrphansLinks,
} from "./sip-lifecycle.ts";

// ---------- resolveTargetGoalDecision (Fix 1: target-goal reconciliation) ----------

test("resolveTargetGoalDecision: an unmapped target gets linked to the SIP's goal", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", null), "link");
});

test("resolveTargetGoalDecision: a target already mapped to the SIP's own goal is allowed as a no-op", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", "goal-1"), "allow");
});

test("resolveTargetGoalDecision: a target mapped to a different goal is rejected", () => {
  assert.equal(resolveTargetGoalDecision("goal-1", "goal-2"), "reject");
});

// ---------- sipDateRangeValid (Fix 4: endDate >= startDate) ----------

test("sipDateRangeValid: a null endDate (open-ended) is always valid", () => {
  assert.equal(sipDateRangeValid("2026-01-01", null), true);
});

test("sipDateRangeValid: endDate on or after startDate is valid", () => {
  assert.equal(sipDateRangeValid("2026-01-01", "2026-01-01"), true);
  assert.equal(sipDateRangeValid("2026-01-01", "2026-06-30"), true);
});

test("sipDateRangeValid: endDate before startDate is invalid", () => {
  assert.equal(sipDateRangeValid("2026-06-30", "2026-01-01"), false);
});

// ---------- account target type gate (Fix 2: bank/cash can't be a SIP target) ----------
// assertAccountTargetType (DB-backed, not unit-tested here) gates on
// accountCanHaveGoal — the same investment-scheme set accounts.goalId accepts.
// Bank/cash must be rejected: the 90-day forecast (cashflow.ts bankCashTotal)
// aggregates every bank+cash balance, so crediting one as a SIP target would
// fabricate a cash loss instead of moving money between two counted balances.

test("SIP account targets: bank/cash are rejected (would double-count against the cash forecast)", () => {
  assert.equal(accountCanHaveGoal("bank"), false);
  assert.equal(accountCanHaveGoal("cash"), false);
});

test("SIP account targets: liabilities are rejected", () => {
  assert.equal(accountCanHaveGoal("credit_card"), false);
  assert.equal(accountCanHaveGoal("loan"), false);
  assert.equal(accountCanHaveGoal("overdraft"), false);
  assert.equal(accountCanHaveGoal("home_loan_od"), false);
});

test("SIP account targets: investment-scheme accounts (including NPS) remain valid", () => {
  assert.equal(accountCanHaveGoal("investment"), true);
  assert.equal(accountCanHaveGoal("ppf"), true);
  assert.equal(accountCanHaveGoal("epf"), true);
  assert.equal(accountCanHaveGoal("ssy"), true);
  assert.equal(accountCanHaveGoal("nps"), true);
});

// ---------- resolveSipDateRange (Fix 4: resolved-pair validation on partial update) ----------

test("resolveSipDateRange: an untouched field keeps the stored value", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-12-31" }, {}),
    { startDate: "2026-01-01", endDate: "2026-12-31" },
  );
});

test("resolveSipDateRange: an update that only sends endDate resolves against the stored startDate", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-06-01", endDate: null }, { endDate: "2025-12-01" }),
    { startDate: "2026-06-01", endDate: "2025-12-01" },
  );
});

test("resolveSipDateRange: an explicit null endDate clears it (open-ended), distinct from 'not sent'", () => {
  assert.deepEqual(
    resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-06-30" }, { endDate: null }),
    { startDate: "2026-01-01", endDate: null },
  );
});

test("an update that only changes endDate to before the stored startDate resolves to an invalid pair", () => {
  // Neither field is invalid in isolation — only the resolved pair is.
  const resolved = resolveSipDateRange({ startDate: "2026-06-01", endDate: null }, { endDate: "2025-12-01" });
  assert.equal(sipDateRangeValid(resolved.startDate, resolved.endDate), false);
});

test("an update that only changes startDate to after the stored endDate resolves to an invalid pair", () => {
  const resolved = resolveSipDateRange({ startDate: "2026-01-01", endDate: "2026-03-01" }, { startDate: "2026-06-01" });
  assert.equal(sipDateRangeValid(resolved.startDate, resolved.endDate), false);
});

// ---------- resolveSipFundingTarget (payroll+mf_folio resolved-pair validation on partial update) ----------

test("resolveSipFundingTarget: a patch that changes only fundingSource keeps the stored targetKind", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "mf_folio", fundingSource: "bank_debit" },
      { fundingSource: "payroll" },
    ),
    { targetKind: "mf_folio", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: a patch that changes only targetKind keeps the stored fundingSource", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "account", fundingSource: "payroll" },
      { targetKind: "mf_folio" },
    ),
    { targetKind: "mf_folio", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: a patch that changes both uses both new values", () => {
  assert.deepEqual(
    resolveSipFundingTarget(
      { targetKind: "mf_folio", fundingSource: "bank_debit" },
      { targetKind: "account", fundingSource: "payroll" },
    ),
    { targetKind: "account", fundingSource: "payroll" },
  );
});

test("resolveSipFundingTarget: an empty patch keeps both stored values", () => {
  assert.deepEqual(
    resolveSipFundingTarget({ targetKind: "mf_folio", fundingSource: "bank_debit" }, {}),
    { targetKind: "mf_folio", fundingSource: "bank_debit" },
  );
});

// ---------- sipEditOrphansLinks (updateSip: detach installments the edit strands) ----------

test("sipEditOrphansLinks: an empty patch does not orphan anything", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      {},
    ),
    false,
  );
});

test("sipEditOrphansLinks: every field resent unchanged does not orphan anything", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
    ),
    false,
  );
});

test("sipEditOrphansLinks: a changed targetAccountId orphans links", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      { targetAccountId: "acc-2" },
    ),
    true,
  );
});

test("sipEditOrphansLinks: a changed targetKind orphans links", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      { targetKind: "mf_folio" },
    ),
    true,
  );
});

test("sipEditOrphansLinks: a changed fundingSource orphans links", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      { fundingSource: "payroll" },
    ),
    true,
  );
});

test("sipEditOrphansLinks: targetAccountId changed from a uuid to null orphans links", () => {
  assert.equal(
    sipEditOrphansLinks(
      { targetKind: "account", targetAccountId: "acc-1", fundingSource: "bank_debit" },
      { targetAccountId: null },
    ),
    true,
  );
});

// ---------- assertLinkRowsMatched (Fix 2: TOCTOU-safe conditional link) ----------

test("assertLinkRowsMatched: one matched row (the common case) does not throw", () => {
  assert.doesNotThrow(() => assertLinkRowsMatched(1));
});

test("assertLinkRowsMatched: zero matched rows means the conditional UPDATE lost a race — throws 409", () => {
  assert.throws(
    () => assertLinkRowsMatched(0),
    (err: unknown) => err instanceof HttpError && err.statusCode === 409,
  );
});

// ---------- isArchived (Fix 1: archived source/target must be rejected by SIP validation) ----------
// assertBankSource/assertAccountTargetType/ownedHoldingGoal are DB-backed (not
// unit-tested here, same as assertAccountTargetType's type gate above) but all
// three route their archived-rejection through this pure predicate.

test("isArchived: a null archivedAt is not archived", () => {
  assert.equal(isArchived(null), false);
});

test("isArchived: any non-null archivedAt (Date or ISO string) is archived", () => {
  assert.equal(isArchived(new Date("2026-01-01")), true);
  assert.equal(isArchived("2026-01-01T00:00:00.000Z"), true);
});

// ---------- laterInstallmentDate (merging holding_events + transactions installments) ----------

test("laterInstallmentDate: both null yields null", () => {
  assert.equal(laterInstallmentDate(null, null), null);
});

test("laterInstallmentDate: only the holding-event side set returns it", () => {
  assert.equal(laterInstallmentDate("2026-07-05", null), "2026-07-05");
});

test("laterInstallmentDate: only the transaction side set returns it", () => {
  assert.equal(laterInstallmentDate(null, "2026-07-05"), "2026-07-05");
});

test("laterInstallmentDate: both set returns the more recent (greater) date", () => {
  assert.equal(laterInstallmentDate("2026-06-05", "2026-07-05"), "2026-07-05");
  assert.equal(laterInstallmentDate("2026-07-05", "2026-06-05"), "2026-07-05");
});

// ---------- isUniqueViolation (Drizzle wraps driver errors — see lib/errors.ts pgError) ----------

test("isUniqueViolation: a wrapped 23505 with the matching constraint name is true", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "holding_events_sip_date_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), true);
});

test("isUniqueViolation: a wrapped 23505 with a different constraint name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "some_other_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), false);
});

test("isUniqueViolation: a wrapped 23503 (FK, not unique) with the matching name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23503", constraint: "holding_events_sip_date_idx" },
  });
  assert.equal(isUniqueViolation(wrapped, "holding_events_sip_date_idx"), false);
});

test("isUniqueViolation: a non-Postgres error is false", () => {
  assert.equal(isUniqueViolation(new Error("boom"), "holding_events_sip_date_idx"), false);
});

// ---------- isCheckViolation (Drizzle wraps driver errors — see lib/errors.ts pgError) ----------

test("isCheckViolation: a wrapped 23514 with the matching constraint name is true", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23514", constraint: "sips_payroll_requires_account_target" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), true);
});

test("isCheckViolation: a wrapped 23514 with a different constraint name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23514", constraint: "some_other_check" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), false);
});

test("isCheckViolation: a wrapped 23505 (unique, not check) with the matching name is false", () => {
  const wrapped = Object.assign(new Error("query failed"), {
    cause: { code: "23505", constraint: "sips_payroll_requires_account_target" },
  });
  assert.equal(isCheckViolation(wrapped, "sips_payroll_requires_account_target"), false);
});

test("isCheckViolation: a non-Postgres error is false", () => {
  assert.equal(isCheckViolation(new Error("boom"), "sips_payroll_requires_account_target"), false);
});
