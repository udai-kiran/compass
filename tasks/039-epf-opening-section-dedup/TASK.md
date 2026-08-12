# Task: De-duplicate EpfOpeningSection on main and land the real opening-balance fix

## Status
CODE_REVIEW — implemented; Codex plan review (review-1.md) and implementation
review (review-2.md) both passed with all findings adjudicated below. Awaiting
independent verification evidence, then git delivery (commit → PR → CI green →
merge → release).

## Objective
`main` compiles again, and the EPF account detail page's opening balance actually
persists: after saving, the "Total PF balance" field retains the value, it survives
navigation, and "Save" is disabled only when the field matches what is stored.

Concretely: `apps/web/src/routes/settings/AccountDetailPage.tsx` declares
`function EpfOpeningSection` exactly ONCE, `npm run typecheck` exits 0, CI is green
on `main`, and a release tag publishes images.

## Root Cause

Two independent root causes, stacked.

**RC1 — the build break.** `main`'s history is
`caa5f2d (#188) → f19b152 (#189 "epf opening balance fix") → 3e5bb2c (#190) → 38ae9a2 (#191)`.
Branch `fix/epf-save-in-accounts-page` forked at `caa5f2d` and never contained
`#189`. `#189` had already added `function EpfOpeningSection` (at its line 376).
Task 038's commit `0da6688` independently added a *different* component with the
same name. PR #191 was a **squash** merge, so our diff was replayed onto a `main`
that already had that name — producing two top-level declarations, at `main:308`
and `main:439`, and `TS2393: Duplicate function implementation` at both. Squashing
discarded the ancestry that would have surfaced the collision.

Proof:
- `git show f19b152:…AccountDetailPage.tsx | grep -n "function EpfOpeningSection"`
  → `376:function EpfOpeningSection(…)`
- `git log --oneline -S 'function EpfOpeningSection' -- …` on our branch → `0da6688`
- `git show origin/main:… | grep -n "EpfOpeningSection"` → `110:` (call site),
  `308:` (decl), `439:` (decl)

**RC2 — the original bug is still present, in the surviving component.**
`#189`'s section (`main:439-607`) seeds and dirty-checks against
`account.openingBalancePaise`, which `carriesOpeningAsTransaction` pins at 0 for
every account type (`apps/api/src/modules/ledger/services/accounts.ts:19-24`;
`createAccount` writes 0 at `:245`, and `services/reconcile-postings.ts:128-150`
refuses to boot against a DB holding nonzero values). So it is 0 for any
invariant-conforming database past the boot gate — raw SQL or test fixtures could
still hold nonzero. `grep openingTransactionPaise` over `main:439-607` returns
**no match**. So the field blanks after every save and `dirty` is true for any
non-zero total.

Task 038 applied its P3 fix to the WRONG component: it patched
`OpeningBalanceSection` (correct, and worth keeping) and created a competing
`EpfOpeningSection`, while `#189`'s EPF-specific component — the one actually
rendered for `type === "epf"` — was left untouched.

**Why 038's fix would have been a silent no-op even if it compiled.** There is one
call site (`main:110`) and both declarations are top-level `function`s in the same
module, so the *later* declaration wins at runtime. Users would have rendered
`#189`'s buggy component with 038's fix as dead code. Only `tsc` failing prevented
that from shipping.

## Scope
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — the ONLY source file to change.
  - delete the `EpfOpeningSection` introduced by `0da6688` (`main:308-364`)
  - repoint the surviving `EpfOpeningSection` (`main:439-607`) at
    `openingTransactionPaise`
- New branch off `origin/main`. NOT `fix/epf-save-in-accounts-page` (already
  merged; its tree lacks `#189`).

Already correct on `main`, do NOT touch:
- `packages/shared/src/schemas/ledger.ts:202` — `openingTransactionPaise: z.number().int()`
- `apps/api/src/modules/ledger/services/accounts.ts:200,219-222,226` — the
  `openingTxnPaise` aggregate + safe-integer guard
- `OpeningBalanceSection` (already uses `openingTransactionPaise`)
- `apps/web/src/routes/accounts/account-groups.test.ts:16` — factory already updated

## Dependencies
Task 038 (merged as #190/#191, left `main` red). This task supersedes 038's P3.

## Plan
- **P1:** Branch off `origin/main` as `fix/epf-opening-section-dedup`.
- **P2:** Delete the whole `EpfOpeningSection` block at `main:308-364` — the
  single-field version from `0da6688` (identifiable by: one `Field label="Total PF
  balance"`, no `retData`, no `useRetirementDetails`, no `epsText`) together with
  its preceding `/** … */` doc comment. Keep the `#189` version (identifiable by
  `useRetirementDetails`, `epsText`, `parseEpsInput`, two `Field`s).
- **P3:** In the surviving `EpfOpeningSection`, replace
  `account.openingBalancePaise` with `account.openingTransactionPaise` at
  **four token occurrences across three semantic locations** (`origin/main` line
  numbers):
  1. the `useState` initialiser for `totalText` — line 445
  2. the `useEffect` that re-seeds `totalText` — body line 452 **and**
     dependency array line 453 (two separate tokens; the dep is easy to miss)
  3. the `dirty` comparison `totalPaise !== account.openingBalancePaise` — line 502

  After the edit the component must contain **zero** occurrences of
  `account.openingBalancePaise`. Leave the EPS half untouched: it correctly
  compares `epsPaise !== (retData?.epsBalancePaise ?? 0)`.
- **P4:** Nothing else changes. Do NOT touch the two-step
  `update` → `saveRetirement` save, the `retIsPending` "Loading…" early return,
  `RetirementSection`, `submit`'s PATCH body (`openingBalancePaise: totalPaise` is
  the correct WRITE field — only the READ path changes), or any copy/hint text.

## Acceptance Criteria
- **AC1:** `grep -c "function EpfOpeningSection"` on the file === 1.
- **AC2:** `npm run typecheck` (repo root, all workspaces) exits 0 — no TS2393.
- **AC3:** `npm run lint` exits 0.
- **AC4:** `npm test` exits 0 with `DATABASE_URL`/`REDIS_URL` set (the api suite
  throws at import time without them). Report pass/fail counts.
  **RESOLUTION:** neither var is set on this machine and there is no local
  Postgres, so this CANNOT be proven locally — and I will not claim it is.
  AC4 is discharged by the PR's CI run, which provisions Postgres 18 + Redis 7
  as `services:` and injects both vars before `npm test`
  (`.github/workflows/ci.yml:11-33,46-50`). That is a stronger signal than a
  local run against a hand-rolled DB. AC4 therefore merges into AC7: no merge
  until the PR's CI `check` job is green.
- **AC5:** The surviving `EpfOpeningSection` contains zero references to
  `account.openingBalancePaise`, and its total field/effect/dirty all read
  `account.openingTransactionPaise`.
- **AC6:** The EPS sub-balance UI is fully intact — two `Field`s, `parseEpsInput`,
  `epfCorpusPaise` derived row, and the two-step save.
- **AC7:** CI green on the PR (which compiles the real merge ref) AND on `main`
  after merge, quoted by run ID.
- **AC8:** A release tag whose `Publish images` run succeeds and pushes images.

## Verification
- T1: `grep -n "EpfOpeningSection" apps/web/src/routes/settings/AccountDetailPage.tsx`
- T2: `grep -n "openingBalancePaise\|openingTransactionPaise"` over the surviving block
- T3: `npm run typecheck` — exit 0
- T4: `npm run lint` — exit 0
- T5: `npm test` with DB env — exit 0 + counts
- T6: complete `git diff origin/main` of the change
- T7: `gh run list` proving green on PR and on `main`

## Non-Goals
- The missing DB-backed `listAccounts`/`openingTransactionPaise` test (review-1 and
  review-2 both asked for it; deferred → task 040)
- Enforcing the "at most one active `is_opening` row" invariant (review-1 High;
  deferred → task 040)
- The `RetirementSection` / `EpfOpeningSection` EPS double-edit overlap (EPS is
  editable in two places on one page because `isRetirementAccount("epf")` is true;
  deferred → task 041)
- Any EPF UX redesign, contribution-modal change, or migration

## Codex review-1 findings (plan gate) — all adjudicated
Review: `tasks/039-epf-opening-section-dedup/review-1.md`. All six claims
**verified** against `origin/main`. Findings and my rulings:

- **VALID, fixed — "three reads" was wrong.** There are **four** token
  occurrences (445, 452, 453, 502) across three semantic locations. The
  `useEffect` dependency is a separate token and the easiest to miss. P3 reworded;
  added to AC5 and to the delegation's evidence requirements.
- **VALID, fixed — "always 0 at runtime" needed qualifying.** True for an
  invariant-conforming DB past the boot gate (`services/reconcile-postings.ts:128-150`
  rejects nonzero at startup; `createAccount` writes 0 at `accounts.ts:245`).
  Raw SQL or test fixtures can still create nonzero values. Wording qualified.
- **VALID, fixed — claim of "no regression" was too absolute.** AC2-AC4/AC7/AC8
  need execution, not inspection. Softened; the ACs already demand real runs.
- **USEFUL, de-risks the delete — nothing becomes unused.** Codex verified
  `openingBalanceToInput` (367, 371), `openingBalanceFromInput` (373, 467),
  `editsOpeningBalanceAsAmount` (388), `DerivedRow` (849), `formatINR`,
  `isLiabilityAccount`, `useRetirementDetails`, `useRetirementDetailsMutation`
  all retain other uses. No import or helper should go lint-unused.
- **USEFUL, no change needed — dirty logic is sound in every state.** Verified:
  loading (`retResolved` false → Save disabled), stored 0 (blank ↔ 0, clean),
  clearing a nonzero total (dirty true, backend deletes the row), EPS blank vs
  `?? 0`, and validation errors forcing `hasError` → Save disabled. The liability
  path is N/A: this component renders only for `type === "epf"`.
- **NOTED, not a regression** — the two-step save is non-transactional (total can
  succeed while EPS fails); the component already surfaces this and stays
  retryable. Inputs stay enabled during save, so a refetch can clobber typed
  text. Both pre-existing; out of scope.
- **NOTED** — `openingTxnPaise` has no `date <= current_date` cut, unlike
  `balancePaise`, so it includes future-dated opening rows. Correct for an
  opening-value editor; capture it in task 040's test.
- **REJECTED for this task — "do not defer all tests."** Codex is right in
  principle and I am overriding deliberately: `main` is red, so every hour costs
  a broken default branch and an unpublishable release. The fix is one deletion
  plus four tokens, and `tsc` itself is the regression test for the duplicate
  (AC1/AC2). The component-level tests Codex wants would need a React test
  harness this repo does not have (web tests are pure `node:test` logic tests,
  e.g. `account-groups.test.ts`) — that is new infrastructure, not a test.
  The DB-backed `listAccounts` test is real and owed: it is task **040**, filed
  as a committed task file, not a promise. Implementer must CONFIRM the absence
  of a React test harness; if one exists, escalate — that changes this ruling.

## Codex review-2 findings (implementation gate)
Review: `tasks/039-epf-opening-section-dedup/review-2.md`. Verdict: implementation
matches the approved plan; no code defect, no out-of-scope tracked edit.

- **P1-P4 PASS.** Merge base, HEAD and `origin/main` all `38ae9a24`. The deleted
  block was confirmed the obsolete single-field one (origin 302-364, one `Field`,
  no retirement query); the survivor is EPS-aware at `:376`.
- **P3 PASS — all four tokens, dependency array included** (382, 389, 390, 439).
  That was the finding most likely to be missed; it was not missed.
- **AC1, AC2, AC3, AC5, AC6 PASS** with line evidence. Write field intact at
  `:449` (`openingBalancePaise: totalPaise`) — correctly distinguished from the
  read path.
- **AC4 FAIL/not verified** — see AC4's resolution above; discharged via CI.
- **AC7, AC8 not yet applicable** — nothing committed at review time. Correct.
- **Whitespace:** the collapsed blank line is the only incidental change;
  `git diff --check` reports no whitespace errors. Accepted.
- **No unused imports/helpers/dangling comments**; protected areas byte-identical
  after accounting for the 63-line deletion.
- **Round trip confirmed** through `accounts.ts:475,487-521,542-549` →
  `listAccounts:190-226` → `queries.ts:68` invalidation → effect `388-390`
  reseeds → dirty `436-440` goes false. Holds under the single-opening-row
  invariant deferred to task 040.
- Codex noted untracked `screen-shots/` and task artifacts exist in the tree and
  it cannot attribute them. Correct — they must NOT be staged.

## Independent verification (non-implementing worker) — literal evidence
- `git diff --name-only origin/main` → **exactly one file**:
  `apps/web/src/routes/settings/AccountDetailPage.tsx`
- `git diff --stat origin/main` → `1 file changed, 4 insertions(+), 67 deletions(-)`
- `grep -c "function EpfOpeningSection"` → **1**. Declaration at `:376`, single
  call site at `:110`.
- The complete diff contains **only** the 63-line deletion and the four token
  replacements. **No whitespace-only change appears** — the trailing blank line
  came away with the deleted block, so the implementer's "collapsed a double blank
  line" note has no separate edit behind it. Confirmed against the raw diff.
- Surviving component reads `openingTransactionPaise` at 382, 389, 390, 439 and
  holds **zero** reads of `account.openingBalancePaise`. The two remaining
  `openingBalancePaise` occurrences are the intended PATCH **writes** (`:318` in
  `OpeningBalanceSection`, `:449` in `EpfOpeningSection`); `:325` is
  `OpeningBalanceSection`'s `editsOpeningBalanceAsAmount` read, a different
  component and correctly untouched.
- EPS half intact: `useRetirementDetails` 378, `saveRetirement` 379, `epsText` 384,
  `parseEpsInput` 407, `epfCorpusPaise` 420, `retIsPending` early return 480.
- `npm run typecheck` (root) → **exit 0**, all 7 workspaces clean.
- `npm run lint` → **exit 0**.
- `npm test` → **exit 1**, and this is expected and pre-existing: no `.env` exists
  (`ls -la .env` → No such file, exit 2) so `DATABASE_URL`/`REDIS_URL` are unset.
  All 27 failures throw at module load with "needs DATABASE_URL set" before any
  assertion runs — none is a logic failure.
  Counts: api 673 tests / 646 pass / 26 fail (all DB-gated) / 1 skip;
  extractor 63 / 62 / 1 (DB-gated); **web 264/264 pass**;
  **shared 212/212 pass**; ai 32/32 pass; ingestor 12/12 pass.
  The two workspaces this change can affect — web and shared — are fully green.
  AC4 remains discharged via CI.

## Notes carried forward (survive compaction)
- A `pull_request` CI run checks out the **merge ref**, not the PR head. `gh run
  list` reports `headSha` as the PR head, which is misleading — run 31581474131
  was already compiling the duplicated tree. This is why 038 saw "local clean, CI
  red" and wrongly concluded CI was stale.
- A **squash** merge cannot detect a same-named block added at a different anchor
  on both sides. Rebase-then-check, or trust only the PR's merge-ref run.
- `v2.8.13` exists and its release is published, but ALL FOUR publish jobs failed,
  so no images were ever pushed for it. Do not re-point that tag; cut a new one.
- An early subagent reported the two copies' provenance **backwards**. The fork
  point (`caa5f2d`) and `git log -S` are the reliable evidence.
