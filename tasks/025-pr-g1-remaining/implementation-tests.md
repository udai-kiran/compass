# Implementation Report: Test Type-Error Fixes (025-pr-g1-remaining)

## Files Changed

1. `apps/api/src/modules/ingest/services/inbox.test.ts` — T1: removed 5th `false` arg from two `linkTransfer` calls
2. `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — T2: `hydrated.transferLinkId, null` → `hydrated.isTransfer, false`
3. `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` — T3: `xfer.outTransactionId` → `xfer.transactionId`, comment updated
4. `apps/api/src/lib/postings-periods-parity.test.ts` — T4: removed `rebuildPostingsForTransaction` import; fixed 7b unlink; fixed 7c re-link; deleted 7d block; updated final comment
5. `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` — T5: full rewrite replacing `reconcileUserPostings` tests with 4 tests for `findInconsistentPostings` / `reprojectAllLegacyColumns`
6. `apps/api/src/modules/system/services/backup.test.ts` — T6: removed `reconcileUserPostings`, unused `transactionSplits`/`transferLinks`; added service imports; replaced raw inserts with service calls; deleted source-side reconcile call + 2 assertions; updated assertions for PR-G1 semantics

## Implementation Details

**T1** (inbox.test.ts): Two calls at lines ~1254 and ~1667 had `, false` as 5th arg. `linkTransfer` now takes 4 params — the `auto` boolean was removed in PR-G1.

**T2** (epf-contributions.test.ts): `transferLinkId` no longer exists on the `Transaction` DTO; `isTransfer: boolean` replaced it.

**T3** (postings-pr-e-parity.test.ts): `createTransfer` now returns `{ transactionId }` (single outflow header) instead of the old 3-field result. Updated comment also.

**T4** (postings-periods-parity.test.ts):
- Removed `rebuildPostingsForTransaction` import (function gone from transactions.ts in PR-G1)
- 7b: `unlinkTransfer(db, userId, transfer.transferLinkId)` → `const unlinked = await unlinkTransfer(db, userId, transfer.transactionId); const [outId, inId] = unlinked.transactionIds;`
- 7c: `linkTransfer(db, userId, transfer.outTransactionId, transfer.inTransactionId, false)` → `const newLink = await linkTransfer(db, userId, outId, inId);`
- Deleted 7d block entirely (hard-delete in-leg scenario is architecturally impossible with PR-G1 single-header transfers)
- Updated final comment from "only out-leg remains" to "re-linked transfer must be consistent"

**T5** (reconcile-postings.test.ts): Complete rewrite. The old 5 tests called `reconcileUserPostings` which no longer exists. New 4 tests:
1. `findInconsistentPostings: returns [] for a normally-created transaction`
2. `findInconsistentPostings: reports 'no postings' for a raw-inserted transaction`
3. `findInconsistentPostings: tenant-scope — reports only the target user's problems`
4. `reprojectAllLegacyColumns: idempotent — second call succeeds without error`
Each `createAccount` call includes all required fields (`institution: null`, `accountLast4: null`, `holderName: null`, `currency: "INR"`) since `CreateAccount = z.infer<>` requires them.

**T6** (backup.test.ts):
- Schema import: removed `transactionSplits`, `transferLinks`
- Reconcile import: removed `reconcileUserPostings`, kept `findInconsistentPostings`
- Added: `createTransaction, setSplits, softDeleteTransaction` (transactions), `createTransfer` (transfers), `updateAccount` (accounts)
- Fixture replacement: 5 raw inserts → service calls; opening balance via `updateAccount` + query to recover the opening txn id
- Deleted source-side reconcile block (3 lines: comment + call + assertion)
- `summary.postings!.repaired > 0` → `summary.postings!.repaired === 0` (PR-G1 validate callback hardcodes `repaired: 0`)
- Posting ID uniqueness check removed (in PR-G1 archived posting IDs ARE preserved); replaced with size-equality check
- `sysClearing` declaration removed; two transfer assertLegs replaced with single `xfer.transactionId` assertion

## Commands Run

```
npm run typecheck
npm run lint
node --test apps/api/src/modules/ingest/services/inbox.test.ts 2>&1 | tail -20
node --test apps/api/src/modules/ledger/services/epf-contributions.test.ts 2>&1 | tail -20
node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts 2>&1 | tail -20
node --test apps/api/src/lib/postings-periods-parity.test.ts 2>&1 | tail -20
node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts 2>&1 | tail -20
```

## Typecheck Output + Exit Code

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

**Exit code: 0** — no errors across all 6 workspaces.

## Lint Output + Exit Code

```
> compass@0.1.0 lint
> eslint .
```

**Exit code: 0** — no errors.

## Test Output per File (commands 5–9)

All 5 files fail at module load time because `DATABASE_URL` is not set. This is the expected guard — each file calls `requireDatabaseUrl()` before registering tests. No actual test assertion failure was observed.

### 5. inbox.test.ts

```
Error: inbox.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) —
this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before running
`npm run test -w apps/api`.
    at requireDatabaseUrl (file:///.../inbox.test.ts:153:11)
    ...
✖ apps/api/src/modules/ingest/services/inbox.test.ts (1063.363207ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1  ℹ skipped 0
```

### 6. epf-contributions.test.ts

```
Error: epf-contributions.test.ts's DB-backed tests need DATABASE_URL set ...
✖ apps/api/src/modules/ledger/services/epf-contributions.test.ts (973.217165ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1  ℹ skipped 0
```

### 7. postings-pr-e-parity.test.ts

```
Error: ... DATABASE_URL set ...
✖ apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts (1042.440ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1  ℹ skipped 0
```

### 8. postings-periods-parity.test.ts

```
Error: ... DATABASE_URL set ...
✖ apps/api/src/lib/postings-periods-parity.test.ts (1025.559ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1  ℹ skipped 0
```

### 9. reconcile-postings.test.ts

```
Error: reconcile-postings.test.ts's DB-backed tests need DATABASE_URL set —
export it before running `npm run test -w apps/api`.
✖ apps/api/src/modules/ledger/services/reconcile-postings.test.ts (925.624ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1  ℹ skipped 0
```

## Complete git diff per changed file

See captured diff output (too large to inline; available via `git diff HEAD -- <file>`). Summary:

- **inbox.test.ts**: 2 lines changed (`, false` removed from each linkTransfer call)
- **epf-contributions.test.ts**: 1 line changed (`transferLinkId` → `isTransfer`)
- **postings-pr-e-parity.test.ts**: 3 lines changed (comment + field name)
- **postings-periods-parity.test.ts**: 20 lines removed (7d block + rebuildPostingsForTransaction import), 3 lines changed (unlink/relink)
- **reconcile-postings.test.ts**: ~220 lines replaced with ~90 lines of new test content
- **backup.test.ts**: ~90 lines of raw insert fixture replaced with ~45 lines of service calls; ~15 assertion lines updated

## Assumptions

1. `CreateAccount = z.infer<typeof CreateAccountSchema>` requires all fields because Zod v4 `z.infer` gives the output type. Fields with `.default()` must be passed explicitly when constructing a `CreateAccount` value (e.g. `institution: null, currency: "INR"`).

2. The `updateAccount` call in T6 works on raw-inserted bank accounts (no `systemKind` set, defaults to null; the guard `systemKind !== null` passes).

3. The opening balance transaction created by `updateAccount` is recoverable via `db.select` on `transactions.isOpening === true` for the bank account, since there is exactly one such row.

## Unresolved Risks

1. **backup.test.ts B1 test** ("A6 AC3 OLD-style: restore re-synthesizes postings from an archive with no postings") at line ~827 still asserts `summary.postings!.repaired > 0` but the default `validate` callback hardcodes `repaired: 0`. This test was out of scope per the brief (scope limited to lines ~680-728 of the AC3+AC4 test). It will fail at runtime when DATABASE_URL is available. Needs a follow-up.

2. The `openingRow` query in backup.test.ts uses `eq(transactions.isOpening, true)`. If future tests add multiple opening rows for the same account (unlikely), the `[0]` destructure would pick an arbitrary one. Currently safe since the account starts with no opening row and `updateAccount` creates exactly one.
