# Delegation: Missed R1 fix — accountBalancesAtDate

## Task
025 — PR-G1 remaining (missed R1 item: accountBalancesAtDate)

## Context
`accountBalancesAtDate` in `apps/api/src/modules/ledger/services/accounts.ts` (~line 160)
still reads `a.opening_balance_paise as opening` and computes `Number(r.opening) + postingTotal`.
This is the same R1 pattern as the already-fixed `bankCashBalances` and `listAccounts`.
The column is always 0 (boot check enforces it); the addend is dead weight.

Its test at `apps/api/src/modules/ledger/services/account-balances.test.ts` stubs the DB
to return `{ type: "bank", opening: "50000", posting_total: "100000" }` and expects
`balancePaise: 150000`. After the fix, `opening` is gone, so the mock data and expected
values must be updated.

## Required changes

### 1. `apps/api/src/modules/ledger/services/accounts.ts`

Read the file. Find `accountBalancesAtDate` (starts around line 160).

In the SQL:
- Remove `a.opening_balance_paise as opening,` from the SELECT list

In the row type (the `as Array<{...}>` cast below the execute):
- Remove `opening: string;` from the type

In the balance computation:
- Change `const balancePaise = Number(r.opening) + postingTotal;` to `const balancePaise = postingTotal;`
- Remove any now-redundant intermediate `postingTotal` variable if the code just becomes
  `const balancePaise = Number(r.posting_total);` — keep it clean and consistent with balances.ts

### 2. `apps/api/src/modules/ledger/services/account-balances.test.ts`

Read the file. Find the two test stubs:

**Test 1** (~line 14-18):
```typescript
rows: [
  { type: "bank", opening: "50000", posting_total: "100000" },
  { type: "loan", opening: "-2500000", posting_total: "0" },
],
```
- Remove `opening` from both rows
- Update the expected result at line 24-27:
  - `{ type: "bank", balancePaise: 100000 }` (was 150000 = 50000 + 100000)
  - `{ type: "loan", balancePaise: 0 }` (was -2500000 = -2500000 + 0)

**Test 2** (~line 40-42):
```typescript
rows: [{ type: "investment", opening: "0", posting_total: "9007199254740993" }],
```
- Remove `opening: "0"` from the row
  (the safe integer check fires on `posting_total`, which is unchanged)

The `params.length === 3` assertion (line 33) should still hold — 3 bound params: userId, asOf, userId.

## Must not change
- Any other file

## Acceptance criteria
- `npm run typecheck` exits 0
- `npm run lint` exits 0
- `accountBalancesAtDate` SQL no longer selects `opening_balance_paise`
- Test stubs no longer include the `opening` field

## Commands
1. Read each file before editing
2. Make the changes described
3. Run `npm run typecheck` and capture output + exit code
4. Run `npm run lint` and capture output + exit code

## Required evidence
Write findings to `/home/udai/common/compass/tasks/025-pr-g1-remaining/implementation-missed-r1b.md`.
Include: files changed, complete diff, exact typecheck + lint output with exit codes.
Return summary ≤20 lines + evidence file path.
