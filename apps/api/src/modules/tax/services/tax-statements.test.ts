/**
 * tax-statements.test.ts — unit tests for task 13.13: the deterministic
 * AIS/26AS/Form-16 matcher plus its privacy guard (PAN never echoed).
 * Amounts in paise.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveUnmatchedLedgerEvents,
  maskPayerTan,
  matchStatementLines,
  type MatchCandidateEvent,
  type MatchableLine,
} from "./tax-statements.ts";

function line(over: Partial<MatchableLine> = {}): MatchableLine {
  return {
    section: "194A",
    category: "interest",
    payerName: "HDFC Bank",
    payerTan: "DELH01234A",
    grossPaise: 1_000_000,
    tdsPaise: 100_000,
    ...over,
  };
}

function event(id: string, over: Partial<MatchCandidateEvent> = {}): MatchCandidateEvent {
  return {
    id,
    incomeKind: "interest",
    section: "194A",
    payerName: "HDFC Bank",
    payerTan: "DELH01234A",
    grossPaise: 1_000_000,
    tdsPaise: 100_000,
    ...over,
  };
}

describe("matchStatementLines", () => {
  it("exact category+section+TAN+amount → matched, event consumed", () => {
    const v = matchStatementLines([line()], [event("e1")]);
    assert.deepEqual(v, [{ status: "matched", matchedIncomeEventId: "e1" }]);
  });

  it("same identity but different amount → amount_mismatch pointing at the event", () => {
    const v = matchStatementLines([line({ grossPaise: 900_000 })], [event("e1")]);
    assert.deepEqual(v, [{ status: "amount_mismatch", matchedIncomeEventId: "e1" }]);
  });

  it("equal gross but different TDS is an amount_mismatch, not a match", () => {
    // The bank reported ₹10k TDS; the ledger recorded ₹5k. Same gross, still
    // a discrepancy review must see.
    const v = matchStatementLines(
      [line({ tdsPaise: 100_000 })],
      [event("e1", { tdsPaise: 50_000 })],
    );
    assert.deepEqual(v, [{ status: "amount_mismatch", matchedIncomeEventId: "e1" }]);
  });

  it("matching requires BOTH gross and TDS to be equal", () => {
    const v = matchStatementLines(
      [line({ grossPaise: 900_000 })],
      [event("e1", { tdsPaise: 50_000 })],
    );
    assert.deepEqual(v, [{ status: "amount_mismatch", matchedIncomeEventId: "e1" }]);
  });

  it("no qualifying event → unmatched with no event id", () => {
    const v = matchStatementLines([line()], []);
    assert.deepEqual(v, [{ status: "unmatched", matchedIncomeEventId: null }]);
  });

  it("category mismatch never matches, even with identical identity and amount", () => {
    const v = matchStatementLines(
      [line()],
      [event("e1", { incomeKind: "dividend" })],
    );
    assert.deepEqual(v, [{ status: "unmatched", matchedIncomeEventId: null }]);
  });

  it("section mismatch blocks the match when both sides state sections", () => {
    const v = matchStatementLines(
      [line({ section: "194A" })],
      [event("e1", { section: "192" })],
    );
    assert.deepEqual(v, [{ status: "unmatched", matchedIncomeEventId: null }]);
  });

  it("a null line section matches any event section", () => {
    const v = matchStatementLines(
      [line({ section: null })],
      [event("e1", { section: "194-I" })],
    );
    assert.deepEqual(v, [{ status: "matched", matchedIncomeEventId: "e1" }]);
  });

  it("identity binds on normalised name when TANs are absent; case/space-insensitive", () => {
    const v = matchStatementLines(
      [line({ payerTan: null, payerName: "hdfc  bank ltd" })],
      [event("e1", { payerTan: null, payerName: "HDFC Bank Ltd" })],
    );
    assert.deepEqual(v, [{ status: "matched", matchedIncomeEventId: "e1" }]);
  });

  it("no TAN on either side and no name on one side ⇒ anonymous lines stay unmatched", () => {
    // An AIS line with no payer at all must not be force-matched to whatever
    // same-category event exists.
    const v = matchStatementLines(
      [line({ payerName: null, payerTan: null })],
      [event("e1")],
    );
    assert.deepEqual(v, [{ status: "unmatched", matchedIncomeEventId: null }]);
  });

  it("matching is one-to-one: two identical lines vs one event yield match + unmatched", () => {
    const v = matchStatementLines(
      [line(), line()],
      [event("e1")],
    );
    assert.deepEqual(v, [
      { status: "matched", matchedIncomeEventId: "e1" },
      { status: "unmatched", matchedIncomeEventId: null },
    ]);
  });

  it("an exact-gross event wins over an earlier mismatching candidate", () => {
    const v = matchStatementLines(
      [line({ grossPaise: 2_000_000 })],
      [event("e1", { grossPaise: 1_500_000 }), event("e2", { grossPaise: 2_000_000 })],
    );
    assert.deepEqual(v, [{ status: "matched", matchedIncomeEventId: "e2" }]);
  });

  it("partial documents are fine: empty lines produce empty verdicts", () => {
    assert.deepEqual(matchStatementLines([], [event("e1")]), []);
  });

  it("exact matching is global: an earlier line never steals a later line's exact event", () => {
    // Regression (Codex round-2 finding 7): the old greedy matcher paired lineA
    // with e1 as amount_mismatch, forcing lineB — which matches e1 EXACTLY —
    // into an amount_mismatch against e2. Exact matches must claim their events
    // before any mismatch pairing happens.
    const v = matchStatementLines(
      [
        line({ grossPaise: 1_500_000 }), // qualifies for both, exact with neither
        line({}),                        // exact only with e1
      ],
      [event("e1"), event("e2", { grossPaise: 2_000_000 })],
    );
    assert.deepEqual(v, [
      { status: "amount_mismatch", matchedIncomeEventId: "e2" },
      { status: "matched", matchedIncomeEventId: "e1" },
    ]);
  });
});

// ─── Privacy guard: PAN never echoed ──────────────────────────────────────────

// ─── Ledger-only discrepancies: reviewable line items, not just a count ──────

describe("deriveUnmatchedLedgerEvents", () => {
  it("returns events no line's matchedIncomeEventId references", () => {
    const events = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
    const lines = [{ matchedIncomeEventId: "e1" }, { matchedIncomeEventId: null }];
    assert.deepEqual(deriveUnmatchedLedgerEvents(lines, events), [{ id: "e2" }, { id: "e3" }]);
  });

  it("all events consumed → empty", () => {
    const events = [{ id: "e1" }, { id: "e2" }];
    const lines = [{ matchedIncomeEventId: "e1" }, { matchedIncomeEventId: "e2" }];
    assert.deepEqual(deriveUnmatchedLedgerEvents(lines, events), []);
  });

  it("no lines at all → every event is unmatched", () => {
    const events = [{ id: "e1" }, { id: "e2" }];
    assert.deepEqual(deriveUnmatchedLedgerEvents([], events), events);
  });

  it("a line's matchedIncomeEventId pointing at a non-existent event id is harmless", () => {
    const events = [{ id: "e1" }];
    const lines = [{ matchedIncomeEventId: "e-does-not-exist" }];
    assert.deepEqual(deriveUnmatchedLedgerEvents(lines, events), [{ id: "e1" }]);
  });

  // Regression: getDetail()'s `unmatchedLedgerCount` must always equal
  // `unmatchedLedgerEvents.length` for the DETAIL response, never the
  // persisted `taxStatements.unmatchedLedgerCount` column from toSummary(row)
  // — see tax-statements.ts, the `getDetail()` return statement, which spreads
  // `...toSummary(row)` and then explicitly overrides `unmatchedLedgerCount:
  // unmatchedLedgerEvents.length` so the override wins over the spread. A
  // never-reconciled statement is the sharpest case: the persisted column is
  // still at its 0 default (reconcileInTx() never ran), while every line's
  // matchedIncomeEventId is null, so every candidate event is "unmatched".
  // getDetail() itself is DB-backed and untestable here without a live
  // Postgres, so this exercises the pure helper it calls directly and asserts
  // count-vs-list consistency the way getDetail()'s response must hold.
  it("never-reconciled statement: every line unmatched (null matchedIncomeEventId) → count matches full event list, not the stale persisted 0", () => {
    // Mix of line statuses a real reconcile could have stamped, but here every
    // line is as `createTaxStatement()` leaves it before any reconcile call.
    const lines = [
      { matchedIncomeEventId: null }, // would-be "unmatched" line
      { matchedIncomeEventId: null }, // would-be "amount_mismatch" line — still null: mismatches don't consume identity the way matches do until reconcile stamps it, but even a stamped mismatch still doesn't null out an event id, so this models the pre-reconcile state precisely
      { matchedIncomeEventId: null },
    ];
    const events = [{ id: "e1" }, { id: "e2" }, { id: "e3" }, { id: "e4" }];

    const unmatchedLedgerEvents = deriveUnmatchedLedgerEvents(lines, events);
    const unmatchedLedgerCount = unmatchedLedgerEvents.length; // what getDetail() does

    // Live derivation sees ALL events as unmatched, since no line consumed one.
    assert.deepEqual(unmatchedLedgerEvents, events);
    assert.equal(unmatchedLedgerCount, 4);
    // The persisted column's default is 0 — proving the two sources disagree
    // when a statement has never been reconciled, which is exactly why
    // getDetail() must not use the persisted value for this field.
    const staleFromPersistedColumn = 0;
    assert.notEqual(unmatchedLedgerCount, staleFromPersistedColumn);
  });

  it("mix of matched/unmatched/mismatched lines plus a post-reconcile ledger addition: count derives live, not from a stale persisted counter", () => {
    // Simulates a statement reconciled earlier (some lines carry a
    // matchedIncomeEventId, an amount_mismatch line still points at the event
    // it disagreed with) plus a new income event added to the ledger AFTER
    // that reconcile — e2 — which the persisted column never saw.
    const lines = [
      { matchedIncomeEventId: "e1" }, // matched
      { matchedIncomeEventId: "e3" }, // amount_mismatch — still references its event
      { matchedIncomeEventId: null }, // unmatched
    ];
    const events = [{ id: "e1" }, { id: "e2" }, { id: "e3" }, { id: "e4" }];

    const unmatchedLedgerEvents = deriveUnmatchedLedgerEvents(lines, events);
    const unmatchedLedgerCount = unmatchedLedgerEvents.length;

    assert.deepEqual(unmatchedLedgerEvents, [{ id: "e2" }, { id: "e4" }]);
    assert.equal(unmatchedLedgerCount, 2);
  });
});

describe("maskPayerTan", () => {
  it("masks PAN-shaped identifiers out of API echoes", () => {
    assert.equal(maskPayerTan("ABCDE1234F"), null);
    assert.equal(maskPayerTan("abcde1234f"), null);
    assert.equal(maskPayerTan(null), null);
  });

  it("passes real TANs through untouched", () => {
    assert.equal(maskPayerTan("DELH01234A"), "DELH01234A");
    // A TAN is 4 letters + 5 digits + 1 letter — distinct from PAN shape.
    assert.equal(maskPayerTan("MUMT12345B"), "MUMT12345B");
  });
});
