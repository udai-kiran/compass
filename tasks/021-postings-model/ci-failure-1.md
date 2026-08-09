# CI Failure — Run 31319267480 (branch pr-d-fullchanges)

## 1. Which job failed

**Job: `check`** (ID 93259505403)
Step: **`Run npm test`**
Exit code: **1**
All other steps in `check` (typecheck, lint, db:migrate) passed. The `audit` job passed.

## 2. Exact error output

```
✖ postings-planning-parity: 5 — buildReport merchants match legacy SQL (131.494549ms)

test at src/modules/planning/services/postings-planning-parity.test.ts:481:1

✖ postings-planning-parity: 5 — buildReport merchants match legacy SQL (131.494549ms)

  AssertionError [ERR_ASSERTION]: MerchantX spend must be 50000
    + actual - expected
    + undefined
    - 50000

      at TestContext.<anonymous>
         (file:///home/runner/work/PennyPilot/PennyPilot/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:539:10)

    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 50000,
    operator: 'strictEqual'

ℹ tests 951
ℹ pass 949
ℹ fail 1
ℹ skipped 1
```

## 3. Root cause (mechanistic, not a verdict)

**File:** `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` — introduced in commit `20167fc` (PR-D full changes).

**Failing assertion — line 539:**
```ts
const mx = report.topMerchants.find((m) => m.merchant === "MerchantX");
assert.equal(mx?.spentPaise, 50000, "MerchantX spend must be 50000");
```

**Why `mx` is `undefined`:**
`createTransaction` normalizes the merchant field via `normalizeMerchant` →
`heuristicNormalize`. Verified locally:

```
heuristicNormalize("MerchantX") → "Merchantx"
heuristicNormalize("MerchantY") → "Merchanty"
```

`titleCase` lowercases the entire string before re-capitalizing word-initial
letters, so "X" → "x".  
The stored merchant in the `transactions` row (and thus in both the legacy SQL
and the postings SQL) is `"Merchantx"` (lowercase x), not `"MerchantX"`.

The loop immediately above the failing line (lines 525–535) iterates both
`legMerchants` and `report.topMerchants` in index order and compares them to
each other — both sides hold the DB-normalized `"Merchantx"`, so all those
assertions pass. The spot-check at line 538–539 then hardcodes the pre-normalization
string `"MerchantX"` and `find` returns `undefined`.

**Affected source files:**

| File | Role |
|------|------|
| `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` | Contains the wrong hardcoded string at line 538–539 |
| `apps/api/src/modules/ledger/services/merchants.ts` | `heuristicNormalize` — the normalizer that changes the casing |
| `apps/api/src/modules/ledger/services/transactions.ts` | `createTransaction` calls `normalizeMerchant` before writing to DB |
| `apps/api/src/modules/planning/services/reports.ts` | `buildReport` — the function under test; reads the already-normalized merchant from DB |

## 4. The fix

In `postings-planning-parity.test.ts` line 538, change the hardcoded
`"MerchantX"` to `"Merchantx"` (the post-normalization form):

```ts
// Before (wrong):
const mx = report.topMerchants.find((m) => m.merchant === "MerchantX");
assert.equal(mx?.spentPaise, 50000, "MerchantX spend must be 50000");

// After (correct):
const mx = report.topMerchants.find((m) => m.merchant === "Merchantx");
assert.equal(mx?.spentPaise, 50000, "Merchantx spend must be 50000");
```

No production code change is needed — `buildReport`, `createTransaction`, and
`normalizeMerchant` all behave correctly and consistently. Only the test's
spot-check assertion used the wrong string.

## 5. Supporting evidence

- `heuristicNormalize("MerchantX")` confirmed to return `"Merchantx"` by running
  the function directly in this repo (`node -e ...`).
- The preceding loop (lines 524–535) passed, proving the two lists do agree;
  only the hardcoded find at line 538 is wrong.
- Test count: 951 tests, 949 pass, 1 fail, 1 skipped (single failure).
- Commit introducing this test: `20167fc` ("PR-D full changes").
