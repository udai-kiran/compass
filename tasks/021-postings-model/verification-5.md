# Verification-5: A5a + A5b — reconcile-postings.ts + app.ts boot hook
Branch: feat/postings-model-dualwrite  
Date: 2026-08-06

---

## Command 1: git status --porcelain
**Exit code: 0**

```
 M apps/api/drizzle/meta/_journal.json
 M apps/api/src/app.ts
 M apps/api/src/db/schema.decomposition.test.ts
 M apps/api/src/db/shared/hubs.ts
 M apps/api/src/db/shared/ledger.ts
 M apps/api/src/lib/ownership.ts
 M apps/api/src/modules/credit/services/bank-details.ts
 M apps/api/src/modules/credit/services/emis.ts
 M apps/api/src/modules/credit/services/overdraft-details.ts
 M apps/api/src/modules/ingest/services/imports.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/investments/services/sip-lifecycle.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/ledger/services/accounts.ts
 M apps/api/src/modules/ledger/services/categories.ts
 M apps/api/src/modules/ledger/services/epf-contributions.ts
 M apps/api/src/modules/ledger/services/postings.test.ts
 M apps/api/src/modules/ledger/services/postings.ts
 M apps/api/src/modules/ledger/services/recurring.ts
 M apps/api/src/modules/ledger/services/search.ts
 M apps/api/src/modules/ledger/services/transactions.ts
 M apps/api/src/modules/ledger/services/transfers.ts
 M apps/api/src/modules/protection/services/retirement.ts
 M apps/api/src/modules/system/services/auth.ts
 M apps/api/src/modules/system/services/demo.ts
 M tasks/021-postings-model/DELEGATION.md
 M tasks/021-postings-model/TASK.md
?? apps/api/drizzle/0067_illegal_shocker.sql
?? apps/api/drizzle/meta/0067_snapshot.json
?? apps/api/src/lib/account-type.ts
?? apps/api/src/modules/ledger/services/post-entry.ts
?? apps/api/src/modules/ledger/services/reconcile-postings.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/COMMIT_MSG.txt
?? tasks/021-postings-model/DELEGATION-dualwrite-pr-a.md
?? tasks/021-postings-model/PLAN-A5.md
?? tasks/021-postings-model/PLAN-dualwrite.md
?? tasks/021-postings-model/PR_BODY.md
?? tasks/021-postings-model/backend-10.md
?? tasks/021-postings-model/backend-2.md
...
?? tasks/021-postings-model/state-1.md
?? tasks/021-postings-model/verification-2.md
?? tasks/021-postings-model/verification-3.md
?? tasks/021-postings-model/verification-4.md
?? tasks/BATCH-phase1-close.md
```

---

## Command 2: git diff --name-only main -- apps/api/src
**Exit code: 0**

```
apps/api/src/app.ts
apps/api/src/db/schema.decomposition.test.ts
apps/api/src/db/shared/hubs.ts
apps/api/src/db/shared/ledger.ts
apps/api/src/lib/ownership.ts
apps/api/src/modules/credit/services/bank-details.ts
apps/api/src/modules/credit/services/emis.ts
apps/api/src/modules/credit/services/overdraft-details.ts
apps/api/src/modules/ingest/services/imports.ts
apps/api/src/modules/investments/services/sip-commitments.ts
apps/api/src/modules/investments/services/sip-lifecycle.ts
apps/api/src/modules/ledger/schema.ts
apps/api/src/modules/ledger/services/accounts.ts
apps/api/src/modules/ledger/services/categories.ts
apps/api/src/modules/ledger/services/epf-contributions.ts
apps/api/src/modules/ledger/services/postings.test.ts
apps/api/src/modules/ledger/services/postings.ts
apps/api/src/modules/ledger/services/recurring.ts
apps/api/src/modules/ledger/services/search.ts
apps/api/src/modules/ledger/services/transactions.ts
apps/api/src/modules/ledger/services/transfers.ts
apps/api/src/modules/protection/services/retirement.ts
apps/api/src/modules/system/services/auth.ts
apps/api/src/modules/system/services/demo.ts
```

**Total: 24 tracked modified files** (up from 23 in verification-4; the only net addition is `app.ts`).

Note: New untracked files not included in the above diff (as they are `??` in git status):
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` (NEW - A5b)
- `apps/api/src/modules/ledger/services/post-entry.ts` (NEW - A5a)
- `apps/api/src/lib/account-type.ts` (NEW - pre-existing untracked)

---

## Command 3: npm run typecheck -w apps/api
**Exit code: 0**

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```

Clean. No errors.

---

## Command 4: npm run lint
**Exit code: 0**

```
> compass@0.1.0 lint
> eslint .
```

Clean. No errors.

---

## Command 5: node --test apps/api/src/modules/ledger/services/postings.test.ts
**Exit code: 0**

```
✔ assertSafePaise rejects non-safe integers (3.641153ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.449045ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (8.969905ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.376551ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.220904ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.276917ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.484845ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.280653ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.333788ms)
✔ buildTransferPostings: rejects non-positive amounts (0.413466ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.318459ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.27712ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.203488ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.266903ms)
✔ classifyShape + projections round-trip: ordinary (0.512178ms)
✔ classifyShape + projections round-trip: split (0.315227ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.215302ms)
✔ classifyShape + projections round-trip: opening (0.276802ms)
✔ classifyShape: transfer classifies as 'transfer' (0.357599ms)
✔ classifyShape: degenerate shapes throw (0.29381ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 212.341852
```

**20 pass, 0 fail.**

---

## Command 6: node --test apps/api/src/db/schema.decomposition.test.ts
**Exit code: 0**

```
▶ db/schema.ts decomposition
  ✔ exports exactly 51 tables + 39 enums + users with no duplicates (1.770552ms)
  ✔ has Object.is-identical tables for all residents (0.72413ms)
  ✔ has Object.is-identical enums for all residents (0.562968ms)
✔ db/schema.ts decomposition (4.547485ms)
ℹ tests 3
ℹ suites 1
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 903.374655
```

**3 pass, 0 fail.**

---

## Analysis

### (a) Newly-changed file set vs verification-4 baseline

Verification-4 recorded **23 tracked modified files** under `apps/api/src`. The current diff shows **24 tracked modified files**. Cross-referencing the two lists, the ONLY new tracked file added this round is:

- `apps/api/src/app.ts` — EXPECTED (A5b: imports `reconcileAllPostings` at line 31; calls `reconcileAllPostings(app.db)` in a `.then().catch()` boot hook at line 186, fire-and-forget, non-blocking)

New **untracked** files (not tracked by git yet, thus absent from `git diff --name-only main`):
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` (193 lines) — EXPECTED (A5b)
- `apps/api/src/modules/ledger/services/post-entry.ts` — EXPECTED (A5a, carries `ResolvedSystemAccounts`, `replacePostings`, `resolveSystemAccounts`, `seedSystemAccounts`)
- `apps/api/src/lib/account-type.ts` — was already untracked before A5a/A5b; not new this round

Files the brief called out as needing to be UNCHANGED — verified absent from the diff:
- `apps/api/src/jobs/index.ts` — NOT in diff. UNCHANGED. (app.ts still imports `startJobs` from jobs/index.ts normally; no jobs/index.ts modification)
- `apps/api/src/modules/ledger/services/balances.ts` — NOT in diff. UNCHANGED.
- `apps/api/src/modules/ledger/services/periods.ts` — NOT in diff. UNCHANGED.
- `apps/api/src/modules/dashboard/` — NOT in diff. UNCHANGED.
- `packages/shared` — NOT in diff. UNCHANGED.
- `apps/web` — NOT in diff. UNCHANGED.

The 23 files already present in verification-4 that appear to be callsite integrations of A5 dual-write (`categories.ts`, `recurring.ts`, `imports.ts`) were already modified before this verification round and carry rebuildPostingsForTransaction calls that belong to earlier A5-related sub-work — they are not new additions relative to verification-4. Confirmed that no reader/aggregation/DTO/shared/web file was touched.

### (b) reconcile-postings.ts exports confirmed

`grep -n "^export" apps/api/src/modules/ledger/services/reconcile-postings.ts` returned:

```
69:export async function reconcileUserPostings(
122:export async function reconcileAllPostings(
152:export async function findInconsistentPostings(
```

All three named exports are present. The file is 193 lines.

app.ts boots the reconcile via a fire-and-forget `reconcileAllPostings(app.db).then(pass => ...).catch(err => ...)` call (line 186), importing from `./modules/ledger/services/reconcile-postings.ts` (line 31). The boot hook logs repaired/failure counts but does not block startup on a reconcile failure.

---

## Summary

| Command | Exit Code | Result |
|---|---|---|
| git status --porcelain | 0 | — |
| git diff --name-only main -- apps/api/src | 0 | 24 tracked changed files |
| npm run typecheck -w apps/api | 0 | Clean |
| npm run lint | 0 | Clean |
| postings.test.ts | 0 | 20 pass, 0 fail |
| schema.decomposition.test.ts | 0 | 3 pass, 0 fail |
