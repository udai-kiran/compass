# SP1 Verification Report

Date: 2026-08-05

## Files inspected (read-only)

- `apps/api/src/modules/ledger/services/accounts.ts`
- `apps/api/src/modules/investments/services/networth.ts`
- `apps/api/src/modules/ledger/services/account-balances.test.ts`
- `apps/api/src/modules/investments/routes/networth.route.test.ts`
- `apps/api/src/modules/investments/services/networth.test.ts`

## Commands run and output

### 1. npm run typecheck

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

EXIT: 0 — all 7 workspaces, no errors.

### 2. npm run lint

```
> compass@0.1.0 lint
> eslint .
```

EXIT: 0 — no errors.

`grep -n 'any' apps/api/src/modules/ledger/services/account-balances.test.ts` → exit 1 (no matches). The file uses `stub as never`, not `any`; no `@typescript-eslint/no-explicit-any` violation.

### 3. npm run test -w apps/api

Exit: 0

Counts (verbatim from runner):
```
ℹ tests 886
ℹ suites 2
ℹ pass 885
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7357.724528
```

SP1-specific test (verbatim line from output):
```
✔ accountBalancesAtDate returns typed balances and passes correct params (4.576278ms)
```

networth.test.ts suite tests (sample — all passed):
```
✔ every account type is classified for net worth (5.312149ms)
✔ insurance is a tracking record with no net-worth bucket (0.516005ms)
✔ the nightly snapshot overwrites the day's row instead of keeping the first write (8.310661ms)
```

networth.route.test.ts (verbatim):
```
✔ a demo session's POST /api/net-worth/backfill is rejected 403, and no net_worth_snapshots row is written or changed (194.99671ms)
```

**Note on the 1 skip:** The brief predicted the skip would be networth.route.test.ts (needs DATABASE_URL). This is INCORRECT. networth.route.test.ts ran and passed because DATABASE_URL is set in the environment. The actual skip is:
```
﹣ storage contract: disk + s3 (live backends) (1.670933ms) # set RUN_STORAGE_CONTRACT_TEST=1 and docker to run
```
This is the storage backend contract test in `lib/storage.test.ts`, gated by `RUN_STORAGE_CONTRACT_TEST=1`.

### 4. git status --porcelain

```
 M apps/api/src/db/schema.ts
 M apps/api/src/modules/automation/schema.ts
 M apps/api/src/modules/credit/schema.ts
 M apps/api/src/modules/ingest/schema.ts
 M apps/api/src/modules/investments/schema.ts
 M apps/api/src/modules/investments/services/networth.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/ledger/services/accounts.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/protection/schema.ts
 M apps/api/src/modules/system/schema.ts
 M tasks/014-migrate-planning/TASK.md
?? apps/api/src/db/schema.decomposition.test.ts
?? apps/api/src/db/shared/
?? apps/api/src/modules/ledger/services/account-balances.test.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/
?? tasks/BATCH-phase1-close.md
```

SP1's three changed files appear exactly: `M networth.ts`, `M accounts.ts`, `?? account-balances.test.ts`. The other modified files (8× module schema.ts + db/schema.ts) are SP2b, not SP1.

`git diff --name-only HEAD -- apps/api/drizzle/` → empty output (exit 0). **No drizzle migration files were changed.**

However: `git diff --stat HEAD -- apps/api/src/db/schema.ts` shows a very large working-tree change (+93/-1756 lines) — that is the SP2b schema ownership work, already present in the tree. No drizzle SQL was generated from it.

## Read-file verification (decisive lines with file:line)

### A. accounts.ts — accountBalancesAtDate SQL

`accounts.ts:157-177`:

```typescript
export async function accountBalancesAtDate(
  db: Db,
  userId: string,
  asOf: string,
): Promise<AccountBalanceAtDate[]> {
  const res = await db.execute(sql`
    select a.type, coalesce(a.opening_balance_paise + coalesce(t.total, 0), 0)::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total
      from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null
  `);
  return (res.rows as Array<{ type: string; balance: string }>).map((r) => ({
    type: r.type as AccountType,
    balancePaise: Number(r.balance),
  }));
}
```

Confirmed:
- Uses `db.execute(sql\`…\`)` (NOT the query builder) ✓
- Three interpolations in order: `${userId}` (transactions user filter), `${asOf}` (date filter), `${userId}` (accounts user filter) → bound as [userId, asOf, userId] ✓
- Maps rows to `{type: r.type as AccountType, balancePaise: Number(r.balance)}` ✓

The test also independently pins this at `account-balances.test.ts:34`:
```typescript
assert.deepEqual(stringParams, ["user-1", "2026-07-25", "user-1"]);
```

### B. networth.ts — computeNetWorth refactoring

`networth.ts:2`: `import { and, asc, eq, gte, lt, lte } from "drizzle-orm";`
— `sql` is NOT present in the import. ✓

`grep -n '\bsql\b' networth.ts` → exit 1 (zero matches). No other use of `sql` anywhere in the file. ✓

`networth.ts:9`: `import { accountBalancesAtDate } from "../../ledger/services/accounts.ts";` ✓

`networth.ts:58`: `const entries = await accountBalancesAtDate(db, userId, asOf);` ✓

`networth.ts:63-64` (bucket === undefined guard intact):
```typescript
    const bucket = ACCOUNT_BUCKET[r.type];
    if (bucket === undefined) throw new Error(`Unclassified account type in net worth: ${r.type}`);
```
✓

`networth.ts:66`: `const balance = r.balancePaise;` ✓

ACCOUNT_BUCKET map, bucket accumulation, accountAssets, accountLiabilities, holdingsValue, portfolioValue call, and return shape are all unchanged from pre-SP1 (lines 30–76).

### C. Schema and drizzle/ files

`git diff --name-only HEAD -- apps/api/drizzle/` → **empty** (exit 0). No drizzle migration or snapshot files were touched by SP1 (or any in-progress work). ✓

The M-marked schema files (automation, credit, ingest, investments, ledger, planning, protection, system, db/schema.ts) are SP2b working-tree changes, not SP1. They are correctly not attributed to SP1.

## Summary / Findings

| Check | Result |
|---|---|
| typecheck exit 0, all 7 workspaces | PASS |
| lint exit 0, no errors | PASS |
| no `any` in account-balances.test.ts | PASS |
| test exit 0, 885 pass / 0 fail / 1 skip | PASS |
| SP1 test "accountBalancesAtDate returns typed balances..." | PASS |
| networth.test.ts suite | PASS (all tests) |
| networth.route.test.ts | PASS (ran; DATABASE_URL is set) |
| SQL params [userId, asOf, userId] | CONFIRMED ✓ |
| db.execute(sql`…`) not query builder | CONFIRMED ✓ |
| row mapping {type, balancePaise: Number(...)} | CONFIRMED ✓ |
| networth.ts imports no `sql`, no `sql` usage | CONFIRMED ✓ |
| bucket === undefined guard intact | CONFIRMED ✓ |
| balance = r.balancePaise | CONFIRMED ✓ |
| return shape unchanged | CONFIRMED ✓ |
| no drizzle/ files changed | CONFIRMED ✓ |

**One deviation from the brief's expectations:** The brief states "the 1 skip is networth.route.test.ts which needs DATABASE_URL." This is wrong — networth.route.test.ts ran and **passed** (DATABASE_URL is set in the environment). The actual 1 skip is the storage contract test (`storage contract: disk + s3 (live backends)`), gated by `RUN_STORAGE_CONTRACT_TEST=1`. This is a factual inaccuracy in the brief, not a defect in SP1.

No test failures, no lint errors, no non-zero exits. All SP1 behavioral contracts verified by reading source.
