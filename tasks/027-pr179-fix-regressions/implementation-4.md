# Implementation 4 — D11a + D11b + D11c

## What was done

### D11a — inbox.test.ts (verified, staged)
- Confirmed: test at line 1169 no longer asserts `categoryId` unchanged. The test name reads "...amount/date/occurredAt/merchant are unchanged" (no `categoryId`). Line 1221 is `assert.equal(after.merchant, before.merchant);` — no `categoryId` assertion follows.
- Staged as-is (no code change needed).

### D11b — verified (re-dating SQL)
- `card-due-tasks.test.ts` lines 793-797: `UPDATE transactions SET date = '2020-01-01' WHERE account_id = ${accountId} AND is_opening = true` is present inside "AC15: reuses listCardHolders' handling of a non-zero opening balance" after `createCardAccount`.
- `reconciliation-writes.test.ts` lines 124-127: Same SQL present inside "Diners-shaped constituent rows" after `createCardAccount`.
- Both staged.

### D11c — implemented (5 file changes + 1 new file)

**`apps/api/src/db/index.ts`**
Changed:
- `export type Db = NodePgDatabase<typeof schema>` → `export type Db = NodePgDatabase<typeof schema> & { readonly $client: pg.Pool };`
- `return drizzle(pool, { schema });` → `return drizzle(pool, { schema }) as unknown as Db;`

**`apps/api/src/lib/account-lock.ts`** (new)
- Implements `withAccountAdvisoryLock<T>(db: Db, accountId: string, fn: (lockedDb: Db) => Promise<T>): Promise<T>`
- Acquires `pg_advisory_lock(hashtextextended($1, 0))` on a dedicated pool connection before calling `fn`
- Releases with `destroyClient = true` on unlock failure; destroys connection on `pg_advisory_lock` failure

**`apps/api/src/modules/credit/services/reconciliation-writes.ts`**
- Added `import { withAccountAdvisoryLock } from "../../../lib/account-lock.ts";`
- Wrapped `withSerializableRetry(() => db.transaction(..., {isolationLevel: "serializable"}))` with `withAccountAdvisoryLock(db, accountId, (lockedDb) => withSerializableRetry(() => lockedDb.transaction(...)))`
- `repairSnapshots` call after the block uses original `db` — unchanged

**`apps/api/src/modules/ledger/services/accounts.ts`**
- Added `import { withAccountAdvisoryLock } from "../../../lib/account-lock.ts";`
- Wrapped `db.transaction(async (tx) => { ... })` in `updateAccount` with `withAccountAdvisoryLock(db, id, (lockedDb) => lockedDb.transaction(async (tx) => { ... }))`
- All content inside the `async (tx) => { ... }` callback is unchanged

**`apps/api/src/modules/credit/services/reconciliation-writes.test.ts`**
- Updated concurrent-lock test name to use "advisory lock"
- Replaced "Connection A" block (old: `db.transaction` + `SELECT FOR UPDATE`) with advisory-lock version using `pool.connect()` + `pg_advisory_lock(hashtextextended(...))` + `try/finally { clientA.release() }`
- Updated assertion message from "account-row lock" to "advisory lock"
- SSI tests (lines 793+) untouched

## Deviations from the plan

**One unplanned file change:** `apps/api/src/modules/ledger/services/transactions.ts`

The `Db` type widening (adding `$client: pg.Pool`) caused a TypeScript error at `transactions.ts:478` where `createTransaction(db: DbOrTx, ...)` calls `getTransaction(db: Db, ...)`. `PgTransaction` does not have `$client` so `DbOrTx` is no longer assignable to `Db`.

Fix: changed `getTransaction(db: Db, ...)` to `getTransaction(db: DbOrTx, ...)`. This is minimal — `hydrate()` (called inside `getTransaction`) already accepts `DbOrTx`. The route caller (`app.db`) is always a `Db`, so no runtime change. This was a direct consequence of the brief-specified `$client` addition.

AC3 expected 7 files; actual is 8 (+ `transactions.ts`).

## Commands run

```
npm run typecheck -w apps/api   # EXIT CODE: 0 (after getTransaction fix)
npm run lint                    # EXIT CODE: 0
git add <8 files>
git status --porcelain
git diff --cached --name-only
git diff --cached --stat
```

## typecheck output
```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT CODE: 0
```

## lint output
```
> compass@0.1.0 lint
> eslint .

EXIT CODE: 0
```

## Staged files (8 total)
```
M  apps/api/src/db/index.ts
A  apps/api/src/lib/account-lock.ts
M  apps/api/src/modules/credit/services/card-due-tasks.test.ts
M  apps/api/src/modules/credit/services/reconciliation-writes.test.ts
M  apps/api/src/modules/credit/services/reconciliation-writes.ts
M  apps/api/src/modules/ingest/services/inbox.test.ts
M  apps/api/src/modules/ledger/services/accounts.ts
M  apps/api/src/modules/ledger/services/transactions.ts
```

## Unresolved risks

- The `transactions.ts` deviation (widening `getTransaction` to `DbOrTx`) was not in the brief's approved plan. It is logically correct but should be acknowledged by the coordinator.
- No integration test for the actual `updateAccount` + `absorbCarryover` concurrency (recorded as follow-up F11 per TASK.md).
