# Task: fix-eslint-no-undef

## Status
COMPLETE

## Implementation Review
`review-2.md` — PASS, no blocking issues. Both `.tmp.mjs` files confirmed
deleted (were untracked, so no `git diff` deletion entry — confirmed via
`git ls-files --error-unmatch` exiting 1 for both). `eslint.config.js` diff
is exactly the specified 9-line addition, nothing else changed. `npm run
lint` and `npm run typecheck` both independently re-run by the reviewer,
exit 0. AC1-AC4 all PASS.

## Codex Plan Review
`review-1.md` — no blocking issues. Confirmed both `.tmp.mjs` files are
untracked with no git history anywhere (`git rev-list --all --objects`) and
no consumers. Confirmed the proposed override object is valid flat-config
syntax, eliminates all 25 `no-undef` errors without weakening `no-undef`
elsewhere, and is correctly scoped (`apps/**`/`packages/**` unaffected;
`no-undef` is `off` there via `tseslint.configs.recommended`, which disables
it for typed files in favor of TS's own resolution). Confirmed no other
tracked/untracked `.js`/`.mjs`/`.cjs` files in the repo need the same
override. One wording correction (non-blocking): `scripts/tasks-to-issues.mjs`
*is* referenced elsewhere (documented in `tasks/README.md` and task review
records) — corrected below; doesn't change the plan.

## Objective
`npm run lint` (root `eslint .`) exits 0. Currently it exits 1 with 25
`no-undef` errors (`console`/`process`) across three plain-JS files.

## Root Cause
Two distinct issues, confirmed by direct inspection:

1. `apps/api/investigate-card-details.tmp.mjs` (3 errors) and
   `apps/api/investigate-card-details2.tmp.mjs` (6 errors) are untracked,
   ad-hoc, one-off debug scripts (`git log -- <path>` returns nothing for
   both) that hardcode a live Postgres connection string
   (`postgresql://compass:...@192.168.2.196:5432/compass_dev`) to query
   `card_details`/`users`/`transactions`. They are not part of any deliverable,
   not referenced anywhere else in the repo, and not covered by `.gitignore`.
   Per `CLAUDE.md`: "the repo working tree may contain private artifacts ...
   that must never be committed or dumped." These are exactly that kind of
   artifact — leftover scratch investigation scripts with embedded DB
   credentials. They should be deleted, not special-cased in lint config.

2. `scripts/tasks-to-issues.mjs` (16 errors) is a legitimate, documented
   tooling script (has a header docblock, is referenced in `tasks/README.md`
   and task review records, currently untracked but not gitignored). It uses `console`/`process`, both real Node globals. The root
   `eslint.config.js` never declares Node's global environment for plain JS
   files (`tseslint.config(...)` only sets parser options via the
   typescript-eslint recommended configs, which apply to `.ts`/`.tsx`; plain
   `.mjs`/`.js` files fall under `js.configs.recommended`, which enables core
   `no-undef` with **no** `languageOptions.globals` set). This is a real gap
   in the shared eslint config — the fix is a targeted globals override for
   `scripts/**`, not touching the two deleted debug scripts (which will no
   longer exist) and not touching `apps/**`/`packages/**` (TS files there
   already pass lint; `no-undef` doesn't fire for them under
   `tseslint.configs.recommended`, confirmed by the current clean `apps/**`
   lint run — do not add broad Node globals repo-wide, keep the override
   scoped to `scripts/**`).

## Scope
- Delete `apps/api/investigate-card-details.tmp.mjs`
- Delete `apps/api/investigate-card-details2.tmp.mjs`
- Edit `eslint.config.js`: add one new config object scoped to
  `files: ["scripts/**/*.mjs"]` declaring `languageOptions.globals` with at
  least `process: "readonly"` and `console: "readonly"` (the two globals
  actually used in `scripts/tasks-to-issues.mjs`). Do not add the `globals`
  npm package as a new dependency — it is not currently installed
  (`node_modules/globals` does not exist) and installing it is out of scope
  for a two-global fix; hand-list the globals inline.

## Dependencies
- none (independent of task 005)

## Plan
- P1: `rm apps/api/investigate-card-details.tmp.mjs apps/api/investigate-card-details2.tmp.mjs`
- P2: add the `scripts/**/*.mjs` globals override block to `eslint.config.js`
- P3: run `npm run lint` from repo root and confirm exit 0

## Acceptance Criteria
- AC1: `npm run lint` exits 0 with no errors/warnings.
- AC2: Neither `.tmp.mjs` file exists in the working tree afterward.
- AC3: `eslint.config.js`'s new override is scoped to `scripts/**/*.mjs` only
  — no globals added for `apps/**` or `packages/**`.
- AC4: `npm run typecheck` still exits 0 afterward (unaffected by this
  change, but confirm no regression).

## Verification
- T1: `npm run lint` — literal output, exit code.
- T2: `git status --short` — confirm the two `.tmp.mjs` files are gone and no
  unrelated files changed.
- T3: `npm run typecheck` — exit code 0.

## Non-Goals
- Not touching the 11 DB-env test failures (task 005).
- Not adding the `globals` npm package.
- Not linting/fixing any other untracked scratch files beyond the two named
  above (if the worker discovers more `no-undef`-triggering untracked files
  outside these three, stop and report back rather than deleting/editing them
  unilaterally).
