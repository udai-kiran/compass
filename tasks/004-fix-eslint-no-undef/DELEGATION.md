# Sonnet Worker Delegation

## Task
004-fix-eslint-no-undef

## Approved Plan
- P1: `rm apps/api/investigate-card-details.tmp.mjs apps/api/investigate-card-details2.tmp.mjs`
- P2: add a `scripts/**/*.mjs` globals override block to `eslint.config.js`
- P3: run `npm run lint` from repo root and confirm exit 0

## Files and Symbols
- `apps/api/investigate-card-details.tmp.mjs` — delete
- `apps/api/investigate-card-details2.tmp.mjs` — delete
- `/home/udai/PennyPilot/eslint.config.js` — add one new config object to the
  `tseslint.config(...)` array

## Required Changes
1. Delete both files:
   - `apps/api/investigate-card-details.tmp.mjs`
   - `apps/api/investigate-card-details2.tmp.mjs`
   Confirmed untracked with no git history (`git log --all -- <path>` empty,
   `git rev-list --all --objects` doesn't contain them) and no repo
   references — safe to delete outright, not via `git rm` (they were never
   tracked).

2. In `eslint.config.js`, add a new object to the `tseslint.config(...)` call
   (after the existing `{ files: [...], rules: {...} }` block for AI SDK
   imports, as the last array element before the closing `);`):

   ```js
   {
     files: ["scripts/**/*.mjs"],
     languageOptions: {
       globals: {
         process: "readonly",
         console: "readonly",
       },
     },
   },
   ```

   Do not add the `globals` npm package as a dependency. Do not broaden this
   to `apps/**` or `packages/**`. Do not change any existing rule.

## Must Not Change
- No other file in the repo.
- No existing eslint rule severity or scope.
- Do not touch the many pre-existing `D` (deleted) entries or other unrelated
  `??` untracked files visible in `git status` — this task's diff must be
  exactly: 2 file deletions + `eslint.config.js` addition.

## Acceptance Criteria
- AC1: `npm run lint` (from repo root) exits 0 with no errors/warnings.
- AC2: Neither `.tmp.mjs` file exists afterward.
- AC3: The new eslint override is scoped to `scripts/**/*.mjs` only.
- AC4: `npm run typecheck` still exits 0 afterward.

## Commands
1. `rm apps/api/investigate-card-details.tmp.mjs apps/api/investigate-card-details2.tmp.mjs`
2. Edit `eslint.config.js` as above.
3. `npm run lint` (repo root) — must exit 0.
4. `npm run typecheck` (repo root) — must exit 0.
5. `git status --short` — to show the resulting diff/untracked state.

## Required Evidence
- Full diff of `eslint.config.js` (before/after or `git diff` — note it will
  show as new content since the file is tracked; run `git diff eslint.config.js`).
- Confirmation both `.tmp.mjs` files are gone (`ls` or `git status --short`).
- Literal `npm run lint` output and exit code.
- Literal `npm run typecheck` output and exit code (or at least final
  success lines + exit code).
- Any plan deviations or blockers, called out explicitly.
