# Implementation: accounts.test.ts PR-G1 test updates

## Files inspected
- `apps/api/src/modules/ledger/services/accounts.test.ts`
- `apps/api/src/modules/ledger/services/accounts.ts` (production — read-only, not changed)

## Files changed
- `apps/api/src/modules/ledger/services/accounts.test.ts`

## Discrepancy from delegation
The delegation described 4 failing tests. Running the test suite before edits revealed **5 failures**:

```
test at accounts.test.ts:58  — no opening row for a zero balance or a non bank/cash type
test at accounts.test.ts:214 — a card's opening balance lives on the column, with no ledger row
test at accounts.test.ts:309 — a leftover opening row is removed when the type no longer carries one
test at accounts.test.ts:325 — a bank opening balance is never written to both the column and the row
test at accounts.test.ts:437 — a type change round-trips an amount through both storage homes intact  ← MISSED
```

The 5th test (`a type change round-trips an amount through both storage homes intact`) was not listed
in the delegation but was clearly broken by the same PR-G1 change. Its `toCard` assertions still
expected `columnPaise: 5000000` and `txn: { kind: "delete" }` — the old column-based model. After
PR-G1, `planOpeningBalanceChange` returns `{ columnPaise: 0, txn: { kind: "none" } }` when the
existing row already holds the same amount. The fix was unambiguous and consistent with the PR-G1
semantics described in the delegation, so it was included to satisfy the acceptance criteria
(tests must exit 0).

## Changes made

### 1. Test: "no opening row for a zero balance or a non bank/cash type" (line 58)
- Renamed to "no opening row for a zero balance; all non-zero types produce a row (PR-G1 unified)"
- Removed comment "cards/loans/schemes keep their opening balance on the column, not the ledger"
- Replaced 3 `assert.equal(..., null)` with per-type non-null assertions checking `amountPaise` and `isOpening`

### 2. Test: "a card's opening balance lives on the column, with no ledger row" (line 214)
- Renamed to "a card's opening balance lives in the ledger row (PR-G1: all types unified)"
- Changed `deepEqual` expectation from `{ columnPaise: -4559100, txn: { kind: "none" } }`
  to `{ columnPaise: 0, txn: { kind: "insert", amountPaise: -4559100, date: "2026-06-19" } }`
- Added comment explaining all types now use is_opening transaction; column always 0

### 3. Test: "a leftover opening row is removed when the type no longer carries one" (line 309)
- Renamed to "a card with an existing opening row updates it in place (PR-G1: all types unified)"
- Changed `deepEqual` expectation from `{ columnPaise: -4559100, txn: { kind: "delete", id: "t1" } }`
  to `{ columnPaise: 0, txn: { kind: "update", id: "t1", amountPaise: -4559100 } }`
- Updated comment to describe PR-G1 unified behavior

### 4. Test: "a bank opening balance is never written to both the column and the row" (line 325)
- Updated comment from "for other types, the column carries it and txn.kind === 'none'"
  to "for ALL types, columnPaise === 0 and the txn carries the amount (PR-G1)"
- Replaced card section: `assert.equal(cardPlan.columnPaise, -1800000)` + `assert.equal(kind, "none")`
  with `assert.equal(cardPlan.columnPaise, 0)` + `assert.equal(kind, "insert")` + amountPaise check
- Added "PR-G1 D10" comment before the card section

### 5. Test: "a type change round-trips an amount through both storage homes intact" (line 437) — NOT in delegation
- Renamed to "a type change preserves the opening amount across the unified ledger-row storage (PR-G1)"
- Changed `toCard` assertions from `{ columnPaise: 5000000, txn: { kind: "delete", id: "t1" } }`
  to `{ columnPaise: 0, txn: { kind: "none" } }`
- `toBank` assertions were already correct (column=0, insert with date "2026-05-31") — unchanged
- Updated comments to explain PR-G1 unified storage

## Commands run and output

### node --test (before changes)
```
EXIT CODE: 1
ℹ tests 42  ℹ pass 37  ℹ fail 5
```

### node --test (after all 5 fixes)
```
$ node --test apps/api/src/modules/ledger/services/accounts.test.ts 2>&1
✔ last 4 is taken from the tail of the full number (1.775126ms)
✔ last 4 of a leading-zero tail keeps the zeros (0.160885ms)
✔ last 4 needs four digits to exist (0.148061ms)
✔ a bank/cash opening balance becomes an 'Opening balance' ledger row (1.000394ms)
✔ no opening row for a zero balance; all non-zero types produce a row (PR-G1 unified) (0.365735ms)
[... 37 more passes ...]
✔ a type change preserves the opening amount across the unified ledger-row storage (PR-G1) (0.16355ms)
ℹ tests 42
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 982.228981
EXIT CODE: 0
```

### npm run typecheck
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
[all 7 workspaces: tsc --noEmit, all silent]
EXIT CODE: 0
```

### npm run lint
```
> compass@0.1.0 lint
> eslint .
EXIT CODE: 0
```

## Assumptions
- The 5th test fix is consistent with PR-G1 semantics as described in the delegation (all types use ledger rows; column always 0). The delegation simply missed enumerating it.

## Unresolved risks
- None. All 42 tests pass, typecheck exits 0, lint exits 0.
