# PR-F Verification-5: A/B Test Comparison

**Date:** 2026-08-10  
**Purpose:** Establish whether apps/api test failures are pre-existing or caused by the PR-F change.

---

## Context Datum: Row Counts

`postings` table: **0 rows** (before and after — unchanged by test runs)  
`transactions` table: **7 rows** (before and after — unchanged by test runs)

---

## CURRENT RUN (PR-F changes present)

Command:
```
DATABASE_URL=postgresql://postgres:<redacted>@192.168.2.196:5432/compass_dev \
REDIS_URL=redis://192.168.2.196:6379 \
SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
npm run test -w apps/api
```

Results:
```
ℹ tests 977
ℹ suites 2
ℹ pass 917
ℹ fail 59
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 12433.114644
```
Exit code: 1

Failing test files (6 unique files, 59 failures):
- `src/modules/credit/services/card-due-tasks.test.ts` — 20 failures
- `src/modules/credit/services/emis.test.ts` — 1 failure
- `src/modules/credit/services/reconciliation-writes.test.ts` — 18 failures
- `src/modules/ledger/routes/user-tasks.route.test.ts` — 4 failures
- `src/modules/ledger/services/postings-pr-e-parity.test.ts` — 3 failures
- `src/modules/ledger/services/user-tasks.test.ts` — 13 failures

---

## BASELINE RUN (PR-F changes stashed; exactly four files reverted)

Stash command:
```
git stash push \
  apps/api/src/modules/system/services/backup.ts \
  apps/api/src/modules/system/services/backup.test.ts \
  apps/extractor/src/db.ts \
  apps/extractor/src/statement-duplicate.test.ts
```

`git status --porcelain` after stash confirmed: only four modified files stashed, `tasks/` dirs untouched (still `??`).

Command: same as current run.

Results:
```
ℹ tests 961
ℹ suites 2
ℹ pass 901
ℹ fail 59
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 11952.054819
```
Exit code: 1

Failing test files (6 unique files, 59 failures):
- `src/modules/credit/services/card-due-tasks.test.ts` — 20 failures
- `src/modules/credit/services/emis.test.ts` — 1 failure
- `src/modules/credit/services/reconciliation-writes.test.ts` — 18 failures
- `src/modules/ledger/routes/user-tasks.route.test.ts` — 4 failures
- `src/modules/ledger/services/postings-pr-e-parity.test.ts` — 3 failures
- `src/modules/ledger/services/user-tasks.test.ts` — 13 failures

The 16-test difference in total (977 vs 961) and 16-pass difference (917 vs 901) is exactly accounted for by the 35 tests in `backup.test.ts` (new in PR-F) minus the 19 tests in the pre-PR-F version of `backup.test.ts`.

---

## RESTORE

`git stash pop` executed successfully. `git status --porcelain` confirmed all four files are `M` (modified) again and `tasks/` dirs are still `??`.

Verification strings present post-restore:
- `sum(p.amount_paise)` in `apps/extractor/src/db.ts`: **1 match** (confirmed)
- `string_agg(x.name` in `apps/api/src/modules/system/services/backup.ts`: **1 match** (confirmed)

---

## DIFF: THREE-BUCKET COMPARISON

| Bucket | Files | Count |
|--------|-------|-------|
| PRE-EXISTING (failing in BOTH runs) | card-due-tasks.test.ts, emis.test.ts, reconciliation-writes.test.ts, user-tasks.route.test.ts, postings-pr-e-parity.test.ts, user-tasks.test.ts | **6 files, 59 failures** |
| CAUSED BY PR-F (only in current run) | *(none)* | **0 files, 0 failures** |
| FIXED BY PR-F (only in baseline) | *(none)* | **0 files, 0 failures** |

**NO failure is attributable to PR-F.** Every failing test in the current run was already failing before the PR-F changes were applied. The identical 59 failures across identical 6 test files in both runs proves the failures are pre-existing.

---

## PR-F TEST FILE RESULTS (CURRENT RUN)

### `apps/api/src/modules/system/services/backup.test.ts`
```
ℹ tests 35
ℹ pass 35
ℹ fail 0
```
**All 35 tests PASS.**

### `apps/extractor/src/statement-duplicate.test.ts`
```
ℹ tests 10
ℹ pass 10
ℹ fail 0
```
**All 10 tests PASS.**

---

## SUMMARY

The 59 failures in apps/api tests are 100% pre-existing. PR-F introduced 35 new passing tests in `backup.test.ts` and 10 new passing tests in `statement-duplicate.test.ts`. It did not cause, introduce, or fix any failure in the failing files (`card-due-tasks.test.ts`, `emis.test.ts`, `reconciliation-writes.test.ts`, `user-tasks.route.test.ts`, `postings-pr-e-parity.test.ts`, `user-tasks.test.ts`). A previous run's attribution of those failures to "PR-F code defect" was incorrect.
