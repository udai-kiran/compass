# Sonnet Worker Delegation

## Task
005-fix-api-test-env-loading

## Approved Plan
- P1: edit the one script line in `apps/api/package.json`
- P2: run `npm run test -w apps/api` from repo root with no manually
  exported env vars in that shell invocation, confirm exit 0 / all tests pass
- P3: re-read `.github/workflows/ci.yml`'s `check` job to confirm it still
  sets `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` explicitly via `env:` on
  the `npm test` step (must remain unchanged by this task)

## Files and Symbols
- `apps/api/package.json` — `"scripts"."test"` value only

## Required Changes
In `apps/api/package.json`, change:

```json
"test": "node --test \"src/**/*.test.ts\"",
```

to:

```json
"test": "node --env-file-if-exists=../../.env --test \"src/**/*.test.ts\"",
```

This exactly matches the flag/path (`--env-file-if-exists=../../.env`)
already used by this same file's `dev`, `start`, `db:generate`, `db:migrate`,
`db:seed`, `db:bootstrap`, and `db:restore` scripts. Change nothing else on
that line or elsewhere in the file.

## Must Not Change
- `.github/workflows/ci.yml` — must remain untouched. Confirm (read-only)
  that its `check` job's `npm test` step still sets `DATABASE_URL`,
  `REDIS_URL`, `SESSION_SECRET` via `env:` — report what you see, don't edit.
- No other workspace's `package.json` (`packages/ai`, `packages/shared`,
  `apps/web`, `apps/ingestor`, `apps/extractor`) — out of scope, do not touch.
- No test file, source file, or migration.
- Root `/home/udai/PennyPilot/.env` — do not modify.

## Acceptance Criteria
- AC1: In a **fresh shell/Bash invocation that has never exported
  `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET`/etc.** (do not `source .env`
  or otherwise pre-export anything before this command — that would
  invalidate the test), running `npm run test -w apps/api` from repo root
  exits 0.
- AC2: The `node:test` summary line for that run shows 0 `fail`. Quote it
  literally.
- AC3: `git diff apps/api/package.json` shows exactly the one script-line
  change — nothing else.
- AC4: `.github/workflows/ci.yml` is confirmed unmodified
  (`git status --short` shows no change to it).

## Commands
1. Edit `apps/api/package.json`'s `test` script as above.
2. Open a **new** Bash tool call (fresh shell state, guaranteeing no leftover
   exported vars from any earlier command in this session) and run:
   `npm run test -w apps/api` from `/home/udai/PennyPilot`. Capture full
   output tail (final summary block) and exit code (`echo $?` in the SAME
   command, e.g. `npm run test -w apps/api; echo "EXIT:$?"`).
3. `git diff apps/api/package.json`
4. `git status --short -- .github/workflows/ci.yml`
5. `npm run typecheck` and `npm run lint` (repo root) — confirm both still
   exit 0 (should be unaffected by this change, but verify).

## Required Evidence
- The literal diff of `apps/api/package.json`.
- The full `node:test` summary line (tests/suites/pass/fail/...) and the
  captured exit code from step 2, run in a shell verified to have had no
  prior env exports.
- Output of `git status --short -- .github/workflows/ci.yml` (must be empty).
- `npm run typecheck` / `npm run lint` exit codes.
- Any plan deviations or blockers, called out explicitly.
