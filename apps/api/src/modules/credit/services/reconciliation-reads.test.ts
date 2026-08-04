import assert from "node:assert/strict";
import test from "node:test";
import { driftPresentation, dueDrift, summarizeStatementLines } from "./reconciliation-reads.ts";

// All 13 tests below are pure functions over already-computed numbers — no
// DB/Postgres connection is used or needed anywhere in this file (verified by
// direct read during the tasks/008-migrate-credit split: neither
// summarizeStatementLines nor dueDrift/driftPresentation touch a `db` handle).

test("summarizeStatementLines: a line tied to a live ledger transaction counts as cleared", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 52900, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 3413400, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 3466300 }, lines);
  assert.strictEqual(stats.matchedCount, 1);
  assert.strictEqual(stats.unmatchedCount, 1);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 3466300);
  assert.strictEqual(stats.matchedPaise, 52900);
  assert.deepEqual(stats.matchedTxnIds, ["t1"]);
});

test("summarizeStatementLines: every line linked leaves nothing to review", () => {
  // This is the state card 2862 should reach once its accepted lines are
  // re-checked — the extractor stored 0/16 because it matched against an empty ledger.
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 200000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 3, lineDebitPaise: 600000 }, lines);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 600000);
  assert.strictEqual(stats.matchedPaise, stats.lineDebitPaise);
});

test("summarizeStatementLines: a cleared refund does not shrink the spend delta", () => {
  const lines = [
    { direction: "credit" as const, amountPaise: 4559100, ledgerTxnId: "t9" },
    { direction: "debit" as const, amountPaise: 519900, ledgerTxnId: null },
  ];
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 519900 }, lines);
  assert.strictEqual(stats.lineDebitPaise, 519900);
  assert.strictEqual(stats.matchedCount, 1);
  // The credit must NOT count as cleared spend.
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: the issuer's own totals survive a recompute that sees no lines", () => {
  // Card 3623's live state: the extractor skipped both lines as dedupe hits, so
  // recounting from surviving rows would wipe what the issuer actually billed.
  const stats = summarizeStatementLines({ lineCount: 2, lineDebitPaise: 14900 }, []);
  assert.strictEqual(stats.lineCount, 2);
  assert.strictEqual(stats.lineDebitPaise, 14900);
  assert.strictEqual(stats.matchedCount, 0);
  assert.strictEqual(stats.matchedPaise, 0);
  assert.strictEqual(stats.unmatchedCount, 2);
  assert.deepEqual(stats.matchedTxnIds, []);
});

test("summarizeStatementLines: a partly-deduplicated statement keeps the issuer's line count", () => {
  // Card 0515's live shape: the issuer billed 4 lines, but only 3 survived (the
  // fourth was never stored because its spend was already captured from an alert).
  // It reads as unmatched — conservative, never a false all-clear.
  const lines = [
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 300000, ledgerTxnId: "t2" },
    { direction: "debit" as const, amountPaise: 417115, ledgerTxnId: "t3" },
  ];
  const stats = summarizeStatementLines({ lineCount: 4, lineDebitPaise: 1173657 }, lines);
  assert.strictEqual(stats.lineCount, 4);
  assert.strictEqual(stats.lineDebitPaise, 1173657);
  assert.strictEqual(stats.matchedCount, 3);
  assert.strictEqual(stats.unmatchedCount, 1);
});

test("summarizeStatementLines: more links than the issuer listed never yields a negative backlog", () => {
  const lines = [
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t1" },
    { direction: "debit" as const, amountPaise: 100000, ledgerTxnId: "t2" },
  ];
  const stats = summarizeStatementLines({ lineCount: 1, lineDebitPaise: 100000 }, lines);
  assert.strictEqual(stats.unmatchedCount, 0);
  assert.strictEqual(stats.matchedCount, 2);
});

// ---------- dueDrift / driftPresentation (P1, tasks/cc-recon-01-statement-drift) ----------

test("dueDrift: null unless both totalDuePaise and ledgerDuePaise are known", () => {
  assert.strictEqual(dueDrift(null, null), null);
  assert.strictEqual(dueDrift(null, 100000), null);
  assert.strictEqual(dueDrift(100000, null), null);
});

test("dueDrift: totalDue − ledgerDue, positive/negative/zero", () => {
  assert.strictEqual(dueDrift(100000, 40000), 60000);
  assert.strictEqual(dueDrift(40000, 100000), -60000);
  assert.strictEqual(dueDrift(100000, 100000), 0);
});

test("driftPresentation: null drift or null ledgerDue → none", () => {
  assert.deepEqual(driftPresentation(null, 100000), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
  assert.deepEqual(driftPresentation(60000, null), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: positive drift with a nonnegative ledger due is a shortfall — carries the hint, suppresses the badge", () => {
  assert.deepEqual(driftPresentation(60000, 40000), {
    kind: "shortfall",
    carryForwardHint: true,
    suppressCleared: true,
  });
});

test("driftPresentation: a negative ledger due is `credit`, evaluated BEFORE the drift sign — never a shortfall", () => {
  // totalDue 0, ledgerDue −₹1,000 → dueDrift is +100000 (a plain subtraction would
  // call this a shortfall), but the ledger holds a credit balance, not a gap.
  assert.deepEqual(driftPresentation(100000, -100000), {
    kind: "credit",
    carryForwardHint: false,
    suppressCleared: false,
  });
  // Even a "negative" drift alongside a negative ledger due stays `credit`.
  assert.deepEqual(driftPresentation(-30000, -100000), {
    kind: "credit",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: negative drift with a nonnegative ledger due is a surplus — no hint, badge kept", () => {
  assert.deepEqual(driftPresentation(-60000, 40000), {
    kind: "surplus",
    carryForwardHint: false,
    suppressCleared: false,
  });
});

test("driftPresentation: zero drift is none", () => {
  assert.deepEqual(driftPresentation(0, 40000), {
    kind: "none",
    carryForwardHint: false,
    suppressCleared: false,
  });
});
