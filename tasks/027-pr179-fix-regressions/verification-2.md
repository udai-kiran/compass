# Verification-2 Report

**Date:** 2026-08-11  
**Branch:** feat/postings-pr-g1  
**Verifier:** independent verification worker (did not implement the changes)

---

## 1. Typecheck

**Command:** `npm run typecheck -w apps/api`  
**Working directory:** /home/udai/common/compass  
**Output:**
```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```
**Exit code: 0** — no type errors.

---

## 2. Lint

**Command:** `npm run lint`  
**Working directory:** /home/udai/common/compass  
**Output:**
```
> compass@0.1.0 lint
> eslint .
```
**Exit code: 0** — no lint errors.

---

## 3. Git Status

**Command:** `git status && git diff --stat HEAD`

```
On branch feat/postings-pr-g1
Your branch is up to date with 'origin/feat/postings-pr-g1'.

Changes to be committed:
	modified:   apps/api/src/db/index.ts
	new file:   apps/api/src/lib/account-lock.ts
	modified:   apps/api/src/modules/credit/services/card-due-tasks.test.ts
	modified:   apps/api/src/modules/credit/services/reconciliation-writes.test.ts
	modified:   apps/api/src/modules/credit/services/reconciliation-writes.ts
	modified:   apps/api/src/modules/ingest/services/inbox.test.ts
	modified:   apps/api/src/modules/ledger/services/accounts.ts
	modified:   apps/api/src/modules/ledger/services/transactions.ts

Changes not staged for commit:
	modified:   apps/api/src/lib/account-lock.ts
	modified:   apps/api/src/modules/credit/services/reconciliation-writes.ts

Untracked files:
	pnpm-lock.yaml
	tasks/021-postings-model/audit-remaining-1.md
	tasks/021-postings-model/build-status-1.md
	tasks/025-pr-g1-remaining/
	tasks/026-pr-179-merge/
	tasks/027-pr179-fix-regressions/
```

**Diff stat vs HEAD:**
```
 apps/api/src/db/index.ts                           |  4 +-
 apps/api/src/lib/account-lock.ts                   | 67 +++++++++++++++
 .../modules/credit/services/card-due-tasks.test.ts |  7 ++
 .../credit/services/reconciliation-writes.test.ts  | 98 ++++++++++++++--------
 .../credit/services/reconciliation-writes.ts       | 17 ++--
 apps/api/src/modules/ingest/services/inbox.test.ts |  3 +-
 apps/api/src/modules/ledger/services/accounts.ts   |  7 +-
 .../src/modules/ledger/services/transactions.ts    |  2 +-
 8 files changed, 155 insertions(+), 50 deletions(-)
```

Note: `account-lock.ts` and `reconciliation-writes.ts` appear in BOTH staged and unstaged changes, meaning there are working-tree changes on top of staged changes. File reads below reflect the current working-tree state.

---

## 4. File State Confirmations

### 4a. `apps/api/src/lib/account-lock.ts` — advisory lock structure

**Confirmed.** The file has exactly two try blocks with non-overlapping responsibilities:

- **Outer try/catch (lines 38–46):** covers ONLY the `pg_advisory_lock` acquisition query. On failure: `client.release(true)` + rethrow. `fn` is NOT in this block.
- **Inner try/finally (lines 51–66):** covers `fn` execution AND the `pg_advisory_unlock` + `client.release(destroyClient)`. No double-release is possible because the outer catch releases on lock-acquisition failure (before the inner block is entered) and the inner finally releases after fn completes.

Exact structure:
```
try {                          // outer: lock acquisition only
  await client.query(pg_advisory_lock...)
} catch (err) {
  client.release(true);        // released here only on lock-acq failure
  throw err;
}
// inner: fn + unlock + release
let destroyClient = false;
try {
  return await fn(lockedDb);
} finally {
  try { pg_advisory_unlock... } catch { destroyClient = true; }
  client.release(destroyClient);
}
```

### 4b. `apps/api/src/modules/credit/services/reconciliation-writes.ts` lines 240–255 — absorbCarryover

**Confirmed.** `absorbCarryover` (line 232) wraps its core logic as:
```typescript
const { dto, createdAt } = await withAccountAdvisoryLock(db, accountId, (lockedDb) =>
  withSerializableRetry(() =>
    lockedDb.transaction(
      async (tx) => { ... }
    )
  )
);
```
This matches the expected pattern: `withAccountAdvisoryLock(db, accountId, (lockedDb) => withSerializableRetry(() => lockedDb.transaction(...)))`.

### 4c. `apps/api/src/modules/ledger/services/accounts.ts` line 364 — updateAccount

**Confirmed.** `updateAccount` (line 356) at line 364 uses:
```typescript
return withAccountAdvisoryLock(db, id, (lockedDb) =>
  lockedDb.transaction(async (tx) => { ... })
);
```
This matches the expected pattern: `withAccountAdvisoryLock(db, id, (lockedDb) => lockedDb.transaction(...))`.

---

## Summary

| Check | Result |
|-------|--------|
| `npm run typecheck -w apps/api` | EXIT 0 — clean |
| `npm run lint` | EXIT 0 — clean |
| `account-lock.ts` outer try covers ONLY lock acquisition | CONFIRMED |
| `account-lock.ts` inner try/finally covers fn + unlock + release | CONFIRMED |
| No double-release possible in `account-lock.ts` | CONFIRMED |
| `absorbCarryover` uses `withAccountAdvisoryLock → withSerializableRetry → lockedDb.transaction` | CONFIRMED |
| `updateAccount` uses `withAccountAdvisoryLock → lockedDb.transaction` | CONFIRMED |

**Risk noted:** `account-lock.ts` and `reconciliation-writes.ts` have unstaged working-tree modifications on top of staged changes. The coordinator should confirm whether those unstaged changes are intentional or if an additional staging step is needed before commit.
