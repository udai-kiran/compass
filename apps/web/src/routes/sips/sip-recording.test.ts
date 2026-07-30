import assert from "node:assert/strict";
import test from "node:test";
import type { Sip } from "@compass/shared";
import {
  installmentDraftReady,
  isPositiveDecimal,
  rowIsSubmittable,
  sipPrechecked,
  sipRecordBlock,
  sipRowRank,
} from "./sip-recording.ts";

type SipFixture = Pick<
  Sip,
  "targetKind" | "fundingSource" | "startDate" | "endDate" | "status" | "dueInstallmentDate"
>;

const baseSip: SipFixture = {
  targetKind: "mf_folio",
  fundingSource: "bank_debit",
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  dueInstallmentDate: null,
};

const sipFixture = (overrides: Partial<SipFixture> = {}): SipFixture => ({
  ...baseSip,
  ...overrides,
});

// sipRecordBlock

test("an account-target SIP is blocked as account_target", () => {
  const sip = sipFixture({ targetKind: "account" });
  assert.equal(sipRecordBlock(sip, "2026-03-15"), "account_target");
});

test("an mf_folio SIP marked payroll is blocked as payroll, taking precedence over target checks", () => {
  const sip = sipFixture({ targetKind: "mf_folio", fundingSource: "payroll" });
  assert.equal(sipRecordBlock(sip, "2026-03-15"), "payroll");
});

test("a date before startDate is blocked as before_start", () => {
  const sip = sipFixture({ startDate: "2026-03-15" });
  assert.equal(sipRecordBlock(sip, "2026-03-14"), "before_start");
});

test("a date after endDate is blocked as after_end", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: "2026-03-15" });
  assert.equal(sipRecordBlock(sip, "2026-03-16"), "after_end");
});

test("an in-window mf_folio bank_debit SIP is not blocked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: "2026-06-30" });
  assert.equal(sipRecordBlock(sip, "2026-03-15"), null);
});

test("an open-ended SIP (endDate null) is not blocked far in the future", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null });
  assert.equal(sipRecordBlock(sip, "2099-01-01"), null);
});

test("the exact startDate boundary is not blocked", () => {
  const sip = sipFixture({ startDate: "2026-03-15", endDate: "2026-06-30" });
  assert.equal(sipRecordBlock(sip, "2026-03-15"), null);
});

test("the exact endDate boundary is not blocked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: "2026-06-30" });
  assert.equal(sipRecordBlock(sip, "2026-06-30"), null);
});

// sipPrechecked

test("an active in-window SIP due strictly before the chosen date starts ticked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: "2026-03-05" });
  assert.equal(sipPrechecked(sip, "2026-03-07"), true);
});

test("an active in-window SIP due exactly on the chosen date starts ticked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: "2026-03-07" });
  assert.equal(sipPrechecked(sip, "2026-03-07"), true);
});

test("a SIP with no outstanding installment (dueInstallmentDate null) never starts ticked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: null });
  assert.equal(sipPrechecked(sip, "2026-03-07"), false);
});

test("a SIP whose dueInstallmentDate is after the chosen date does not start ticked", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: "2026-03-10" });
  assert.equal(sipPrechecked(sip, "2026-03-07"), false);
});

test("a paused SIP does not start ticked, even if due", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "paused", dueInstallmentDate: "2026-03-05" });
  assert.equal(sipPrechecked(sip, "2026-03-07"), false);
});

test("a blocked SIP does not start ticked, even if it looks due", () => {
  const sip = sipFixture({ targetKind: "account", status: "active", dueInstallmentDate: "2026-03-05" });
  assert.equal(sipPrechecked(sip, "2026-03-07"), false);
});

// sipRowRank

test("a prechecked SIP ranks 0", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: "2026-03-05" });
  assert.equal(sipRowRank(sip, "2026-03-07"), 0);
});

test("a recordable SIP with nothing due ranks 1", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null, status: "active", dueInstallmentDate: null });
  assert.equal(sipRowRank(sip, "2026-03-07"), 1);
});

test("a blocked SIP ranks 2", () => {
  const sip = sipFixture({ targetKind: "account", status: "active", dueInstallmentDate: null });
  assert.equal(sipRowRank(sip, "2026-03-07"), 2);
});

// rowIsSubmittable

test("a ticked row never attempted (outcome absent) is submittable", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null });
  assert.equal(rowIsSubmittable(sip, "2026-03-15", { include: true }, undefined), true);
});

test("a ticked row already recorded (outcome === null) is not submittable", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null });
  assert.equal(rowIsSubmittable(sip, "2026-03-15", { include: true }, null), false);
});

test("a ticked row with a string outcome (a failed row being retried) is submittable", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null });
  assert.equal(rowIsSubmittable(sip, "2026-03-15", { include: true }, "some error"), true);
});

test("an unticked row is not submittable", () => {
  const sip = sipFixture({ startDate: "2026-01-01", endDate: null });
  assert.equal(rowIsSubmittable(sip, "2026-03-15", { include: false }, undefined), false);
});

test("a ticked row blocked on this date is not submittable", () => {
  const sip = sipFixture({ targetKind: "account" });
  assert.equal(rowIsSubmittable(sip, "2026-03-15", { include: true }, undefined), false);
});

// isPositiveDecimal / installmentDraftReady

test("isPositiveDecimal accepts plain integers, decimals, and leading-dot decimals", () => {
  assert.equal(isPositiveDecimal("1500"), true);
  assert.equal(isPositiveDecimal("1500.50"), true);
  assert.equal(isPositiveDecimal(".5"), true);
});

test("isPositiveDecimal rejects empty, blank, non-numeric, zero, negative, trailing-garbage, comma-grouped, and Infinity strings", () => {
  assert.equal(isPositiveDecimal(""), false);
  assert.equal(isPositiveDecimal("   "), false);
  assert.equal(isPositiveDecimal("abc"), false);
  assert.equal(isPositiveDecimal("0"), false);
  assert.equal(isPositiveDecimal("-5"), false);
  assert.equal(isPositiveDecimal("12abc"), false);
  assert.equal(isPositiveDecimal("1,500"), false);
  assert.equal(isPositiveDecimal("Infinity"), false);
});

test("installmentDraftReady is true only when both fields are positive decimals", () => {
  assert.equal(installmentDraftReady({ amountR: "1500", valueInput: "10.25" }), true);
  assert.equal(installmentDraftReady({ amountR: "", valueInput: "10.25" }), false);
  assert.equal(installmentDraftReady({ amountR: "1500", valueInput: "0" }), false);
  assert.equal(installmentDraftReady({ amountR: "1,500", valueInput: "10.25" }), false);
});
