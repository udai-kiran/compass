# Task: 057 — Green the baseline (typecheck + lint)

## Status
COMPLETE

## Outcome (verified)
Baseline is green. `npm run typecheck` exit 0 (all 7 workspaces), `npm run lint`
exit 0 (0 errors, 0 warnings). Final suite: **1335 total, 1308 pass, 26 fail,
1 skipped** — all 26 failures `DATABASE_URL`-gated, the 1 skip pre-existing.
`postings.test.ts` runs 24/24. Six files changed, annotation-only; no dependency
file touched. Changes are **unstaged and uncommitted** (no commit was requested).

The pass-count discrepancy is settled: the implementer reported 1306, but Codex
(`review-2.md`) and the independent verifier (`verification-1.md`) agree on 1308,
which is the figure that reconciles (1308 + 26 + 1 = 1335). Treat 1308 as correct.

## Objective
`npm run typecheck` and `npm run lint` both exit 0 from the repo root, with no
change to test pass/fail counts. This unblocks all v2.2.0 feature work, which
must not be built on a red baseline.

## Root Cause

Two independent defects, both introduced on this branch:

1. **typecheck (18 errors, all in `apps/api/src/modules/ledger/services/postings.test.ts`)**
   `postings.test.ts:3` does `import fc from "fast-check"`. **The stale
   `node_modules` tree is the whole defect** — `package.json` and
   `package-lock.json` already agree and are correct:
   - `apps/api/package.json:36` declares `fast-check: "^4.9.0"`.
   - `package-lock.json:46` has the workspace dependency and
     `package-lock.json:13431` has a full `resolved` + `integrity` entry for
     4.9.0, added by commit `559fa2e` (2026-08-14).
   - Neither `node_modules/fast-check` nor its dependency
     `node_modules/pure-rand` is physically present; `npm ls fast-check`
     reports an empty tree.

   So `node_modules` was last materialised from a state predating `559fa2e`.
   **Corrected history:** commit `b829d87`'s 499 lockfile deletions were all
   optional `@esbuild/*` platform binaries — it did *not* touch `fast-check`,
   which is present in the lockfile both before and after it. My initial
   attribution to `b829d87` was wrong.

   The 1 × TS2307 (cannot find module) cascades into 17 × TS7006: the
   `fc.property` callback params at lines 61, 373, 399, 432, 459 are
   *contextually* typed by `fc.property` once `fast-check` resolves, so they do
   **not** need explicit annotations. `strict`/`noImplicitAny` is inherited from
   `tsconfig.base.json:7`. Restoring resolution therefore fixes all 18.
   → Confirmed independently by `investigation-1.md` and `review-1.md` §1–2.

2. **lint (10 errors)** — leftover from the Phase 4 household work:

   | File | Line | Rule |
   |---|---|---|
   | `apps/api/src/modules/household/routes/splits.ts` | 25 (×3), 35 (×1) | `no-explicit-any` |
   | `apps/api/src/modules/household/routes/settlements.ts` | 21 (×2) | `no-explicit-any` |
   | `apps/api/src/modules/household/services/grants.ts` | 59 | `no-explicit-any` |
   | `apps/api/src/modules/household/services/membership.ts` | 1 | `no-unused-vars` (`gt`) |
   | `apps/api/src/modules/planning/services/income-surplus.test.ts` | 6 | `no-unused-vars` (`IncomeSurplusComputation`) |
   | `apps/web/src/lib/household-queries.ts` | 4 | `no-unused-vars` (`AcceptInviteSchema`) |

   The `any`s are unnecessary: every type needed already exists. Drizzle tables
   `splits`, `splitShares`, `settlements`, `sharingGrants` are all exported from
   `modules/household/schema.ts`, and `HouseholdSplit`, `HouseholdSplitShare`,
   `Settlement`, `SharingResourceType` are all exported from
   `packages/shared/src/schemas/household.ts`. These are mapper functions that
   were left untyped, not a genuine typing obstacle.

## Scope
- `node_modules` install state only. **No tracked dependency file is expected to
  change** — neither `package.json` nor `package-lock.json`, since both are
  already correct. If `npm install` does mutate `package-lock.json`, that is a
  surprise to be reported, not accepted silently.
- `apps/api/src/modules/household/routes/splits.ts` — `toSplitResponse`
- `apps/api/src/modules/household/routes/settlements.ts` — `toSettlement`
- `apps/api/src/modules/household/services/grants.ts` — `listGrants` signature
- `apps/api/src/modules/household/services/membership.ts` — import line
- `apps/api/src/modules/planning/services/income-surplus.test.ts` — import line
- `apps/web/src/lib/household-queries.ts` — import line

## Dependencies
None. This blocks all v2.2.0 tasks (058+).

## Plan
- **P0 (applies to P2–P4)**: `tsconfig.base.json:9` sets
  `verbatimModuleSyntax: true`, so every type-only import added in this task
  **must** use `import type { ... }`. A value import of `HouseholdSplit` or
  `Settlement` produces TS1484 and would fail AC1. Drizzle *tables* (`splits`,
  `splitShares`, `settlements`) are values used in `typeof` position and are
  imported normally.
- **P1**: Repair the installed tree so `fast-check@4.9.0` resolves — run
  `npm install`. Do **not** edit `package.json`, and do not pass any flag that
  rewrites the lockfile. Confirm `node_modules/fast-check` and
  `node_modules/pure-rand` now exist, and report whether `package-lock.json`
  changed (expected: unchanged).
- **P2**: `routes/splits.ts` — type the mapper:
  `toSplitResponse(split: typeof splits.$inferSelect, shares: (typeof splitShares.$inferSelect)[]): HouseholdSplit`.
  Import `splits`/`splitShares` from `../schema.ts` and `HouseholdSplit` from
  `@compass/shared`. Drop the inner `(s: any)` annotation — it infers from
  `shares`. Do not change the returned field set or any runtime behaviour.
- **P3**: `routes/settlements.ts` — `toSettlement(row: typeof settlements.$inferSelect): Settlement`,
  importing `settlements` from `../schema.ts` and `Settlement` from `@compass/shared`.
  Preserve the `?? null` normalisations for `transferTransactionId` and `note`.
- **P4**: `services/grants.ts` — **narrow** the signature (not widen; the
  original wording was wrong) from `resourceType?: string` to
  `filters?: { resourceType?: SharingResourceType; resourceId?: string }` and
  delete the `as any` cast at line 59. Fixes the cast at the source rather than
  suppressing it. `SharingResourceType` exactly matches the Drizzle enum values
  at `schema.ts:71`. The sole caller is `routes/sharing.ts:52`, whose
  `req.query.resourceType` already comes from `SharingResourceTypeSchema.optional()`
  (`routes/sharing.ts:12`), so it stays compatible; no caller passes a plain
  `string`. This is type erasure only — the route already rejects out-of-enum
  values via its Zod query schema, so no runtime filtering behaviour changes.
- **P5**: Remove the three unused imports (`gt`, `IncomeSurplusComputation`,
  `AcceptInviteSchema`). Confirm each is genuinely unreferenced in its file first.

## Acceptance Criteria
- **AC1**: `npm run typecheck` exits 0 across all 7 workspaces; the 18
  `postings.test.ts` errors are gone.
- **AC2**: `npm run lint` exits 0 with 0 errors and 0 warnings.
- **AC3**: No remaining `any` in the four touched household files, and no
  `eslint-disable` / `@ts-ignore` / `@ts-expect-error` was used to reach AC1/AC2.
- **AC4**: `postings.test.ts` now actually executes its `fast-check` property
  tests and passes (it must move from "fails to load" to "passes").
- **AC5** *(superseded — see Outcome; the literal "stays 1312" was my own wrong
  assumption, since `postings.test.ts` previously failed to load and so its 24
  tests were never counted. The correct post-fix total is 1335. The invariant the
  criterion was protecting — no non-DB-gated failure, no hidden regression, no new
  skip — was verified and holds.)*: Total test count stays 1312, and **every remaining failure is
  `DATABASE_URL`-gated**. Sources disagree on the exact pre-fix split (one
  reading is 1285 pass / 27 fail, another 1284 / 28), so no number is asserted
  here: the verifier must report the literal observed totals, and the invariant
  to prove is that the failure count *drops by exactly the `postings.test.ts`
  file* and that no non-DB-gated failure remains. Expected post-fix:
  ~1286 pass / 26 fail, of which 25 are API DB-gated and 1 is the extractor's
  `statement-duplicate.test.ts` (which throws when `DATABASE_URL` is absent at
  its line 32).
- **AC6**: No runtime behaviour change, proven structurally rather than by
  asserting byte-identical JSON (there are no household route tests for splits,
  settlements, or sharing, so output equality is not directly observable). The
  checkable form: **the diff must contain no change to any runtime expression or
  statement** — only added type annotations, added/changed `import type` lines,
  and removed unused imports. Every P2–P4 edit is type erasure, so runtime
  identity follows from the diff being annotation-only.
- **AC7**: No `package.json` is modified, and `package-lock.json` is expected to
  be unchanged too (see Scope). Any lockfile diff must be reported and explained,
  not waved through.

## Verification
- **T1**: `npm run typecheck` — capture full output + exit code.
- **T2**: `npm run lint` — capture full output + exit code.
- **T3**: `npm run test` — capture per-workspace pass/fail totals + exit code;
  confirm 1312 total, report the literal pass/fail split, and confirm
  `postings.test.ts` now passes (name it explicitly in the output). Enumerate
  every remaining failing file and confirm each is DB-gated.
- **T4**: `git status --short` plus the full `git diff` — confirm only the 6
  source files changed, that no `package.json` was touched, and report whether
  `package-lock.json` shows any diff. Confirm `screen-shots/` remains untracked
  and unstaged.
- **T5**: `grep -nE "\bany\b" ` across the four touched household files
  (word-boundary — a bare `any` pattern falsely matches `findMany` at
  `services/membership.ts:139`), and **separately**
  `grep -nE "ts-ignore|ts-expect-error|eslint-disable"` across them. Expect no
  `\bany\b` in the four files and no suppression directives anywhere in the diff.
- **T6**: Confirm `node_modules/fast-check` and `node_modules/pure-rand` exist
  and `npm ls fast-check` resolves to 4.9.0.

## Non-Goals
- Fixing the ~26 `DATABASE_URL`-gated test failures. They need a live
  Postgres/Redis and are out of scope for a typecheck/lint baseline task.
- Any v2.2.0 feature work (routes, UI, the 3 unwritten services).
- Upgrading, adding, or removing any dependency; P1 is a pure install repair.
- Adding household route/mapper tests. Codex correctly notes these would be
  needed to *directly* prove output equality, but AC6 is instead met
  structurally via an annotation-only diff. Real test coverage for the
  household routes is worth a follow-up task, not a blocker here.
- Committing `screen-shots/` (untracked, private artifact — must never be staged).

## Review log

### review-1.md — plan review (8 findings, all valid, all resolved)
1. P1 root cause was wrong: lockfile is intact, `node_modules` is stale;
   `b829d87` pruned only `@esbuild/*` optional binaries. → Root Cause rewritten.
2. TS7006 ×17 are genuine cascades, contextually typed by `fc.property`; P1
   alone suffices. → Confirmed, no annotations needed.
3. `verbatimModuleSyntax: true` requires `import type` or TS1484. → Added as P0.
4. P2/P3 type-compatible (Drizzle `Date` ↔ `z.coerce.date()`; bigint
   `mode:"number"` ↔ `z.number().int()`). → Noted so the worker would not "fix" them.
5. P4 is a *narrowing*, not a widening; sole caller already enum-validated. → Wording fixed.
6. Lint scope of 6 files / 10 errors is complete. → Confirmed.
7. AC5's count was wrong. → Rewritten to require empirical reporting.
8. AC6 unverifiable as written; T5's bare `any` pattern false-matches `findMany`.
   → AC6 recast structurally (annotation-only diff ⇒ runtime identity by type
   erasure); T5 changed to `\bany\b` plus a separate suppression grep.

### review-2.md — implementation review: PASS
- P0–P5 all satisfied; AC1–AC4, AC6, AC7 pass directly.
- Six files modified, no scope creep. `routes/sharing.ts` untouched.
- `package-lock.json` and every `package.json` verified unchanged.
- `postings.test.ts` absent from the diff; its 5 fast-check property tests execute
  and pass. Contains **24** tests (not 23 as the implementer said).
- Reconciliation: `1312 + 24 − 1 = 1335` — the old load-failure counted as one
  failed test, so total rises 23 while passes rise 24 and failures drop 1.
- Codex final numbers: **1335 total, 1308 pass, 26 fail, 1 skipped**; all 26
  failures `DATABASE_URL`-gated (guard line cited for each); the 1 skip is the
  pre-existing opt-in storage contract test.
- **AC5's literal "total stays 1312" was my own erroneous assumption**, not an
  implementation defect. The invariant it was protecting (no non-DB-gated failure,
  no hidden regression, no new skip) holds.
- Open discrepancy to settle by independent verification: implementer reported
  1306 passing, Codex 1308. Codex's figures reconcile (1308+26+1=1335); the
  implementer's do not (1306+26+1=1333).

## Decisions / Notes
- Rejected: adding `fast-check` to the root `package.json`. It is a
  workspace-local test dependency and `apps/api/package.json` already declares
  it correctly; the defect is the install state, not the manifest.
- Rejected: deleting or skipping the `fast-check` property tests to green the
  typecheck. That would discard the opening-transaction test coverage
  deliberately added in `2cadca2` and is a regression disguised as a fix.
- Rejected: `eslint-disable` comments for the `no-explicit-any` errors. Real
  types exist for every site; suppression would hide a genuine typing gap in
  the household response mappers.
