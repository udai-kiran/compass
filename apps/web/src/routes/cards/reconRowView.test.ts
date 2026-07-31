import assert from "node:assert/strict";
import test from "node:test";
import type { StatementReconciliation } from "@compass/shared";
import { reconRowView } from "./reconRowView.ts";

const cycle = (overrides: Partial<StatementReconciliation> = {}): StatementReconciliation => ({
  id: "b3fc96d0-0000-4000-8000-000000000001",
  accountId: "b3fc96d0-0000-4000-8000-000000000002",
  period: "2026-07",
  statementDate: "2026-07-20",
  totalDuePaise: 7099600,
  minDuePaise: 354980,
  rewardClosing: 1200,
  lineCount: 16,
  lineDebitPaise: 6500000,
  matchedCount: 16,
  matchedPaise: 6500000,
  unmatchedCount: 0,
  deltaPaise: 0,
  ledgerDuePaise: 2540475,
  dueDriftPaise: 4559125,
  updatedAt: "2026-07-21T00:00:00.000Z",
  ...overrides,
});

test("positive drift (shortfall): amber warning with amounts, carry hint, badge suppressed", () => {
  const view = reconRowView(cycle());
  assert.deepEqual(view.driftLine, {
    tone: "amber",
    text: "₹45,591.25 more due than the ledger shows (statement ₹70,996.00 · ledger ₹25,404.75)",
  });
  assert.equal(view.carryHint, "balance carried from before this card was tracked?");
  assert.equal(view.showClearedBadge, false);
  assert.equal(view.badgeTitle, "all statement lines matched");
});

test("negative drift (surplus): muted text, no hint, badge kept when lines are fully matched", () => {
  const view = reconRowView(cycle({ totalDuePaise: 100000, ledgerDuePaise: 150000, dueDriftPaise: -50000 }));
  assert.deepEqual(view.driftLine, { tone: "muted", text: "ledger shows ₹500.00 more than the statement" });
  assert.equal(view.carryHint, null);
  assert.equal(view.showClearedBadge, true);
});

test("zero drift: no drift line, no hint, badge kept when lines are fully matched", () => {
  const view = reconRowView(cycle({ totalDuePaise: 100000, ledgerDuePaise: 100000, dueDriftPaise: 0 }));
  assert.equal(view.driftLine, null);
  assert.equal(view.carryHint, null);
  assert.equal(view.showClearedBadge, true);
});

test("null drift (no statement date): rendering unchanged — no drift line, badge kept when fully cleared", () => {
  const view = reconRowView(cycle({ statementDate: null, totalDuePaise: null, ledgerDuePaise: null, dueDriftPaise: null }));
  assert.equal(view.driftLine, null);
  assert.equal(view.carryHint, null);
  assert.equal(view.showClearedBadge, true);
});

test("null drift (total due unknown, ledger due known): rendering unchanged", () => {
  const view = reconRowView(cycle({ totalDuePaise: null, dueDriftPaise: null }));
  assert.equal(view.driftLine, null);
  assert.equal(view.carryHint, null);
});

test("credit-balance case: muted credit copy, no hint, badge kept — never labeled a shortfall", () => {
  const view = reconRowView(cycle({ totalDuePaise: 0, ledgerDuePaise: -100000, dueDriftPaise: 100000 }));
  assert.deepEqual(view.driftLine, {
    tone: "muted",
    text: "Ledger shows this card ₹1,000.00 in credit; statement due ₹0.00",
  });
  assert.equal(view.carryHint, null);
  assert.equal(view.showClearedBadge, true);
});

test("credit-balance case does not show the badge when lines are not fully matched", () => {
  const view = reconRowView(
    cycle({ totalDuePaise: 0, ledgerDuePaise: -100000, dueDriftPaise: 100000, unmatchedCount: 2 }),
  );
  assert.equal(view.showClearedBadge, false);
});

test("shortfall suppresses the badge even when lineCount/unmatchedCount would otherwise show it", () => {
  const view = reconRowView(cycle({ unmatchedCount: 0, lineCount: 16 }));
  assert.equal(view.showClearedBadge, false);
});

test("badge is never shown when there are no lines at all, regardless of drift", () => {
  const view = reconRowView(cycle({ lineCount: 0, unmatchedCount: 0, totalDuePaise: null, dueDriftPaise: null }));
  assert.equal(view.showClearedBadge, false);
});
