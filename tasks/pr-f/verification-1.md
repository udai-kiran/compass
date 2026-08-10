# PR-F Verification Report — verification-1.md

Generated: 2026-08-10. Verifier did NOT write the code under review.

---

## PART 1 — Can the DB-backed tests run?

### 1a. DATABASE_URL environment status

- `DATABASE_URL` is **NOT set** in the shell environment (`printenv DATABASE_URL` returns nothing).
- `.env.example` exists at repo root (`/home/udai/common/compass/.env.example`) and shows `DATABASE_URL=postgresql://compass:CHANGE_ME@192.168.2.196:5432/compass` — name visible, password placeholder only.
- No `.env` or `.env.local` file exists at repo root or in `apps/api/`.
- `apps/api/package.json` test command uses `--env-file-if-exists=../../.env`; every test run prints `../../.env not found. Continuing without it.`

### 1b. Postgres reachability

- `ss -tlnp` shows port 54320 (a session-manager process), **not** 5432.
- `docker ps` shows no postgres container.
- **Conclusion: no Postgres is reachable on this machine.**

### 1c. How CI provides DATABASE_URL (.github/workflows/ci.yml, lines 11-48)

```yaml
services:
  postgres:
    image: postgres:18
    env:
      POSTGRES_USER: compass
      POSTGRES_PASSWORD: compass-ci
      POSTGRES_DB: compass_ci
    ports:
      - 5432/tcp
    options: >-
      --health-cmd "pg_isready -U compass -d compass_ci"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
...
- run: npm run db:migrate
  env:
    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
- run: npm test
  env:
    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
    REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
    SESSION_SECRET: ci-only-session-secret-not-a-real-value-0123456789
```

CI spins a `postgres:18` service container and injects `DATABASE_URL` as an env var into the migration and test steps.

### 1d. Normal developer workflow

`CLAUDE.md` and `.env.example` both say to copy `.env.example` to `.env` and point it at a local/dev Postgres. Neither `CLAUDE.md` nor any `README` describe a Docker Compose path for Postgres — it is an **external service** the developer must provision separately. There is no documented skip mechanism; both `backup.test.ts:346` and `statement-duplicate.test.ts:43` call `requireDatabaseUrl()` at module load, which **throws** (not skips) when the variable is absent.

### DB-backed test execution

**DB-backed tests COULD NOT BE RUN.** DATABASE_URL is unset and no Postgres is reachable. Both files throw at module load when DATABASE_URL is absent — this is by design (no skip infrastructure exists). The DB-backed results reported by the implementers cannot be independently confirmed in this environment.

---

## PART 2 — Static Verification

### 2a. Files modified

Command: `git status --porcelain` and `git diff --stat`

```
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/extractor/src/db.ts
 M apps/extractor/src/statement-duplicate.test.ts
?? tasks/022-pr-f-extractor-postings/
?? tasks/023-pr-f-backup-csv-postings/
?? tasks/pr-f/
```

Stat: 4 files changed, 743 insertions, 20 deletions.
The untracked entries are task/investigation files, not source. **No file was touched outside the four specified.**

### 2b. Legacy column references in production files

Command:
```
grep -n "transactions\.amount_paise\|transactions\.account_id\|transactions\.category_id" \
  apps/extractor/src/db.ts apps/api/src/modules/system/services/backup.ts
```

Results:
```
apps/extractor/src/db.ts:235:  * The `transactions.account_id`
apps/extractor/src/db.ts:236:  * and `transactions.amount_paise` legacy columns are not read here.
apps/api/src/modules/system/services/backup.ts:130:  * the legacy `transactions.amount_paise` / `account_id` / `category_id` columns.
```

All three hits are in **doc comments** only. No SQL or runtime code reads the legacy columns. **AC1 confirmed for both tasks.**

### 2c. loadCardLedgerTxns — system_kind exclusion

Command: `grep -n "system_kind.*clearing\|system_kind.*opening\|NOT EXISTS" apps/extractor/src/db.ts`

**No output.** Neither `system_kind = 'clearing'`, `system_kind = 'opening'`, nor `NOT EXISTS` appears anywhere in `db.ts`. The D1 regression guard is clean.

### 2d. CSV header byte-identity

`backup.ts:183`:
```typescript
const rows: Array<Array<string | number>> = [["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]];
```

Byte-identical to the spec `["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]`. **AC2 confirmed.**

### 2e. order by, and unchanged constants/functions

- `order by t.date desc` present at `backup.ts:181`. **Confirmed.**
- `ALL_TABLES`, `USER_TABLES`, `LINKED_TABLES`, `FILE_COLUMNS` are present and intact in `backup.ts` (lines 32–45, 48–63, 70–79, 203–208).
- `dumpTable`, `dumpUserTable`, `dumpDatabase`, `exportUserData`, `buildUserBackupStream`, `referencedStorageKeys`, `orphanedStorageKeys`, `createEncryptedBackup` are all present and untouched — only `transactionsCsv` was modified inside this file.
- Restore functions (`restoreDump`, `restoreUserBackup`) live in separate files (`db/restore.ts`, `modules/system/services/restore-user.ts`) and are **not in the diff** — confirmed untouched.

### 2f. Test names vs AC coverage

#### Task 022 (statement-duplicate.test.ts) — AC1–AC10

| AC | Test name | Status |
|---|---|---|
| AC1 | *(static: no legacy column ref in SQL)* | No test; verified by grep (§2b) |
| AC2 | `AC2: ordinary card spend returns negative amountPaise equal to the card posting's amount` | Covered |
| AC3 | `AC3: when transactions.amount_paise holds a decoy value, loadCardLedgerTxns returns the posting's amount — proving the reader is postings-sourced` | Covered |
| AC4 | `AC4: a transfer leg on the card account (with a balancing Clearing posting, D7) is still returned — D1 regression guard` | Covered |
| AC5 | `AC5: a transaction whose posting is on a different account is not returned when querying the card account` | Covered |
| AC6 | `AC6: a soft-deleted transaction with a card posting is not returned (F8)` | Covered |
| AC7 | `AC7: user B's transaction carrying a cross-tenant posting referencing user A's card account is not returned when querying as user A` | Covered |
| AC8 | `AC8: two same-account postings for one transaction produce exactly one row whose amountPaise is their sum (D2)` | Covered |
| AC9 | *"npm run typecheck, npm run lint, and the extractor test suite are green"* — CI-level assertion | No unit test; satisfied only by running commands |
| AC10 | `AC10 (D6): two same-account postings whose sum exceeds Number.MAX_SAFE_INTEGER cause loadCardLedgerTxns to throw a clear overflow error` | Covered |

Note: there is also a pre-existing test named `"AC9: a later card-statement line matching an accepted repayment's card leg..."` (misc-02:AC9 from an earlier task) at line 157. This is not the AC9 of task 022.

**ACs with no unit test in task 022:** AC1 (intentionally static), AC9 (CI-level).

#### Task 023 (backup.test.ts) — AC1–AC18

| AC | Test name | Status |
|---|---|---|
| AC1 | *(static: no legacy column ref in SQL)* | No test; verified by grep (§2b) |
| AC2 | `transactionsCsv AC2: header is byte-identical — Date,Merchant,Amount (paise),Category,Account,Notes` | Covered |
| AC3 | `transactionsCsv AC3: ordinary expense — postings parity (amount, account, category)` | Covered |
| AC4 | `transactionsCsv AC4: postings values override stale legacy fields (drift)` | Covered |
| AC5 | `transactionsCsv AC5: split transaction yields one row with joined sorted distinct categories` | Covered |
| AC6 | `transactionsCsv AC6: transfer pair — one row per leg, correct sign and account` | Covered |
| AC7 | `transactionsCsv AC7+AC13: no postings → blank Amount, Account AND Category (not 0, not dropped)` | Covered (joint) |
| AC8 | `transactionsCsv AC8: soft-deleted excluded; another user's transaction excluded` | Covered |
| AC9 | `transactionsCsv AC9: rows ordered by date desc` | Covered |
| AC10 | *"npm run typecheck, npm run lint, and backup.test.ts are green"* — CI-level assertion | No unit test; satisfied only by running commands |
| AC11 | `transactionsCsv AC11 D9.2: transfer leg exports blank Category even when t.category_id is set` | Covered |
| AC12 | `transactionsCsv AC12 D9.3: opening row exports real amount/account and blank Category` | Covered |
| AC13 | `transactionsCsv AC7+AC13: no postings → blank Amount, Account AND Category` | Covered (joint) |
| AC14 | `transactionsCsv AC14: categories sorted deterministically (collate C), duplicates collapsed` | Covered |
| AC15 | `transactionsCsv AC15: CSV escaping — comma in category, double-quote in merchant, newline in notes` | Covered |
| AC16 | `transactionsCsv AC16 D7: posting referencing another user's account/category is filtered out by tenant guard` | Covered |
| AC17 | `transactionsCsv AC17 D8: archived account and archived category still appear in export` | Covered |
| AC18 | *"bigint→Number behaviour explicitly accepted"* — doc-comment satisfaction, not a test | No unit test; satisfied by doc comment at `backup.ts:144–148` per TASK spec wording |

**ACs with no unit test in task 023:** AC1 (static), AC10 (CI-level), AC18 (doc-comment acceptance per spec).

---

## PART 3 — Command Outputs and Exit Codes

### 1. `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
[all 7 workspaces: @compass/api, @compass/docs, @compass/extractor, @compass/ingestor, @compass/web, @compass/ai, @compass/shared — each: tsc --noEmit]
(no errors printed)
```
**Exit code: 0. PASS.**

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .
(no errors printed)
```
**Exit code: 0. PASS.**

### 3. `node --test apps/extractor/src/extract.test.ts`

```
✔ [59 tests, all pass — decideStatus, matchAccount, matchCategory, dedupeHashFor,
   runExtraction, validIsoDate, extractStatementTxns, merchantSimilarity,
   matchLinesToLedger, istTimestamp, hasRewardData, computeStatementRewardEntries,
   extractStatementSummary, statementPeriodKey, summarizeMatches, EXTRACT_SYSTEM,
   STATEMENT_SYSTEM, classifyAndExtract, extractStatementTxns, Ollama gate, etc.]
ℹ tests 59 | pass 59 | fail 0 | duration_ms 453.7
```
**Exit code: 0. PASS.**

### 4. `npm run test -w apps/extractor`

```
✔ [62 tests pass across db.test.ts and extract.test.ts]
✖ src/statement-duplicate.test.ts (366ms)
  Error: statement-duplicate.test.ts needs DATABASE_URL set ...
    at requireDatabaseUrl (statement-duplicate.test.ts:34:11)
    at statement-duplicate.test.ts:43:25
ℹ tests 63 | pass 62 | fail 1 | duration_ms 439.2
```
**Exit code: 1. FAIL — statement-duplicate.test.ts throws at module load (DATABASE_URL unset).**

The 62 passing tests (extract.test.ts + db.test.ts non-DB tests) pass. The 1 failure is entirely due to missing DATABASE_URL, not a code defect.

### 5. `npm run test -w apps/api`

**Current (with PR-F changes):** 643 pass / 25 fail. Exit code: 1.

**Baseline (git stash, no PR-F changes):** 643 pass / 25 fail. Exit code: 1.

Checksums before stash:
```
2624e4ee...  apps/extractor/src/db.ts
365b0719...  apps/extractor/src/statement-duplicate.test.ts
1e675ee2...  apps/api/src/modules/system/services/backup.ts
bae45d2d...  apps/api/src/modules/system/services/backup.test.ts
```
Checksums after `git stash pop`:
```
2624e4ee...  apps/extractor/src/db.ts
365b0719...  apps/extractor/src/statement-duplicate.test.ts
1e675ee2...  apps/api/src/modules/system/services/backup.ts
bae45d2d...  apps/api/src/modules/system/services/backup.test.ts
```
**Checksums match — stash/pop was byte-exact.** `git status` confirms all 4 files restored correctly.

**Identical failing files in both runs (25 files, alphabetical):**

```
src/app.test.ts
src/lib/postings-periods-parity.test.ts
src/modules/automation/routes/automation.route.test.ts
src/modules/credit/services/card-due-tasks.test.ts
src/modules/credit/services/emis.test.ts
src/modules/credit/services/reconciliation-writes.test.ts
src/modules/credit/services/rewards.test.ts
src/modules/ingest/routes/ingest.route.test.ts
src/modules/ingest/services/inbox.test.ts
src/modules/investments/routes/networth.route.test.ts
src/modules/ledger/routes/ledger-events.route.test.ts
src/modules/ledger/routes/user-tasks.route.test.ts
src/modules/ledger/services/epf-contributions.test.ts
src/modules/ledger/services/postings-balance-parity.test.ts
src/modules/ledger/services/postings-pr-e-parity.test.ts
src/modules/ledger/services/reconcile-postings.test.ts
src/modules/ledger/services/recurring.test.ts
src/modules/ledger/services/user-tasks.test.ts
src/modules/planning/routes/planning.route.test.ts
src/modules/planning/routes/projection-settings.route.test.ts
src/modules/planning/services/postings-planning-parity.test.ts
src/modules/planning/services/projection-settings.test.ts
src/modules/protection/routes/protection.route.test.ts
src/modules/system/routes/system.route.test.ts
src/modules/system/services/backup.test.ts
```

**All 25 failures are PRE-EXISTING** — the set and counts are byte-for-byte identical between baseline and PR-F. PR-F introduces zero new failures.

All failures share the same root cause: DATABASE_URL (and REDIS_URL / SESSION_SECRET) are unset in the local environment, causing those test files to throw at module load. This is the same block that affects backup.test.ts (which is in the set).

---

## Summary of Assumptions and Unresolved Risks

**Assumptions:**
- The four changed files are the complete set of this PR (confirmed by git status).
- Static grep is sufficient evidence for AC1 of both tasks (no runtime column reference).

**Unresolved risks:**
- The DB-backed tests (statement-duplicate.test.ts, backup.test.ts CSV tests, and ~20 API test files) have never been executed in this verification. Their correctness can only be confirmed in CI or a dev environment with a live Postgres.
- AC18 for task 023 is satisfied by a doc-comment declaration, not a runtime check — if `postings.amount_paise` aggregates ever exceed 9007199254740991 (≈ 90 trillion rupees), the amount silently rounds; this is accepted per TASK spec.
