import { test } from "node:test";
import assert from "node:assert/strict";
import {
  costBasis,
  holdingArchiveConflictsWithSip,
  holdingGoalEditConflictsWithSip,
  nextSeq,
  sipTargetHoldingArchiveBlockedMessage,
  sipTargetHoldingBlockedMessage,
  unitsHeld,
} from "./holdings.ts";

const buy = (date: string, units: number, amountPaise: number) => ({ type: "buy", date, units, amountPaise });
const sell = (date: string, units: number, amountPaise: number) => ({ type: "sell", date, units, amountPaise });
const dividend = (date: string, amountPaise: number) => ({ type: "dividend", date, units: null, amountPaise });

test("cost basis after a profitable sale stays positive, not negative", () => {
  // Buy 100 units @ ₹100 = ₹10,000; sell 40 @ ₹150 = ₹6,000 proceeds.
  // Raw buy-minus-sell cash flow would be 10,000 − 6,000 = ₹4,000 and could go
  // negative on a bigger gain. Remaining cost basis is 60 units × ₹100 = ₹6,000.
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 40, 600_000)]);
  assert.equal(cb.remainingCostPaise, 600_000);
  assert.equal(cb.units, 60);
  // Realized = proceeds − average cost of units sold = 6,000 − (40 × ₹100) = ₹2,000.
  assert.equal(cb.realizedPaise, 200_000);
});

test("selling everything zeroes the cost basis and books the full gain", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 100, 1_500_000)]);
  assert.equal(cb.remainingCostPaise, 0);
  assert.equal(cb.units, 0);
  assert.equal(cb.realizedPaise, 500_000);
});

test("events are ordered by date, not input order", () => {
  // A sell handed in before its buy must still price against the buy.
  const cb = costBasis([sell("2026-06-01", 40, 600_000), buy("2026-01-01", 100, 1_000_000)]);
  assert.equal(cb.remainingCostPaise, 600_000);
  assert.equal(cb.units, 60);
});

test("dividends never touch cost basis or units", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), dividend("2026-03-01", 5_000)]);
  assert.equal(cb.remainingCostPaise, 1_000_000);
  assert.equal(cb.units, 100);
  assert.equal(cb.realizedPaise, 0);
});

test("a sell larger than units held cannot drive cost basis or units negative", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 150, 900_000)]);
  assert.equal(cb.units, 0);
  assert.equal(cb.remainingCostPaise, 0);
});

test("units held still tallies buys, sells, and cash dividends", () => {
  assert.equal(unitsHeld([buy("2026-01-01", 100, 1), sell("2026-02-01", 30, 1), dividend("2026-03-01", 1)]), 70);
});

// ---------- holdingGoalEditConflictsWithSip (Fix 1: asset-edit vs SIP-invariant guard) ----------

test("holdingGoalEditConflictsWithSip: a goalId change on a SIP-targeted holding is rejected", () => {
  assert.equal(holdingGoalEditConflictsWithSip({ goalId: "goal-2" }, { goalId: "goal-1" }, 2), true);
});

test("holdingGoalEditConflictsWithSip: unmapping (goalId -> null) a SIP-targeted holding is rejected", () => {
  assert.equal(holdingGoalEditConflictsWithSip({ goalId: null }, { goalId: "goal-1" }, 1), true);
});

test("holdingGoalEditConflictsWithSip: a same-value goalId patch is allowed (no-op)", () => {
  assert.equal(holdingGoalEditConflictsWithSip({ goalId: "goal-1" }, { goalId: "goal-1" }, 5), false);
});

test("holdingGoalEditConflictsWithSip: an untouched goalId field (absent from patch) is allowed", () => {
  assert.equal(holdingGoalEditConflictsWithSip({}, { goalId: "goal-1" }, 5), false);
});

test("holdingGoalEditConflictsWithSip: a goalId change is allowed when no SIP targets the holding", () => {
  assert.equal(holdingGoalEditConflictsWithSip({ goalId: "goal-2" }, { goalId: "goal-1" }, 0), false);
});

test("holdingGoalEditConflictsWithSip: paused SIPs still block — the caller counts every SIP, not just active", () => {
  // The caller (updateHolding) queries sips.targetHoldingId without filtering
  // on status, so a paused-only reference still surfaces as a non-zero count.
  assert.equal(holdingGoalEditConflictsWithSip({ goalId: null }, { goalId: "goal-1" }, 1), true);
});

test("sipTargetHoldingBlockedMessage: names the SIP count", () => {
  assert.equal(
    sipTargetHoldingBlockedMessage(1),
    "Holding is the target of 1 SIP(s) for this goal — delete or repoint them first",
  );
  assert.equal(
    sipTargetHoldingBlockedMessage(3),
    "Holding is the target of 3 SIP(s) for this goal — delete or repoint them first",
  );
});

// ---------- holdingArchiveConflictsWithSip (Fix 1: archived holdings can't stay a SIP target) ----------

test("holdingArchiveConflictsWithSip: archiving a SIP-targeted holding is rejected", () => {
  assert.equal(holdingArchiveConflictsWithSip({ archived: true }, { archivedAt: null }, 1), true);
});

test("holdingArchiveConflictsWithSip: archiving a SIP-targeted holding with a paused-only reference still blocks", () => {
  // The caller (updateHolding) queries sips.targetHoldingId without filtering
  // on status, so a paused-only reference still surfaces as a non-zero count.
  assert.equal(holdingArchiveConflictsWithSip({ archived: true }, { archivedAt: null }, 1), true);
});

test("holdingArchiveConflictsWithSip: archiving with no SIP references at all is allowed", () => {
  assert.equal(holdingArchiveConflictsWithSip({ archived: true }, { archivedAt: null }, 0), false);
});

test("holdingArchiveConflictsWithSip: an already-archived holding re-sent as archived:true is a no-op, not re-blocked", () => {
  assert.equal(holdingArchiveConflictsWithSip({ archived: true }, { archivedAt: new Date("2026-01-01") }, 1), false);
});

test("holdingArchiveConflictsWithSip: unarchiving a SIP-referenced holding is never blocked", () => {
  assert.equal(holdingArchiveConflictsWithSip({ archived: false }, { archivedAt: new Date("2026-01-01") }, 1), false);
});

test("holdingArchiveConflictsWithSip: an unrelated patch with archived left untouched is unaffected", () => {
  assert.equal(holdingArchiveConflictsWithSip({}, { archivedAt: null }, 1), false);
});

test("sipTargetHoldingArchiveBlockedMessage: names the SIP count", () => {
  assert.equal(
    sipTargetHoldingArchiveBlockedMessage(1),
    "Holding is the target of 1 SIP(s) — delete or repoint them before archiving",
  );
  assert.equal(
    sipTargetHoldingArchiveBlockedMessage(2),
    "Holding is the target of 2 SIP(s) — delete or repoint them before archiving",
  );
});

// ---------- nextSeq ----------

test("nextSeq: no events that day starts at 0", () => {
  assert.equal(nextSeq([]), 0);
});

test("nextSeq: events with seq 0 and 1 continue at 2", () => {
  assert.equal(nextSeq([{ seq: 0 }, { seq: 1 }]), 2);
});

test("nextSeq: a single event with seq null is treated as unsequenced (-1), so the next is 0", () => {
  assert.equal(nextSeq([{ seq: null }]), 0);
});

test("nextSeq: a mix of null and 2 takes the max, landing at 3", () => {
  assert.equal(nextSeq([{ seq: null }, { seq: 2 }]), 3);
});

test("nextSeq: out-of-order input still takes the MAX, not the last or the count", () => {
  assert.equal(nextSeq([{ seq: 2 }, { seq: 0 }, { seq: 1 }]), 3);
});

test("nextSeq: a single event with seq 5 (a gap) continues at 6", () => {
  assert.equal(nextSeq([{ seq: 5 }]), 6);
});
