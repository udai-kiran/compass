import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessAccountEditAgainstSips,
  last4Of,
  openingBalanceRow,
  sipSourceBlockedMessage,
  sipTargetArchiveBlockedMessage,
  sipTargetGoalBlockedMessage,
  sipTargetTypeBlockedMessage,
} from "./accounts.ts";

test("last 4 is taken from the tail of the full number", () => {
  // Indian account numbers vary from 9 to 18 digits, so the tail is the only
  // stable place to take it from.
  assert.equal(last4Of("50100123453510"), "3510");
  assert.equal(last4Of("123456789"), "6789");
  assert.equal(last4Of("123456789012345678"), "5678");
});

test("last 4 of a leading-zero tail keeps the zeros", () => {
  // Going via Number() would turn "0042" into 42 and show •••• 42.
  assert.equal(last4Of("50100120042"), "0042");
  assert.equal(last4Of("5010012000"), "2000");
});

test("last 4 needs four digits to exist", () => {
  assert.equal(last4Of("1234"), "1234");
  assert.equal(last4Of("123"), null);
  assert.equal(last4Of(""), null);
});

test("a bank/cash opening balance becomes an 'Opening balance' ledger row", () => {
  const row = openingBalanceRow({
    userId: "u1",
    accountId: "a1",
    type: "bank",
    openingBalancePaise: 50_000_00,
    date: "2025-04-01",
  });
  assert.deepEqual(row, {
    userId: "u1",
    accountId: "a1",
    date: "2025-04-01",
    amountPaise: 50_000_00,
    merchant: "Opening balance",
    isOpening: true,
  });
  // cash too
  assert.equal(
    openingBalanceRow({ userId: "u1", accountId: "a2", type: "cash", openingBalancePaise: 6000_00, date: "2025-04-01" })?.isOpening,
    true,
  );
});

test("no opening row for a zero balance or a non bank/cash type", () => {
  const base = { userId: "u1", accountId: "a1", date: "2025-04-01" as const };
  // zero balance → nothing to seed
  assert.equal(openingBalanceRow({ ...base, type: "bank", openingBalancePaise: 0 }), null);
  // cards/loans/schemes keep their opening balance on the column, not the ledger
  assert.equal(openingBalanceRow({ ...base, type: "credit_card", openingBalancePaise: -1000_00 }), null);
  assert.equal(openingBalanceRow({ ...base, type: "ppf", openingBalancePaise: 92_000_00 }), null);
  assert.equal(openingBalanceRow({ ...base, type: "investment", openingBalancePaise: 10_000_00 }), null);
});

test("sipSourceBlockedMessage: names the SIP count so the delete guard reads like the transaction-count check", () => {
  assert.equal(
    sipSourceBlockedMessage(1),
    "Account is the source of 1 SIP(s) — pause and delete them or repoint them first",
  );
  assert.equal(
    sipSourceBlockedMessage(3),
    "Account is the source of 3 SIP(s) — pause and delete them or repoint them first",
  );
});

// ---------- assessAccountEditAgainstSips (Fix 1: asset-edit vs SIP-invariant guard) ----------

const noRefs = { targetSipCount: 0, sourceSipCount: 0 };

test("assessAccountEditAgainstSips: a goalId change on a SIP-targeted account is rejected", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  const blocked = assessAccountEditAgainstSips(
    { goalId: "goal-2" },
    current,
    { targetSipCount: 2, sourceSipCount: 0 },
  );
  assert.equal(blocked, sipTargetGoalBlockedMessage(2));
});

test("assessAccountEditAgainstSips: unmapping (goalId -> null) a SIP-targeted account is rejected", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ goalId: null }, current, { targetSipCount: 1, sourceSipCount: 0 });
  assert.equal(blocked, sipTargetGoalBlockedMessage(1));
});

test("assessAccountEditAgainstSips: a same-value goalId patch is allowed (no-op)", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(
    assessAccountEditAgainstSips({ goalId: "goal-1" }, current, { targetSipCount: 5, sourceSipCount: 0 }),
    null,
  );
});

test("assessAccountEditAgainstSips: an untouched goalId field (absent from patch) is allowed", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({}, current, { targetSipCount: 5, sourceSipCount: 0 }), null);
});

test("assessAccountEditAgainstSips: an unrelated field edit (no type/goalId in patch) is allowed", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({}, current, { targetSipCount: 3, sourceSipCount: 2 }), null);
});

test("assessAccountEditAgainstSips: a type change to bank on a SIP-targeted account is rejected", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ type: "bank" }, current, { targetSipCount: 1, sourceSipCount: 0 });
  assert.equal(blocked, sipTargetTypeBlockedMessage(1));
});

test("assessAccountEditAgainstSips: a type change between two goal-eligible types on a SIP target is allowed", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({ type: "ppf" }, current, { targetSipCount: 1, sourceSipCount: 0 }), null);
});

test("assessAccountEditAgainstSips: a type change away from bank on a SIP source account is rejected", () => {
  const current = { type: "bank" as const, goalId: null, archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ type: "cash" }, current, { targetSipCount: 0, sourceSipCount: 2 });
  assert.equal(blocked, sipSourceBlockedMessage(2));
});

test("assessAccountEditAgainstSips: a type change that keeps the account a bank account is allowed even as a SIP source", () => {
  const current = { type: "bank" as const, goalId: null, archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({ type: "bank" }, current, { targetSipCount: 0, sourceSipCount: 3 }), null);
});

test("assessAccountEditAgainstSips: no SIP references at all never blocks the edit", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({ type: "bank", goalId: null }, current, noRefs), null);
});

test("assessAccountEditAgainstSips: paused SIPs still block — the caller counts active and paused alike", () => {
  // The caller (updateAccount) queries sips without filtering on status, so a
  // paused-only reference still surfaces as a non-zero count here.
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ goalId: null }, current, { targetSipCount: 1, sourceSipCount: 0 });
  assert.equal(blocked, sipTargetGoalBlockedMessage(1));
});

// ---------- assessAccountEditAgainstSips archiving (Fix 1: archived assets can't stay a SIP source/target) ----------

test("assessAccountEditAgainstSips: archiving a SIP-targeted account is rejected", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ archived: true }, current, { targetSipCount: 1, sourceSipCount: 0 });
  assert.equal(blocked, sipTargetArchiveBlockedMessage(1));
});

test("assessAccountEditAgainstSips: archiving a SIP-source account is rejected", () => {
  const current = { type: "bank" as const, goalId: null, archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ archived: true }, current, { targetSipCount: 0, sourceSipCount: 2 });
  assert.equal(blocked, sipSourceBlockedMessage(2));
});

test("assessAccountEditAgainstSips: archiving a SIP-referenced account paused (only) still blocks", () => {
  const current = { type: "bank" as const, goalId: null, archivedAt: null };
  const blocked = assessAccountEditAgainstSips({ archived: true }, current, { targetSipCount: 0, sourceSipCount: 1 });
  assert.equal(blocked, sipSourceBlockedMessage(1));
});

test("assessAccountEditAgainstSips: archiving with no SIP references at all is allowed", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({ archived: true }, current, noRefs), null);
});

test("assessAccountEditAgainstSips: an already-archived account re-sent as archived:true is a no-op, not re-blocked", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: new Date("2026-01-01") };
  assert.equal(
    assessAccountEditAgainstSips({ archived: true }, current, { targetSipCount: 1, sourceSipCount: 0 }),
    null,
  );
});

test("assessAccountEditAgainstSips: unarchiving a SIP-referenced account is never blocked", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: new Date("2026-01-01") };
  assert.equal(
    assessAccountEditAgainstSips({ archived: false }, current, { targetSipCount: 1, sourceSipCount: 0 }),
    null,
  );
});

test("assessAccountEditAgainstSips: an unarchived edit with archived left untouched is unaffected by the archive guard", () => {
  const current = { type: "investment" as const, goalId: "goal-1", archivedAt: null };
  assert.equal(assessAccountEditAgainstSips({ goalId: "goal-1" }, current, { targetSipCount: 1, sourceSipCount: 0 }), null);
});

test("sipTargetArchiveBlockedMessage: names the SIP count", () => {
  assert.equal(
    sipTargetArchiveBlockedMessage(1),
    "Account is the target of 1 SIP(s) — delete or repoint them before archiving",
  );
  assert.equal(
    sipTargetArchiveBlockedMessage(4),
    "Account is the target of 4 SIP(s) — delete or repoint them before archiving",
  );
});
