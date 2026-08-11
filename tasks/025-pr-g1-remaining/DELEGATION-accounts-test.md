# Delegation: Fix accounts.test.ts pure-function tests for PR-G1 unified model

## Task
025 — PR-G1 remaining (accounts.test.ts pure-function test updates)

## Context
Branch: `feat/postings-pr-g1`. R4a changed `carriesOpeningAsTransaction` to return `true`
for ALL account types. This changed the behavior of `planOpeningBalanceChange` and
`openingBalanceRow` (pure functions tested without a DB). The `accounts.test.ts` file has
5 test functions whose expectations still reflect the OLD bank/cash-only model.

**DO NOT touch any production file.** Only `accounts.test.ts` changes.

## Function behavior after PR-G1

`openingBalanceRow(input)` now returns a non-null row for ANY type with non-zero
`openingBalancePaise` (not just bank/cash).

`planOpeningBalanceChange(input)` now:
- Always uses the ledger-row path (columnPaise = 0) because `carriesOpeningAsTransaction` returns true for all types
- The `if (!carriesOpeningAsTransaction(type))` branch is dead code (never reached)
- But do NOT change the production function — only update the tests

## Tests to update

### Test: "no opening row for a zero balance or a non bank/cash type" (around line 58)

**Read the file** — find this test. The assertions at lines ~62-65:
```typescript
assert.equal(openingBalanceRow({ ...base, type: "credit_card", openingBalancePaise: -1000_00 }), null);
assert.equal(openingBalanceRow({ ...base, type: "ppf", openingBalancePaise: 92_000_00 }), null);
assert.equal(openingBalanceRow({ ...base, type: "investment", openingBalancePaise: 10_000_00 }), null);
```
These now FAIL because openingBalanceRow returns non-null for ALL types with non-zero balance.

**Replace** these 3 assertions with assertions that the rows ARE non-null AND have the correct structure:
```typescript
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
```

**Also update the test name and comment** to drop the "non bank/cash" framing:
- Change the test name from "no opening row for a zero balance or a non bank/cash type" to "no opening row for a zero balance; all non-zero types produce a row (PR-G1 unified)"
- Keep the zero-balance assertion: `assert.equal(openingBalanceRow({ ...base, type: "bank", openingBalancePaise: 0 }), null);`
- Remove the old comment `// cards/loans/schemes keep their opening balance on the column, not the ledger`

### Test: "a card's opening balance lives on the column, with no ledger row" (around line 214)

**Replace** with:
```typescript
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
```
The date is "2026-06-19" because `dayBefore("2026-06-20") = "2026-06-19"`.

### Test: "a leftover opening row is removed when the type no longer carries one" (around line 309)

This test was about bank→card type changes removing the Opening row. After PR-G1, ALL types carry opening rows, so a credit_card with an existing Opening row and a new amount just UPDATES the row (not deletes it).

**Replace** with:
```typescript
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
```

### Test: "a bank opening balance is never written to both the column and the row" (around line 325)

Find the `cardPlan` section (the second half of the test):
```typescript
const cardPlan = planOpeningBalanceChange({
  type: "credit_card",
  requestedPaise: -1800000,
  existing: null,
  earliestTxnDate: null,
  today: "2026-07-26",
});
assert.equal(cardPlan.columnPaise, -1800000);  // WRONG
assert.equal(cardPlan.txn.kind, "none");         // WRONG
```

**Replace the card section** with:
```typescript
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
```

Also update the comment in this test (line ~326-328) from "for other types, the column carries it and txn.kind === 'none'" to "for ALL types, columnPaise === 0 and the txn carries the amount (PR-G1)".

## Must not change
- Any production file
- Any other test file
- Any other test in `accounts.test.ts` not listed above

## Acceptance criteria
- `npm run typecheck` exits 0
- `npm run lint` exits 0
- `node --test apps/api/src/modules/ledger/services/accounts.test.ts` exits 0 (it's a pure-function test with no DB requirement)

## Commands
1. Read `apps/api/src/modules/ledger/services/accounts.test.ts` before editing
2. Make the 4 test changes described above
3. Run `node --test apps/api/src/modules/ledger/services/accounts.test.ts 2>&1` and capture output + exit code
4. Run `npm run typecheck` and capture output + exit code
5. Run `npm run lint` and capture output + exit code

## Required evidence
Write findings to `/home/udai/common/compass/tasks/025-pr-g1-remaining/implementation-accounts-test.md`.
Include: complete diff, test run output with exit code, typecheck + lint output with exit codes.
Return summary ≤20 lines + evidence file path.
