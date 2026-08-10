# PR-F Verification Run 4

Date: 2026-08-10  
Executor: Claude Sonnet 4.6  
Database: postgresql://postgres:<redacted>@192.168.2.196:5432/compass_dev  
Redis: redis://192.168.2.196:6379

---

## Credential Discrepancy (reported, not fixed)

The supplied DATABASE_URL `postgresql://postgres:postgre@192.168.2.196:5432/compass-dev` does not connect:
- password `postgre` → rejected (correct password is `postgres`)
- database `compass-dev` (hyphen) → does not exist (correct name is `compass_dev` with underscore)

All tests below were run with the corrected working URL. Password masked as `<redacted>` throughout.

---

## Step 1 — Schema Readiness

Connection to `compass_dev`: SUCCESS  
`postings` table: EXISTS  
`accounts.system_kind` column: EXISTS  
Row counts: `postings` = 0, `transactions` = 7

Schema is ready; no migrations pending.

---

## Step 2a — `node --test apps/extractor/src/statement-duplicate.test.ts`

```
tests 10  pass 10  fail 0  cancelled 0  skipped 0  todo 0
duration_ms 692.379233
EXIT: 0
```

All 10 tests pass (AC9, AC2–AC10).

---

## Step 2b — `node --test apps/api/src/modules/system/services/backup.test.ts`

```
tests 35  pass 35  fail 0  cancelled 0  skipped 0  todo 0
duration_ms 2855.277944
EXIT: 0
```

All 35 tests pass (schema coverage, restore ordering, mocked-pool restoreDump, AC11, misc-05 AC14, A6 AC2–AC5, transactionsCsv AC2–AC17).

---

## Step 3c — `npm run test -w apps/extractor`

```
tests 72  pass 72  fail 0  cancelled 0  skipped 0  todo 0
duration_ms 618.360475
EXIT: 0
```

Full extractor workspace clean.

---

## Step 3d — `npm run test -w apps/api`

```
tests 949  pass 864  fail 84  skipped 1
EXIT: 1
```

### Failing test files and counts

| File | Failures | Category |
|---|---|---|
| `src/app.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/automation/routes/automation.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/ingest/routes/ingest.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/investments/routes/networth.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/ledger/routes/ledger-events.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/ledger/routes/user-tasks.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/planning/routes/planning.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/planning/routes/projection-settings.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/protection/routes/protection.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/system/routes/system.route.test.ts` | 1 (file-level) | Missing SESSION_SECRET |
| `src/modules/ledger/services/recurring.test.ts` | 20 | Pre-existing DB data |
| `src/modules/ledger/services/user-tasks.test.ts` | 14 | Code defect in user-tasks.ts:55 |
| `src/modules/credit/services/card-due-tasks.test.ts` | 20 | Code defect / postings dependency |
| `src/modules/credit/services/reconciliation-writes.test.ts` | 17 | Code defect / postings dependency |
| `src/modules/ledger/services/postings-pr-e-parity.test.ts` | 2 | Code defects |
| `src/modules/credit/services/emis.test.ts` | 1 | Code defect |

---

## Literal Failure Text

### Category A — Environment artifact: Missing SESSION_SECRET (10 route files)

```
Error: app.test.ts needs SESSION_SECRET set (a real Redis-backed subscriber test) —
export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (file:///home/udai/common/compass/apps/api/src/app.test.ts:24:11)
```
Same pattern for all 9 other route test files. Exit at boot — no individual test assertions run.

---

### Category B — Environment artifact: Pre-existing due recurring_templates row

`src/modules/ledger/services/recurring.test.ts` — 20 failures, all with identical error:

```
Error: recurring.test.ts calls the real, global materializeDue(db) against this repo's
shared dev Postgres (no test-DB isolation exists). Found 1 pre-existing due
(next_due_date <= today, not paused) recurring_templates row(s) — refusing to run,
since materializeDue would silently process them too (advance their real nextDueDate,
insert real transactions against them). Clear or pause unrelated due recurring templates
from this database before running this test file.
    at TestContext.<anonymous>
    (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/recurring.test.ts:85:11)
```

---

### Category C — Genuine code defect: `row.created_at.toISOString is not a function`

**Affects:** `user-tasks.test.ts` (14 failures) and `postings-pr-e-parity.test.ts` PE6 (1 failure).

All failures at `user-tasks.ts:55` via `toUserTask()`. Representative:

```
test at src/modules/ledger/services/user-tasks.test.ts:93:1
✖ AC1(1): list for user A never includes a task belonging to user B (298.47113ms)
  TypeError: row.created_at.toISOString is not a function
      at toUserTask
      (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:55:31)
      at getUserTask
      (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:124:10)
```

```
test at src/modules/ledger/services/postings-pr-e-parity.test.ts:441:1
✖ postings-pr-e-parity: PE6 — listUserTasks returns posting accountId and amountPaise (44.116949ms)
  TypeError: row.created_at.toISOString is not a function
      at toUserTask
      (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:55:31)
      at Array.map (<anonymous>)
      at listUserTasks
      (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:115:40)
```

**Diagnosis (labelled as hypothesis):** `toUserTask` calls `.toISOString()` on `row.created_at`, but the new postings JOIN query returns raw SQL timestamp strings rather than Date objects (Drizzle ORM casts; raw `sql\`\`` does not). This would be introduced by PR-F if `listUserTasks`/`getUserTask` was rewritten to use a raw query to carry posting columns.

---

### Category D — Genuine code defect: PE7 merchant case normalization

```
test at src/modules/ledger/services/postings-pr-e-parity.test.ts:495:1
✖ postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount (152.094962ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'Pe7merchant'
  - 'PE7Merchant'

      at TestContext.<anonymous>
      (file:///home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:528:10)
  actual: 'Pe7merchant', expected: 'PE7Merchant', operator: 'strictEqual'
```

---

### Category E — Genuine code defect: card-due-tasks (20 failures)

Representative first two:

```
test at src/modules/credit/services/card-due-tasks.test.ts:205:1
✖ AC1: an eligible card materialises exactly one task with the correct title/dueDate/source/sourceKey and provenance-labelled notes (326.387041ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(created >= 1)
      at TestContext.<anonymous>
      (file:///home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:217:10)
  actual: false, expected: true

test at src/modules/credit/services/card-due-tasks.test.ts:241:1
✖ AC2: running the materialization pass twice creates exactly one task (idempotent via the alert_ledger claim) (179.930764ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  0 !== 1
      at TestContext.<anonymous>
      (file:///home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:256:10)
  actual: 0, expected: 1
```

**Diagnosis (hypothesis):** `listCardHolders` (which `materializeCardDueTasks` depends on) may now read from `postings` to compute ledger totals. With 0 postings in this DB, billed spend is 0 and `amountDuePaise <= 0` guards short-circuit, materialising nothing. Alternatively, PR-F added a JOIN on postings that returns 0 rows when postings are absent.

---

### Category F — Genuine code defect: reconciliation-writes (17 failures)

```
test at src/modules/credit/services/reconciliation-writes.test.ts:103:1
✖ listReconciliations/recomputeReconciliation: Diners-shaped constituent rows
  (purchases, a payment, a refund) net the signed ledger due and drift (319.852044ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 2000000
  - 2540475

      at TestContext.<anonymous>
      (file:///home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:123:10)
  actual: 2000000, expected: 2540475, operator: 'strictEqual'
```

---

### Category G — Genuine code defect: emis.test.ts (1 failure)

```
test at src/modules/credit/services/emis.test.ts:413:1
✖ upsertEmiDetails: null -> non-null with real installment history present is rejected with 400 (112.139736ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at TestContext.<anonymous>
      (file:///home/udai/common/compass/apps/api/src/modules/credit/services/emis.test.ts:420:3)
  actual: undefined
```

---

## Failure Classification Summary

| Category | Count | Classification |
|---|---|---|
| Missing SESSION_SECRET (10 route files) | 10 file-level | **Environment artifact** — not PR-F defects |
| Pre-existing recurring_templates row | 20 | **Environment artifact** — shared DB interference |
| `user-tasks.ts:55` toISOString TypeError | 15 (14+1) | **Genuine PR-F code defect** |
| PE7 merchant case (search) | 1 | **Genuine PR-F code defect** |
| card-due-tasks materialise=0 | 20 | **Genuine PR-F code defect** (or postings=0 data dependency) |
| reconciliation-writes wrong paise | 17 | **Genuine PR-F code defect** (or postings=0 data dependency) |
| emis missing rejection | 1 | **Genuine PR-F code defect** |

Pure environment artifacts: 30 failures (SESSION_SECRET + recurring)  
Likely PR-F code defects: 54 failures

---

## Step 5 — Cleanup Check

**Throwaway users** matching `ac9-test-%` or `backup-test-%` after tests:
- 1 leftover user `backup-test-<uuid>@example.invalid` (id `da5de357-...`) with 0 accounts, 0 transactions — bare user row not cleaned up, likely from a test that failed before its `t.after()` cleanup could run. All other `ac9-test-*` users from statement-duplicate.test.ts were cleaned up.
- The 48 `%@example.invalid` rows visible in the DB are pre-existing from earlier test runs (patterns include `ingest-route-test-*`, `cards-test-*`, `inbox-test-*`, `ledger-events-route-test-*`).

**Git status:**

```
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/extractor/src/db.ts
 M apps/extractor/src/statement-duplicate.test.ts
?? tasks/022-pr-f-extractor-postings/
?? tasks/023-pr-f-backup-csv-postings/
?? tasks/pr-f/
```

These are the uncommitted PR-F working-tree changes. No unexpected files were modified by this verification run.

---

## Files Inspected

- `/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts`
- `/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts`

## Files Changed

None — verify brief; no edits made.
