import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessAccountEditAgainstSips,
  last4Of,
  openingBalanceRow,
  openingBalanceToReconcile,
  planOpeningBalanceChange,
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

test("no opening row for a zero balance; all non-zero types produce a row (PR-G1 unified)", () => {
  const base = { userId: "u1", accountId: "a1", date: "2025-04-01" as const };
  // zero balance → nothing to seed
  assert.equal(openingBalanceRow({ ...base, type: "bank", openingBalancePaise: 0 }), null);
  // All account types now create an Opening balance ledger row (PR-G1 D10: all types unified)
  const cardRow = openingBalanceRow({ ...base, type: "credit_card", openingBalancePaise: -1000_00 });
  assert.ok(cardRow !== null, "credit_card with non-zero balance must produce an opening row");
  assert.equal(cardRow!.amountPaise, -1000_00);
  assert.equal(cardRow!.isOpening, true);

  const ppfRow = openingBalanceRow({ ...base, type: "ppf", openingBalancePaise: 92_000_00 });
  assert.ok(ppfRow !== null, "ppf with non-zero balance must produce an opening row");
  assert.equal(ppfRow!.amountPaise, 92_000_00);

  const invRow = openingBalanceRow({ ...base, type: "investment", openingBalancePaise: 10_000_00 });
  assert.ok(invRow !== null, "investment with non-zero balance must produce an opening row");
  assert.equal(invRow!.amountPaise, 10_000_00);
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

// ---------- planOpeningBalanceChange (Fix: correctable opening balance without double-count) ----------
// These tests pin the no-double-count invariant: a bank/cash account keeps its opening balance
// in an is_opening transaction with the column pinned at 0, and every other type keeps it on the
// column with no such row. Writing both would double-count (opening_balance_paise + Σtx).

test("a card's opening balance lives in the ledger row (PR-G1: all types unified)", () => {
  const plan = planOpeningBalanceChange({
    type: "credit_card",
    requestedPaise: -4559100,
    existing: null,
    earliestTxnDate: "2026-06-20",
    today: "2026-07-26",
  });
  // In PR-G1 all types keep their opening balance in the is_opening transaction;
  // the column is always 0.
  assert.deepEqual(plan, { columnPaise: 0, txn: { kind: "insert", amountPaise: -4559100, date: "2026-06-19" } });
});

test("a bank's opening balance lives in the ledger row, with the column pinned at 0", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 5000000,
    existing: null,
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "insert", amountPaise: 5000000, date: "2026-07-26" },
  });
});

test("a new bank opening row is dated before the account's earliest activity", () => {
  const plan = planOpeningBalanceChange({
    type: "cash",
    requestedPaise: 600000,
    existing: null,
    earliestTxnDate: "2026-06-01",
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "insert", amountPaise: 600000, date: "2026-05-31" },
  });
});

test("the opening row date rolls back across a month boundary", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 100,
    existing: null,
    earliestTxnDate: "2026-03-01",
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "insert", amountPaise: 100, date: "2026-02-28" },
  });
});

test("changing a bank's opening balance updates the existing row instead of adding one", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 7500000,
    existing: { id: "t1", amountPaise: 5000000 },
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "update", id: "t1", amountPaise: 7500000 },
  });
});

test("resubmitting the same bank opening balance changes nothing", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 5000000,
    existing: { id: "t1", amountPaise: 5000000 },
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "none" },
  });
});

test("zeroing a bank's opening balance removes the ledger row", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 0,
    existing: { id: "t1", amountPaise: 5000000 },
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "delete", id: "t1" },
  });
});

test("a card with an existing opening row updates it in place (PR-G1: all types unified)", () => {
  // In PR-G1 all types carry their opening balance in the ledger row.
  // A type-change (e.g. bank → credit_card) no longer removes the row — it updates it.
  const plan = planOpeningBalanceChange({
    type: "credit_card",
    requestedPaise: -4559100,
    existing: { id: "t1", amountPaise: 5000000 },
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "update", id: "t1", amountPaise: -4559100 },
  });
});

test("a bank opening balance is never written to both the column and the row", () => {
  // The anti-double-count invariant: for ALL types, columnPaise === 0 and the
  // txn carries the amount (PR-G1).
  const bankPlan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 3250000,
    existing: null,
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.equal(bankPlan.columnPaise, 0);
  assert.equal(bankPlan.txn.kind, "insert");
  if (bankPlan.txn.kind === "insert") {
    assert.equal(bankPlan.txn.amountPaise, 3250000);
  }

  // PR-G1 D10: all types use ledger rows — column is always 0
  const cardPlan = planOpeningBalanceChange({
    type: "credit_card",
    requestedPaise: -1800000,
    existing: null,
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.equal(cardPlan.columnPaise, 0);
  assert.equal(cardPlan.txn.kind, "insert");
  if (cardPlan.txn.kind === "insert") {
    assert.equal(cardPlan.txn.amountPaise, -1800000);
  }
});

test("zeroing an opening balance that has no row is a no-op beyond the column", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 0,
    existing: null,
    earliestTxnDate: "2026-06-01",
    today: "2026-07-26",
  });
  assert.deepEqual(plan, {
    columnPaise: 0,
    txn: { kind: "none" },
  });
});

test("a negative bank opening balance is kept as a ledger row like any other", () => {
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: -750000,
    existing: null,
    earliestTxnDate: "2026-06-01",
    today: "2026-07-26",
  });
  assert.equal(plan.columnPaise, 0);
  assert.deepEqual(plan.txn, {
    kind: "insert",
    amountPaise: -750000,
    date: "2026-05-31",
  });
});

test("a bank still carrying a stale column amount moves it into the ledger row", () => {
  // The column is always re-pinned at 0 for a carrier type (bank/cash), so a
  // stale nonzero column cannot survive a save and be double-counted.
  const plan = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: 5000000,
    existing: null,
    earliestTxnDate: null,
    today: "2026-07-26",
  });
  assert.equal(plan.columnPaise, 0);
  assert.deepEqual(plan.txn, {
    kind: "insert",
    amountPaise: 5000000,
    date: "2026-07-26",
  });
});

// ---------- openingBalanceToReconcile (Fix: type-change opening-balance migration) ----------

test("an explicit opening-balance request wins over whatever is stored", () => {
  assert.equal(
    openingBalanceToReconcile({ requestedPaise: -4559100, existingRowPaise: 5000000, columnPaise: 0 }),
    -4559100,
  );
  // Including an explicit zero — that's a deliberate clearing, not "unspecified".
  assert.equal(
    openingBalanceToReconcile({ requestedPaise: 0, existingRowPaise: 5000000, columnPaise: 0 }),
    0,
  );
});

test("a bank changing type carries the amount out of its ledger row, not its zeroed column", () => {
  // The whole point: a carrier type pins the column at 0, so reading the column
  // here would silently zero the balance on every bank -> card change.
  assert.equal(
    openingBalanceToReconcile({ requestedPaise: undefined, existingRowPaise: 5000000, columnPaise: 0 }),
    5000000,
  );
});

test("a card changing type carries the amount off its column", () => {
  assert.equal(
    openingBalanceToReconcile({ requestedPaise: undefined, existingRowPaise: null, columnPaise: -4559100 }),
    -4559100,
  );
});

test("a type change with nothing stored anywhere reconciles to zero", () => {
  assert.equal(
    openingBalanceToReconcile({ requestedPaise: undefined, existingRowPaise: null, columnPaise: 0 }),
    0,
  );
});

test("a type change preserves the opening amount across the unified ledger-row storage (PR-G1)", () => {
  // PR-G1: both types keep their opening balance in the ledger row (column always 0),
  // so a bank→credit_card type-change leaves the existing row in place (no-op on same amount).
  const toCard = planOpeningBalanceChange({
    type: "credit_card",
    requestedPaise: openingBalanceToReconcile({
      requestedPaise: undefined,
      existingRowPaise: 5000000,
      columnPaise: 0,
    }),
    existing: { id: "t1", amountPaise: 5000000 },
    earliestTxnDate: "2026-06-01",
    today: "2026-07-26",
  });
  // Amount is already in the row and unchanged — no ledger write needed.
  assert.equal(toCard.columnPaise, 0);
  assert.deepEqual(toCard.txn, { kind: "none" });

  // credit_card (with stale column balance) -> bank: reconcile reads column, inserts a new row.
  const toBank = planOpeningBalanceChange({
    type: "bank",
    requestedPaise: openingBalanceToReconcile({
      requestedPaise: undefined,
      existingRowPaise: null,
      columnPaise: 5000000,
    }),
    existing: null,
    earliestTxnDate: "2026-06-01",
    today: "2026-07-26",
  });
  assert.equal(toBank.columnPaise, 0);
  assert.deepEqual(toBank.txn, { kind: "insert", amountPaise: 5000000, date: "2026-05-31" });
});
