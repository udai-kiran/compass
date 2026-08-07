# backend-15: resolveSystemAccounts auto-seed fix

## Files changed
- `apps/api/src/modules/ledger/services/post-entry.ts` — added `await seedSystemAccounts(db, userId)` as first line of `resolveSystemAccounts`; updated doc-comment to note auto-seed behaviour.
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` — removed now-redundant standalone `await seedSystemAccounts(db, userId)` from `reconcileUserPostings`; removed `seedSystemAccounts` from import (no longer used).

## Implementation details
`resolveSystemAccounts` now calls `seedSystemAccounts` before querying, making it self-contained. `seedSystemAccounts` is idempotent (unique-violation swallowed), so in production this is one extra SELECT returning 4 existing rows. The explicit call in `reconcileUserPostings` was removed and the import cleaned up. `reconcileAllPostings` delegates to `reconcileUserPostings` — no separate change needed there. `findInconsistentPostings` deliberately does NOT seed (read-only diagnostic); its call to `resolveSystemAccounts` now auto-seeds as a side effect, which is acceptable.

## Commands run
```
npm run typecheck -w apps/api
npm run lint
npm run test -w apps/api
node --env-file-if-exists=.env --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts
node --env-file-if-exists=.env --test apps/api/src/modules/system/services/backup.test.ts
```

## Exit codes
1. typecheck: 0
2. lint: 0
3. test -w apps/api: 1  (1 pre-existing failure, unrelated)
4. reconcile-postings.test.ts: 0
5. backup.test.ts: 0

## Test totals (apps/api)
- tests 917, pass 915, fail 1, skipped 1
- Previously: 860 pass + 56 fail; 56 convergence failures resolved.

## reconcile-postings: 5 pass / 0 fail
## backup: 19 pass / 0 fail

## Remaining failure (pre-existing, unrelated to this fix)
Test: `acceptRepayment AC4b: a candidate linked by a concurrent request between detection and linking returns a defined 409 (not a raw unique-violation), creates no ledger row, and leaves the draft pending`
File: `apps/api/src/modules/ingest/services/inbox.test.ts:1283`
Error: `AssertionError: The validation function is expected to return "true". Received false — HttpError: Transaction is already part of a transfer` (from `transfers.ts:131`)
This failure exists in the branch before this change and is not caused by it.

## Path
`tasks/021-postings-model/backend-15.md`
