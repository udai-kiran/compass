# Sonnet Worker Delegation — iteration 1

## Task
024 — fix the 57 apps/api failures that turned `main` red (issue #176).

## Approved Plan
P1-P5 in `tasks/024-fix-pr-e-ci-red/TASK.md`. Read it in full; rulings D1-D5b are
binding, and each records an alternative that was considered and rejected.

## Branch
Create `fix/pr-e-ci-red` **off `main`** (not off `feat/postings-model-pr-f`).

## Required Changes

### Cause A — production (`modules/ledger/services/user-tasks.ts`)
1. In `TASK_LATERAL_QUERY`, replace the bare `ut.created_at`, `ut.updated_at`,
   `ut.completed_at` selections with, exactly:
   `to_char(ut.<col> AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as <col>`
2. Retype `TaskRawRow.created_at`/`updated_at` to `string`, `completed_at` to
   `string | null`.
3. Delete the three `.toISOString()` calls (`:42`, `:55`, `:56`) — the SQL now emits
   ISO-8601 directly.
4. `to_char(NULL, ...)` yields `NULL`, so the `completedAt: null` path is preserved.

### Latent copy
5. `modules/investments/services/sip-installments.ts:308` — retype the raw
   `t.deleted_at` field from `Date | null` to `string | null`. Confirm the
   null-check at `:317` still behaves identically.

### Stale comment
6. `apps/api/src/app.ts:182-185` — the comment says posting-derived reader failures
   cannot surface "because every reader is still legacy-derived". False since PR-E.
   Rewrite it to state that readers ARE posting-derived now and a reconciliation
   failure therefore CAN surface wrong data. **Comment only — no logic change.**

### Cause B — fixtures (tests only)
7. `modules/credit/services/card-due-tasks.test.ts` — `createTxn`
8. `modules/credit/services/reconciliation-writes.test.ts` — `createTxn`
9. `modules/credit/services/emis.test.ts` — `insertInstallmentHistory`
   Each must also create the transaction's postings, mirroring the production
   dual-write shape: prefer calling `createTransaction`; if impractical, insert the
   **full balanced posting family** (real leg + system counter-leg), not just the
   real leg (D5b).

### Tests
10. Add the AC2b regression test: seed timestamps with **non-zero microseconds**,
    call BOTH the list and get HTTP routes, assert 200, and parse every returned
    timestamp with `z.iso.datetime()`.
11. Cover AC2: `completedAt` null for incomplete, ISO for completed, via both routes.

## Must Not Change
- **Any existing expected value in any test.** This is the hard guard (D4). If a test
  only passes by editing an expectation, STOP and report — that means a production
  bug, not a fixture gap.
- No test may be skipped, deleted or weakened; the test count must not decrease.
- Do not touch PR-F's four files (`backup.ts`, `backup.test.ts`,
  `apps/extractor/src/db.ts`, `statement-duplicate.test.ts`).
- Do not revert any PR-E postings conversion.
- Do not change restore semantics — the degraded-state defect is explicitly out of
  scope and tracked separately.
- No schema change, no migration.

## Acceptance Criteria
AC1-AC8 in TASK.md. AC6 is the bar: **`npm run test -w apps/api` must have 0
failures.**

## Commands
Use inline env vars (never create `.env`; mask the password in the report):
`DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev`
`REDIS_URL=redis://192.168.2.196:6379`
`SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789`

1. `node --test apps/api/src/modules/ledger/services/user-tasks.test.ts`
2. `node --test apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`
3. `node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
4. `node --test apps/api/src/modules/credit/services/card-due-tasks.test.ts`
5. `node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
6. `node --test apps/api/src/modules/credit/services/emis.test.ts`
7. `npm run test -w apps/api`
8. `npm run typecheck`
9. `npm run lint`

No migrations, no DDL, no deleting pre-existing data on the shared dev DB.

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes, pass/fail counts
- the P5 sweep findings (fixtures cross-referenced against posting-derived readers)
- plan deviations or blockers

## Iteration 1 — parallel ownership split (lead ruling)

The two causes touch disjoint files, so iteration 1 runs as two concurrent
`sonnet-worker` agents with **exclusive file ownership**. Neither may edit the
other's files; a needed cross-boundary edit is reported, not made.

### Worker A — Cause A (production) — owns:
- `apps/api/src/modules/ledger/services/user-tasks.ts`
- `apps/api/src/modules/investments/services/sip-installments.ts`
- `apps/api/src/app.ts` (comment only)
- `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts` (AC2/AC2b tests)
Items 1-6, 10, 11. Runs commands 1-3 only.

### Worker B — Cause B (fixtures) + P5 sweep — owns:
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- `apps/api/src/modules/credit/services/emis.test.ts`
Items 7-9 and P5. Runs commands 4-6 only.

### Constraints binding on BOTH
- **No git operations at all.** Branch `fix/pr-e-ci-red` already exists at `main`'s
  tip (`2253623`) with a clean tree; do not create, switch, stage, commit or stash.
- **Do NOT run `npm run test -w apps/api`, `npm run typecheck`, or `npm run lint`.**
  Two concurrent full suites would contend on the shared dev Postgres and produce
  untrustworthy output. The full suite (commands 7-9) belongs to the independent
  verification worker, run once, after both implementers finish.
- Write full findings to `tasks/024-fix-pr-e-ci-red/implementation-<A|B>.md`; reply
  with a digest of <=20 lines plus that path.

---

# Iteration 2 — Worker C (Amendment 1: P6 + P7)

Gated by review-2, which APPROVED Amendment 1 with no blocking issue. Files do not
overlap Worker B (still in flight on the three credit fixtures) or Worker A (finished).

## Worker C owns exactly two files
- `apps/api/src/modules/ledger/services/user-tasks.test.ts` (P6, helper `createTxn` at `:63`)
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (P7, line 528 only)

## Required changes
- **P6** — make `createTxn` create the transaction's postings, per D5b: prefer the real
  `createTransaction` service; otherwise insert the full balanced posting family (real
  leg + system counter-leg). Review-2 constraints, all binding:
  - call `seedSystemAccounts(db, userId)` first for each test user if using `createTransaction`
  - AC6's `accountId` and `amountPaise: -12345` expectations must stay byte-identical
    (safe: `"Test merchant"`/`"Bookstein"`→ actually `"Bookstore"` are `titleCase` fixed points)
  - the counter-leg is excluded by `a.system_kind is null` and the lateral query is
    `limit 1`, so the real leg must carry the signed amount
- **P7** — change ONLY the merchant expectation at
  `postings-pr-e-parity.test.ts:528` from `"PE7Merchant"` to `"Pe7merchant"`, and add a
  brief comment explaining that `createTransaction` normalises merchant on write
  (`normalizeMerchant`/`titleCase`) and that this predates PR-E. Per review-2, describe
  the BEHAVIOUR rather than pinning fragile line numbers. Do NOT touch PE7's
  `length === 1`, `amountPaise === -600`, or `findInconsistentPostings` assertions.

## Must not change
- Any other expected value anywhere. D4 stands: outside the single P7 merchant string,
  an expectation that must move means a production bug — STOP and report.
- Do NOT convert reconciliation/backup fixtures that deliberately create inconsistent
  rows to exercise degraded behaviour.
- Do NOT fix `user-tasks.route.test.ts:110` (Worker A's file, and a report-only P5 item).
- No production-code change at all in this iteration.

## Commands (only these two, then stop)
1. `node --test apps/api/src/modules/ledger/services/user-tasks.test.ts` — expect 18/18
2. `node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` — expect 10/10
Do NOT run the full suite, typecheck, or lint — the verifier owns those.

## Required evidence
`tasks/024-fix-pr-e-ci-red/implementation-C.md`: files changed, complete diff, exact
commands, literal output, pass/fail counts, exit codes, deviations.

---

# Iteration 3 — Worker D (Amendment 2: P8)

Gated by review-3, which required one amendment (both posting legs, not one) — now
folded into D7 step 2. All other workers are finished; no ownership conflict.

## Worker D owns exactly one file
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`

## Required changes (D7, as revised)
1. Replace the raw `db.insert(transactions)` seeds at `:690-693` and `:742-745` with the
   real `createTransaction` (the helper `createTxn` in this file already uses it — follow
   the same shape), so the posting the aggregate reads actually exists.
2. In BOTH hooks' `txB`: keep the existing `transactions.amountPaise` update, and add a
   single UPDATE of BOTH posting legs —
   `SET amount_paise = CASE WHEN account_id = <accountId> THEN <new> ELSE -<new> END
    WHERE transaction_id = <seed id>` — with `.returning()` and an in-test assertion that
   **exactly two rows** were updated (AC12b, keeps the family zero-sum).
3. Preserve the `txB` ordering the existing comment describes: B reads the `accounts` row
   FIRST (the reverse edge), then writes.

## Must not change
- **All four expected values stay byte-identical:** `-350000` at `:734`; and in the
  second test the 40001 rejection, `hookCalls === 2`, and `openingBalancePaise === 0`.
  If any must move, STOP and report — Worker B already got this wrong once by inventing
  an unobserved value.
- **Do NOT use `rebuildPostingsForTransaction`** (or any delete+reinsert of postings)
  inside the hook: its INSERTs perform FK checks and reintroduce the documented deadlock.
  Direct UPDATE of existing rows only, and never put an FK column in a SET list.
- Do not weaken, skip or delete any test; do not touch the long explanatory comment at
  `:660-684` except to keep it accurate; no production-code change; no migration.

## Commands
1. `node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts` — expect 26/26
2. Re-run it a SECOND time and report both runs: the restored `40001` must be
   deterministic, not flaky, and the run must not hang (deadlock check).
Do NOT run the full suite, typecheck or lint — the verifier owns those.

## Required evidence
`tasks/024-fix-pr-e-ci-red/implementation-D.md`: files changed, complete diff, exact
commands, literal output of BOTH runs, pass/fail counts, exit codes, deviations.

---

# Iteration 4 — Worker F: INDEPENDENT VERIFICATION (read-only)

Must be a worker that implemented NONE of this change. Verification is read-only: it
proves or disproves the acceptance criteria, and fixes nothing.

## Required evidence (all literal)
1. `git status --short` and `git diff --stat` on the branch; the COMPLETE `git diff`
   against `main`; the full list of modified AND untracked files.
2. `npm run test -w apps/api` — the bar is **0 failures** (AC6). Full tail: tests,
   pass, fail, cancelled, skipped, todo counts, plus exit code.
3. `npm run typecheck` and `npm run lint` — literal output and exit codes.
4. **AC5 proof, mechanically:** the test count must not decrease and nothing may be
   skipped or deleted. For every changed test file, compare the count of test
   declarations against `git show main:<path>` and report both numbers per file. Report
   any `skip`, `todo`, `only`, or commented-out test anywhere in the diff.
5. **AC4/D4 proof:** confirm from the diff that the ONLY changed expected value in the
   entire branch is PE7's merchant string. Explicitly re-confirm these are unchanged:
   `2540475` (reconciliation-writes), `created >= 1` (card-due-tasks), `-12345`
   (user-tasks AC6), `-350000` and `0` (the two SSI tests), `-600` (PE7).
6. Confirm no production-code change outside `user-tasks.ts`, `sip-installments.ts` and
   the `app.ts` comment; and that PR-F's four files are untouched
   (`backup.ts`, `backup.test.ts`, `apps/extractor/src/db.ts`, `statement-duplicate.test.ts`).
7. Re-derive the D6 git facts independently: when merchant normalisation was introduced
   vs when `postings-pr-e-parity.test.ts` was added.
8. List every command you did NOT run, and why.

## Constraints
- Read-only. No edits to any source or test file. No state-changing git command.
- Do not fix anything you find — report it.

## Report
`tasks/024-fix-pr-e-ci-red/verification-1.md`; reply with a <=20-line digest plus path.
