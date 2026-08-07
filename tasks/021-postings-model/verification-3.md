# Verification-3: A3-fix + A4a + A4b dual-write slices
Branch: feat/postings-model-dualwrite  
Date: 2026-08-06

---

## Command 1: git status --porcelain
**Exit code: 0**

```
 M apps/api/drizzle/meta/_journal.json
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
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/COMMIT_MSG.txt
?? tasks/021-postings-model/DELEGATION-dualwrite-pr-a.md
?? tasks/021-postings-model/PLAN-dualwrite.md
?? tasks/021-postings-model/PR_BODY.md
?? tasks/021-postings-model/backend-2.md
?? tasks/021-postings-model/backend-3.md
?? tasks/021-postings-model/backend-4.md
?? tasks/021-postings-model/backend-5.md
?? tasks/021-postings-model/backend-6.md
?? tasks/021-postings-model/backend-7.md
?? tasks/021-postings-model/review-5.md
?? tasks/021-postings-model/review-6.md
?? tasks/021-postings-model/review-7.md
?? tasks/021-postings-model/review-8.md
?? tasks/021-postings-model/review-9.md
?? tasks/021-postings-model/state-1.md
?? tasks/021-postings-model/verification-2.md
?? tasks/BATCH-phase1-close.md
```

---

## Command 2: git diff --stat main -- apps/api
**Exit code: 0**

```
 apps/api/drizzle/meta/_journal.json                |   7 +
 apps/api/src/db/schema.decomposition.test.ts       |  14 +-
 apps/api/src/db/shared/hubs.ts                     |  30 +++-
 apps/api/src/db/shared/ledger.ts                   |  28 +++
 apps/api/src/lib/ownership.ts                      |  21 ++-
 .../src/modules/credit/services/bank-details.ts    |   3 +-
 apps/api/src/modules/credit/services/emis.ts       |   5 +-
 .../modules/credit/services/overdraft-details.ts   |   5 +-
 apps/api/src/modules/ingest/services/imports.ts    |  72 ++++++++
 .../investments/services/sip-commitments.ts        |   3 +-
 .../modules/investments/services/sip-lifecycle.ts  |   4 +-
 apps/api/src/modules/ledger/schema.ts              |   2 +-
 apps/api/src/modules/ledger/services/accounts.ts   |  55 ++++--
 apps/api/src/modules/ledger/services/categories.ts |  24 +++
 .../modules/ledger/services/epf-contributions.ts   |   3 +-
 .../src/modules/ledger/services/postings.test.ts   |  56 ++++++
 apps/api/src/modules/ledger/services/postings.ts   |  42 ++++-
 apps/api/src/modules/ledger/services/recurring.ts  |  28 ++-
 apps/api/src/modules/ledger/services/search.ts     |   2 +-
 .../src/modules/ledger/services/transactions.ts    | 194 ++++++++++++++++++---
 apps/api/src/modules/ledger/services/transfers.ts  | 108 ++++++++----
 .../src/modules/protection/services/retirement.ts  |   5 +-
 apps/api/src/modules/system/services/auth.ts       |   2 +
 apps/api/src/modules/system/services/demo.ts       |  19 +-
 24 files changed, 631 insertions(+), 101 deletions(-)
```

(Note: 4 new/untracked files in apps/api not reflected in the --stat above:
 apps/api/drizzle/0067_illegal_shocker.sql,
 apps/api/drizzle/meta/0067_snapshot.json,
 apps/api/src/lib/account-type.ts,
 apps/api/src/modules/ledger/services/post-entry.ts)

---

## Command 3: npm run typecheck -w apps/api
**Exit code: 0**

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```

No errors. Clean.

---

## Command 4: npm run lint
**Exit code: 0**

```
> compass@0.1.0 lint
> eslint .
```

No errors or warnings.

---

## Command 5: node --test apps/api/src/modules/ledger/services/postings.test.ts
**Exit code: 0**

```
✔ assertSafePaise rejects non-safe integers (3.738362ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.436804ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (8.683088ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.343217ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.237063ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.288973ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.40238ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.255087ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.324157ms)
✔ buildTransferPostings: rejects non-positive amounts (0.420545ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.315914ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.209488ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.148769ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.270079ms)
✔ classifyShape + projections round-trip: ordinary (0.443707ms)
✔ classifyShape + projections round-trip: split (0.339644ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.220675ms)
✔ classifyShape + projections round-trip: opening (0.267709ms)
✔ classifyShape: transfer classifies as 'transfer' (0.361707ms)
✔ classifyShape: degenerate shapes throw (0.269015ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 195.950468
```

**Result: 20 pass, 0 fail.**

---

## Command 6: node --test apps/api/src/db/schema.decomposition.test.ts
**Exit code: 0**

```
▶ db/schema.ts decomposition
  ✔ exports exactly 51 tables + 39 enums + users with no duplicates (1.719035ms)
  ✔ has Object.is-identical tables for all residents (0.713215ms)
  ✔ has Object.is-identical enums for all residents (0.5762ms)
✔ db/schema.ts decomposition (4.470191ms)
ℹ tests 3
ℹ suites 1
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 934.325012
```

**Result: 3 pass, 0 fail.**

---

## Complete file diff list vs main under apps/api

From `git diff --name-only main -- apps/api` (tracked modified files):

```
apps/api/drizzle/meta/_journal.json
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

Untracked new files in apps/api (from `git ls-files --others --exclude-standard -- apps/api`):

```
apps/api/drizzle/0067_illegal_shocker.sql
apps/api/drizzle/meta/0067_snapshot.json
apps/api/src/lib/account-type.ts
apps/api/src/modules/ledger/services/post-entry.ts
```

---

## Files OUTSIDE the expected manifest — analysis

### Expected manifest from brief:
**Writer graph:** modules/ledger/services/{transactions,transfers,accounts,recurring,categories}.ts, modules/ingest/services/imports.ts, modules/system/services/demo.ts

**Foundation (A1/A2):** db/shared/hubs.ts, db/shared/ledger.ts, modules/ledger/schema.ts, db/schema.ts, lib/account-type.ts, lib/ownership.ts, modules/ledger/services/{postings,post-entry,search}.ts, modules/ledger/services/postings.test.ts, db/schema.decomposition.test.ts, modules/system/services/auth.ts, credit/investments/protection narrowing sites (bank-details, emis, overdraft-details, sip-commitments, sip-lifecycle, retirement), drizzle/0067_* migration

### Findings:

**FLAG — UNEXPECTED FILE:**
- `apps/api/src/modules/ledger/services/epf-contributions.ts` — modified in the working tree (3 lines changed), NOT listed in the expected manifest. This is a narrowing site like the credit/investments/protection files, but for EPF. It may be legitimate (same postings-model narrowing pattern applied to EPF as well) but it was not declared in the brief's expected set.

**MISSING from diff (expected but absent):**
- `apps/api/src/db/schema.ts` — listed in A1/A2 foundation but shows NO diff from main. Inspection confirms it exists identically on both HEAD and main. This is consistent with `db/schema.ts` having been updated in SP0 (PR #166, merged to main before this branch was created) — its changes are already on main and won't appear in a diff.

**No files outside apps/api were touched:** packages/shared, apps/web, and reader/aggregation files (balances.ts, periods.ts, dashboard.ts) are NOT in the diff.

---

## Summary table

| Command | Exit code | Result |
|---------|-----------|--------|
| git status --porcelain | 0 | — |
| git diff --stat main -- apps/api | 0 | 24 tracked files, 4 new untracked |
| npm run typecheck -w apps/api | 0 | PASS (clean) |
| npm run lint | 0 | PASS (clean) |
| node --test postings.test.ts | 0 | 20 pass, 0 fail |
| node --test schema.decomposition.test.ts | 0 | 3 pass, 0 fail |
