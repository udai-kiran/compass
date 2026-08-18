# Implementation 3 — Task 059 final fix pass

## Files inspected
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts` (untracked, modified in-place)
- `apps/api/src/modules/planning/services/income-surplus.ts` (read to understand SQL query)
- `apps/api/src/lib/ledger-sql.ts` (read to understand hasCategoryDimension)
- `apps/api/src/db/shared/ledger.ts` (read for transactions/postings schema)
- `apps/api/src/db/shared/hubs.ts` (read for accounts schema, accountType enum)
- `packages/shared/src/schemas/ledger.ts` (read for LIABILITY_ACCOUNT_TYPES)
- `CLAUDE.md` (modified)

## Files changed
1. `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
2. `CLAUDE.md`

---

## Fix A — income-surplus cross-user isolation test (was vacuous)

### Root cause
The old test gave user A only a bank account with NO ledger rows. The income-surplus query
aggregates over `postings JOIN accounts JOIN transactions` filtered by `t.user_id = userId`.
With no transactions, `historyMonths = 0` for BOTH users. The single assertion
`assert.equal(bodyB.historyMonths, 0, ...)` would still pass if the ownership filter were
deleted — it proved nothing.

### Fix
Added `createIncomeTransaction(userId)` helper (lines 99–150 of the test file) that:
1. Inserts a `bank` account (type='bank', system_kind=null) — counted by the income SQL
2. Inserts a `system` account (type='system', system_kind='income') — satisfies `hasCategoryDimension()`
3. Inserts a `transactions` row dated today (inside the 12-month window)
4. Inserts a posting on the bank account: `amount_paise = +100_000` (income amount)
5. Inserts a counter posting on the income system account: `amount_paise = -100_000`

The `hasCategoryDimension()` guard (`lib/ledger-sql.ts`) requires at least one posting with
`accounts.system_kind IN ('expenses','income')` — the counter posting satisfies this.
The income aggregation sums `p.amount_paise > 0` where `a.system_kind IS NULL` and
`a.type NOT IN (credit_card, loan, overdraft, home_loan_od)` — the bank account posting
satisfies this.

### Assertions now meaningful
- `assert.ok(bodyA.historyMonths > 0, ...)` — fails if filter broken (user A sees own data)
- `assert.ok(bodyA.months.find(m => m.incomePaise === 100_000) !== undefined, ...)` — specific month check
- `assert.equal(bodyB.historyMonths, 0, ...)` — user B sees no history
- `assert.equal(bodyB.months.find(m => m.incomePaise > 0), undefined, ...)` — no non-zero months leak

Added import: `import { transactions, postings } from "../../../db/shared/ledger.ts";`

---

## Fix B — CLAUDE.md experimental flag documentation

Added a paragraph after the `npm run test` code block in the Commands section documenting:
- Why `--experimental-test-module-mocks` exists (enables `mock.module()` for hermetic route tests)
- Which two files require it (planning-analysis.hermetic.test.ts, revolving-debt.hermetic.test.ts)
- That they run through `npm run test -w apps/api` so CI never skips them
- That the flag is Node "Stability 1.0 — Early development" and emits two ExperimentalWarning lines
- That CI pins Node 24 while root engines.node is `>=24`
- That removal/rename of the flag causes a loud unknown-option error, not silent wrong results

---

## Verification results

### 1. typecheck
```
npm run typecheck ; echo "EXIT=$?"
EXIT=0
```

### 2. lint
```
npm run lint ; echo "EXIT=$?"
EXIT=0
```

### 3. route snapshot test (tail -12)
```
✔ assertRouteTableMatches rejects a removed route (0.229526ms)
✔ assertRouteTableMatches rejects a renamed route (0.185277ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.193187ms)
✔ assertRouteTableMatches accepts identical tables (0.245827ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1896.042687
```

### 4. snapshot line count
```
wc -l apps/api/src/route-surface.snapshot.txt
319 apps/api/src/route-surface.snapshot.txt  ✓
```

### 5. hermetic tests (with --experimental-test-module-mocks, tail -15)
```
✔ GET /api/planning/income-surplus — lookbackMonths coerces string '6' (5.617637ms)
✔ GET /api/planning/income-surplus — lookbackMonths=0 rejected 400 (5.725496ms)
✔ GET /api/planning/income-surplus — lookbackMonths=121 rejected 400 (5.007851ms)
✔ GET /api/planning/income-surplus — fractional lookbackMonths rejected 400 (4.254885ms)
✔ GET /api/planning/income-surplus — non-numeric lookbackMonths rejected 400 (4.402785ms)
✔ GET /api/planning/data-completeness — 200 and schema-valid body (5.415938ms)
✔ GET /api/planning/data-completeness — ?today= is silently ignored: asOf reflects server date, not query param (4.267538ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 645.006504
```
Note: the brief's step 5 ran without `--experimental-test-module-mocks` and got 2 fail (expected — those files need the flag). With the flag: 11 pass, 0 fail.

### 6. full test suite
```
npm run test > /tmp/059f-test.txt 2>&1 ; echo "EXIT=$?" ; tail -70 /tmp/059f-test.txt
EXIT=1
```
Aggregate counts across 6 workspaces:
- tests: 799 + 74 + 12 + 270 + 32 + 212 = 1399
- pass:  771 + 73 + 12 + 270 + 32 + 212 = 1370
- fail:   27 +  1 +  0 +   0 +  0 +   0 =   28
- exit: 1

All 28 failures are DATABASE_URL-gated tests throwing at module load (planning-analysis.route.test.ts,
revolving-debt.route.test.ts, app.test.ts, automation.route.test.ts, card-due-tasks.test.ts, etc.)
because DATABASE_URL is not set in this environment. This is the expected and correct result per
task 059 AC4b ("written but unrun"). No new failures were introduced.

---

## Literal diff — CLAUDE.md
```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -36,6 +36,12 @@ npm run test -w apps/api
 node --test apps/api/src/services/capital-gains.test.ts
 ```
 
+`apps/api/package.json` passes `--experimental-test-module-mocks` to `node --test`. This flag enables `node:test`'s `mock.module()` API, which two hermetic route tests require to stub a service module so the real route plugin can be registered and its real handler exercised without a DB or Redis connection:
+- `apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts`
+- `apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts`
+
+These files run through the normal `npm run test -w apps/api` command so CI never silently skips them (`.github/workflows/ci.yml` runs `npm test`). The flag is Node "Stability 1.0 — Early development" and emits two `ExperimentalWarning` lines per run; this is expected and harmless. CI pins Node major 24 (`engines.node` in the root `package.json` is `>=24`). If a future Node release renames or removes the flag, the API test command fails loudly with an unknown-option error rather than producing silently wrong results.
+
 ## Architecture
```

## Literal diff — planning-analysis.route.test.ts (untracked file, key changes shown)

Line 16 added:
```ts
import { transactions, postings } from "../../../db/shared/ledger.ts";
```

Lines 99–150 added: `createIncomeTransaction` helper (see above for full description).

Lines 205–255: isolation test replaced — `createBankAccount` call removed, `createIncomeTransaction` called instead; obsolete comment removed; assertions strengthened from 1 vacuous assertion to 4 meaningful assertions checking both user A has real income and user B has none.

---

## Assumptions
- `cleanupUser` (which deletes the user row) cascades to accounts/transactions/postings via ON DELETE CASCADE in the schema. The test cleanup does not need to delete transactions/postings individually.
- `historyMonths` in IncomeSurplusResult is the count of months with income > 0. Confirmed from service source (`income-surplus.ts`) that historyMonths counts non-zero months.

## Unresolved risks
- None introduced. The test remains DATABASE_URL-gated and cannot be run in this environment — that is by design.
