# Task: fix-api-test-env-loading

## Status
COMPLETE

## Implementation Review
`review-2.md` — PASS, no blocking issues. `apps/api/package.json` diff is
exactly the one script line. Reviewer independently re-ran
`npm run test -w apps/api` in a truly clean environment (`env -i`, only
PATH/HOME/TERM preserved, preflight-confirmed DATABASE_URL/REDIS_URL/
SESSION_SECRET absent beforehand) — exit 0, `793 tests, 793 pass, 0 fail`.
`.github/workflows/ci.yml` confirmed untouched. `npm run typecheck` and
`npm run lint` both independently re-run, exit 0. AC1-AC4 all PASS.

## Codex Plan Review
`review-1.md` — no blocking issues. Confirmed `apps/api/package.json`'s
seven sibling scripts (`dev`, `start`, `db:generate`, `db:migrate`,
`db:seed`, `db:bootstrap`, `db:restore` — plan said "six", corrected here)
already use the exact flag/path. Confirmed CI sets the three vars explicitly
via `env:` so CI is unaffected (independently verified against Node v24 CLI
docs: process env wins over `--env-file`/`--env-file-if-exists`, stable in
v24.18.0). Confirmed no credential-logging risk. Confirmed DB-backed tests
use uniquely-identified throwaway users/cleanup, consistent with the
repo's shared-dev-DB testing model, so a bare local run is safe. Noted
(non-blocking, out of scope): `apps/extractor` also needs `DATABASE_URL` for
one test, so a root-level bare `npm test` can still fail after this
api-only fix — acceptable since the stated goal is `npm run test -w apps/api`
specifically, not the root-level fan-out.

## Objective
`npm run test -w apps/api`, run with no environment variables pre-exported by
the invoker, exits 0 with all tests passing.

## Root Cause
Confirmed by direct investigation (not assumed):

- 11 of `apps/api`'s test files (`app.test.ts`,
  `routes/ledger-events.route.test.ts`, `routes/user-tasks.route.test.ts`,
  `services/backup.test.ts`, `services/card-due-tasks.test.ts`,
  `services/cards.test.ts`, `services/emis.test.ts`,
  `services/epf-contributions.test.ts`, `services/inbox.test.ts`,
  `services/recurring.test.ts`, `services/user-tasks.test.ts`) guard with a
  `requireEnv`/`requireDatabaseUrl` helper that throws at module load if
  `DATABASE_URL` (and for some, `REDIS_URL`/`SESSION_SECRET`) is unset. These
  are real Postgres/Redis-backed integration tests by design (CLAUDE.md: "no
  DB-mocking infrastructure").
- Root `.env` already contains working `DATABASE_URL`/`REDIS_URL`/
  `SESSION_SECRET` for the shared dev Postgres/Redis at 192.168.2.196.
  Exporting those three vars from `.env` and re-running
  `npm run test -w apps/api` produces **793/793 passing, 0 failing** (verified
  directly — the file-count discrepancy vs. the initial 568/11-fail run is
  explained by the early `throw` in each guarded file previously preventing
  its internal `test()` calls from ever registering as subtests). No pending
  Drizzle migrations against that DB (67/67 journal entries match
  `drizzle.__drizzle_migrations` rows, verified by direct read-only query).
  **There is no code/test bug** — the only gap is that these vars are never
  supplied when running the bare command.
- Every *other* script in `apps/api/package.json` (`dev`, `start`,
  `db:generate`, `db:migrate`, `db:seed`, `db:bootstrap`, `db:restore`)
  already uses `node --env-file-if-exists=../../.env ...` to load the root
  `.env` automatically. `test` is the only script in the file that omits
  this flag — an inconsistency with the other 6 scripts in the same file,
  not a deliberate isolated design choice specific to `test` (the same
  omission is mirrored in every other workspace's `test` script
  (`packages/ai`, `packages/shared`, `apps/web`, `apps/ingestor`,
  `apps/extractor`) too, but those are out of scope here — see Non-Goals).
- Confirmed empirically on this host's Node (v24.18.0): `node --env-file=...`
  gives precedence to variables **already set** in the process environment;
  `--env-file`/`--env-file-if-exists` only fills in variables that are
  *unset*. This means adding `--env-file-if-exists=../../.env` to `apps/api`'s
  `test` script is safe for CI: `.github/workflows/ci.yml`'s `npm test` step
  already sets `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` directly via the
  step's `env:` block, so those values win over anything in a (nonexistent,
  in CI) root `.env` — no CI behavior change.

## Scope
- Edit `apps/api/package.json`: change the `"test"` script from
  `"node --test \"src/**/*.test.ts\""` to
  `"node --env-file-if-exists=../../.env --test \"src/**/*.test.ts\""`,
  matching the exact flag/path already used by the six sibling scripts in
  the same file.

## Dependencies
- none (independent of task 004)

## Plan
- P1: edit the one script line in `apps/api/package.json`
- P2: run `npm run test -w apps/api` from repo root with **no** manually
  exported env vars in that shell invocation, confirm 0 exit / all tests pass
- P3: sanity-check CI is unaffected — re-read `.github/workflows/ci.yml`'s
  `check` job to confirm it still passes `DATABASE_URL`/`REDIS_URL`/
  `SESSION_SECRET` explicitly via `env:` on the `npm test` step (unchanged by
  this task), so those continue to take precedence per the confirmed Node
  precedence rule.

## Acceptance Criteria
- AC1: `npm run test -w apps/api`, invoked from a shell with none of
  `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET`/etc. pre-exported, exits 0.
- AC2: Test/pass/fail counts in that run show 0 failing (workers must quote
  the literal `node:test` summary line).
- AC3: No source file, test file, or migration is modified — this is a
  package.json script-line change only.
- AC4: `.github/workflows/ci.yml` is unmodified (confirm no accidental edit).

## Verification
- T1: `git diff apps/api/package.json` — exactly the one script line changed.
- T2: In a **fresh shell** (`env -i` or explicitly unset the three vars, or
  simply a new Bash tool invocation that never sourced `.env`), run
  `npm run test -w apps/api` and capture the full `node:test` summary +
  exit code.
- T3: `npm run typecheck` and `npm run lint` still exit 0 (unaffected).

## Non-Goals
- Not touching `packages/ai`, `packages/shared`, `apps/web`,
  `apps/ingestor`, `apps/extractor` test scripts — only `apps/api` is in the
  stated goal (`npm run test -w apps/api`). Same fix could apply there later
  but is out of scope now.
- Not modifying `.github/workflows/ci.yml`.
- Not modifying the 11 tests' own `requireEnv`/`requireDatabaseUrl` guards or
  their comments (some reference `apps/api/.env`, which doesn't exist in this
  repo — root `.env` is what's actually used; that comment inaccuracy is
  cosmetic and out of scope).
