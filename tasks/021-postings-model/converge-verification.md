# Task 021 PR-A — Converge Verification

Date: 2026-08-06

## 1. `npm run typecheck`

Command: `npm run typecheck`

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

**Exit code: 0** — all 7 workspaces pass.

---

## 2. `npm run lint`

Command: `npm run lint`

```
> compass@0.1.0 lint
> eslint .
```

**Exit code: 0** — no lint errors.

---

## 3. `npm run test -w apps/api`

Command: `npm run test -w apps/api`

**Exit code: 1**

Summary counts:
- tests: 917
- pass: 860
- fail: 56
- cancelled: 0
- skipped: 1

### Failing test files
- `src/modules/ledger/routes/ledger-events.route.test.ts`
- `src/modules/ledger/services/recurring.test.ts`
- `src/modules/ledger/services/epf-contributions.test.ts`
- `src/modules/ingest/routes/ingest.route.test.ts`
- `src/modules/ingest/services/inbox.test.ts`

### Root cause of failures
56 failing tests across 5 files. Error types:

- **48** × `Error [HttpError]: system accounts not seeded` — `resolveSystemAccounts()` in `post-entry.ts:183` throws because system accounts (the virtual accounts the postings model needs) are not seeded in the test database.
- **5** × `AssertionError: {"statusCode":500,"error":"Internal Server Error","message":"system accounts not seeded"}` — same root cause surfaced through HTTP responses.
- **1** × `AssertionError: The input did not match the regular expression /forced failure for AC14/` — `recurring.test.ts:494` — error message is `HttpError: system accounts not seeded` instead of the expected forced-failure message.
- **1** × `AssertionError: Expected values to be strictly equal: 500 !== 201` in `ledger-events.route.test.ts:156` (P8b test) — `POST /api/transactions` returns 500 due to same root cause.
- **1** × `AssertionError: Expected values to be strictly equal` in `inbox.test.ts` for `acceptRepayment AC6`.

All 56 failures trace back to `resolveSystemAccounts` in the new `post-entry.ts` requiring seeded system accounts that are not present in the integration test database.

### Selected failing test names (56 unique):
- G2.1–G2.5 inbox route integration tests (5)
- listOrphanedAccepts / restoreOrphan tests (7)
- rejectExtracted, guard atomicity tests (7)
- transfer reconstruction tests (3)
- acceptRepayment AC1–AC6 tests (7)
- listInbox (1)
- P8b: POST /api/transactions (1)
- recordEpfContribution (3)
- materializeDue (10)
- upsertEmiDetails (1)
- listEmiInstallments (1)
- incomeExpense (1)

---

## 4. `npm run test -w apps/extractor`

Command: `npm run test -w apps/extractor`

**Exit code: 1**

Summary counts:
- tests: 63
- pass: 62
- fail: 1
- cancelled: 0
- skipped: 0

### Failure
`src/statement-duplicate.test.ts` — throws at module load time:

```
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
```

This is a pre-existing infrastructure requirement (DATABASE_URL not set in this environment), not a regression from task 021.

---

## 5. `git status --porcelain`

Exit code: 0

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
 M apps/api/src/modules/system/routes/backup.ts
 M apps/api/src/modules/system/services/auth.ts
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/api/src/modules/system/services/demo.ts
 M apps/api/src/modules/system/services/restore-user.ts
 M tasks/021-postings-model/DELEGATION.md
 M tasks/021-postings-model/TASK.md
?? apps/api/drizzle/0067_illegal_shocker.sql
?? apps/api/drizzle/meta/0067_snapshot.json
?? apps/api/src/lib/account-type.ts
?? apps/api/src/modules/ledger/services/post-entry.ts
?? apps/api/src/modules/ledger/services/reconcile-postings.test.ts
?? apps/api/src/modules/ledger/services/reconcile-postings.ts
(plus many untracked tasks/021-postings-model/*.md and tasks/ files)
```

---

## 6. Untracked new source/migration files under `apps/`

Command: `git ls-files --others --exclude-standard apps/`

Exit code: 0

```
apps/api/drizzle/0067_illegal_shocker.sql
apps/api/drizzle/meta/0067_snapshot.json
apps/api/src/lib/account-type.ts
apps/api/src/modules/ledger/services/post-entry.ts
apps/api/src/modules/ledger/services/reconcile-postings.test.ts
apps/api/src/modules/ledger/services/reconcile-postings.ts
```

These 6 files are new (untracked) and need explicit staging for the commit.

