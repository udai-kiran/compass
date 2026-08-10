# PR-F Verification-2 Report
Date: 2026-08-10

## PART A — Codex Reviewer Invocations

### bzqfoag33.txt (task 022-pr-f-extractor-postings)
Matching line (line 1925):
```
codex review written to: /home/udai/common/compass/tasks/022-pr-f-extractor-postings/review-3.md
```
Last 6 lines:
```
| AC6 | Genuinely non-vacuous soft-delete test; pending DB CI. |
| AC7 | Genuinely non-vacuous tenant and inclusive date-range tests; pending DB CI. |
| AC8 | Genuinely non-vacuous cardinality/sum test; pending DB CI. |
| AC9 | Typecheck/lint reported green; complete extractor/DB suite unverified pending CI. |
| AC10 | Genuinely non-vacuous overflow test; pending DB CI. |
codex review written to: /home/udai/common/compass/tasks/022-pr-f-extractor-postings/review-3.md
```

### biwxi90om.txt (task 023-pr-f-backup-csv-postings)
Matching line (line 2298):
```
codex review written to: /home/udai/common/compass/tasks/023-pr-f-backup-csv-postings/review-3.md
```
Last 6 lines:
```
- **Inspection-only:** AC1 and AC18.
- **Not proven:** D9.6, because its UUID-order expectation is invalid.
- **Pending CI execution:** AC2–AC17 and AC10 overall. No DB-backed tests ran locally because `DATABASE_URL`/Postgres is unavailable.
- **AC10:** remains unverified until CI runs typecheck, lint, and the DB-backed suite.
- **AC1–AC18 overall:** all implementation criteria appear satisfied, but acceptance remains blocked by the defective D9.6 test and pending CI.
codex review written to: /home/udai/common/compass/tasks/023-pr-f-backup-csv-postings/review-3.md
```

### Review File Existence
- `tasks/022-pr-f-extractor-postings/review-3.md`: EXISTS — 2589 bytes, 24 lines
- `tasks/023-pr-f-backup-csv-postings/review-3.md`: EXISTS — 3520 bytes, 35 lines

---

## PART B — Final State Verification

### B1. git status --porcelain (complete output)
```
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/extractor/src/db.ts
 M apps/extractor/src/statement-duplicate.test.ts
?? tasks/022-pr-f-extractor-postings/
?? tasks/023-pr-f-backup-csv-postings/
?? tasks/pr-f/
```
CONFIRMED: Exactly the four specified tracked files are modified. The three untracked `??` entries are all under `tasks/` and are expected.

### B2. git diff --stat (full output)
```
 .../api/src/modules/system/services/backup.test.ts | 468 +++++++++++++++++++++
 apps/api/src/modules/system/services/backup.ts     |  62 ++-
 apps/extractor/src/db.ts                           |  45 +-
 apps/extractor/src/statement-duplicate.test.ts     | 317 +++++++++++++-
 4 files changed, 870 insertions(+), 22 deletions(-)
```

### B3. git stash list
(empty — no stashed state)

### B4. Grep production files for amount_paise / account_id / category_id

**apps/api/src/modules/system/services/backup.ts** (all matches):
```
130: * the legacy `transactions.amount_paise` / `account_id` / `category_id` columns.
139: *     categories, not the stale parent `category_id`.
141: *     blank Category, regardless of any legacy `category_id` still set.
145: * AC18 — bigint safety: `postings.amount_paise` is a bigint column; the pg driver
153:      t.date, t.merchant, rp.amount_paise,
158:      select p.amount_paise, a.name as account
160:      join accounts a on a.id = p.account_id
172:        join categories c on c.id = cp.category_id
175:        join accounts ca on ca.id = cp.account_id
187:      r.amount_paise === null ? "" : Number(r.amount_paise),
```
Lines 130, 139, 141, 145 are comments. Lines 153, 158, 160, 172, 175, 187 all reference `rp.amount_paise`, `p.amount_paise`, `p.account_id`, `cp.category_id`, `cp.account_id` — all postings-sourced aliases (`rp.`/`p.`/`cp.`), none `t.amount_paise`/`t.account_id`/`t.category_id`.

**apps/extractor/src/db.ts** (all matches):
```
73:       left join bank_details bd on bd.account_id = a.id
103:       left join card_details cd on cd.account_id = a.id
195:         (user_id, kind, status, provider, model, title, ingestion_id, account_id,
235: * and `transactions.amount_paise` legacy columns are not read here.
236: * and `transactions.account_id` legacy columns are not read here.
247:    amount_paise: string;
253:            sum(p.amount_paise)::bigint as amount_paise,
260:        and p.account_id = $2
267:    const amountPaise = Number(r.amount_paise);
317:           (user_id, ingestion_id, amount_paise, direction, occurred_at, occurred_at_ts, counterparty,
318:            suggested_account_id, suggested_category_id, bank_ref, source_quote, confidence,
375:    await client.query(`delete from reward_entries where account_id = $1 and ingestion_id = $2`, [
380:      `select coalesce(sum(points), 0)::int as base from reward_entries where account_id = $1`,
387:        `insert into reward_entries (user_id, account_id, date, points, note, ingestion_id)
410: * cleared. Keyed on `(account_id, period)` — NOT the ingestion — so a mailbox's
435:         (user_id, account_id, period, statement_date, ingestion_id,
441:       on conflict (account_id, period) do update set
```
Line 235-236 are comments noting legacy columns are NOT read. Line 253 uses `p.amount_paise` (postings-sourced, alias `p.`). Line 260 uses `p.account_id`. All other `account_id` references are on `bd.`, `cd.`, `extracted_transactions`, `reward_entries`, `statement_records` — none are `t.account_id` / `t.amount_paise` / `t.category_id` from the legacy `transactions` table in a SELECT context.

### B5. loadCardLedgerTxns — system_kind exclusion
No `system_kind`, `NOT EXISTS`, `clearing`, or `opening` filter appears inside `loadCardLedgerTxns`. The word "opening" at line 233 is in the comment describing what the function does NOT filter out. CONFIRMED: no such exclusion is present.

---

## PART C — typecheck / lint / test

### C1. npm run typecheck
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
[all 7 workspaces passed with no output]
EXIT:0
```
**PASS**

### C2. npm run lint
```
> compass@0.1.0 lint
> eslint .
EXIT:0
```
**PASS**

### C3. npm run test -w apps/extractor
```
ℹ tests 63
ℹ pass 62
ℹ fail 1
EXIT:1
```
Failing file: `src/statement-duplicate.test.ts`
Failure reason (verbatim):
```
Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
```
The 62 non-DB-backed tests all pass. The single failure is entirely attributable to missing `DATABASE_URL` — the file throws at module load before any test runs.

### C4. npm run test -w apps/api
```
ℹ tests 669
ℹ pass 643
ℹ fail 25
EXIT:1
```
Failing files (25 test suite failures, all DATABASE_URL):
- src/app.test.ts
- src/lib/postings-periods-parity.test.ts
- src/modules/automation/routes/automation.route.test.ts
- src/modules/credit/services/card-due-tasks.test.ts
- src/modules/credit/services/emis.test.ts
- src/modules/credit/services/reconciliation-writes.test.ts
- src/modules/credit/services/rewards.test.ts
- src/modules/ingest/routes/ingest.route.test.ts
- src/modules/ingest/services/inbox.test.ts
- src/modules/investments/routes/networth.route.test.ts
- src/modules/ledger/routes/ledger-events.route.test.ts
- src/modules/ledger/routes/user-tasks.route.test.ts
- src/modules/ledger/services/epf-contributions.test.ts
- src/modules/ledger/services/postings-balance-parity.test.ts
- src/modules/ledger/services/postings-pr-e-parity.test.ts
- src/modules/ledger/services/reconcile-postings.test.ts
- src/modules/ledger/services/recurring.test.ts
- src/modules/ledger/services/user-tasks.test.ts
- src/modules/planning/routes/planning.route.test.ts
- src/modules/planning/routes/projection-settings.route.test.ts
- src/modules/planning/services/postings-planning-parity.test.ts
- src/modules/planning/services/projection-settings.test.ts
- src/modules/protection/routes/protection.route.test.ts
- src/modules/system/routes/system.route.test.ts
- src/modules/system/services/backup.test.ts

The `backup.test.ts` failure is at module load with:
```
at requireDatabaseUrl (file:///home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:337:11)
```
All 25 failures are attributable solely to missing `DATABASE_URL` (DB-backed files throwing at module load). No logic errors detected.

---

## PART D — Pre-existing test count comparison

### apps/api/src/modules/system/services/backup.test.ts
- HEAD: 19 `test(`/`it(` declarations
- Working tree: 35 `test(`/`it(` declarations
- Delta: +16 (net additions only)
- No pre-existing tests deleted.

### apps/extractor/src/statement-duplicate.test.ts
- HEAD: 1 `test(`/`it(` declaration
- Working tree: 10 `test(`/`it(` declarations
- Delta: +9 (net additions only)
- No pre-existing tests deleted.

---

## Summary

| Check | Result |
|---|---|
| Both reviewer invocations confirmed | YES — "codex review written to:" found in both tool-result files |
| Only four tracked files modified | YES — confirmed by git status --porcelain |
| review-3.md files exist | YES — both present (2589 bytes / 3520 bytes) |
| Stash state | CLEAN — git stash list empty |
| production files: no t.amount_paise / t.account_id / t.category_id reads | CONFIRMED — all matches are postings-aliased (p./rp./cp.) or comments |
| loadCardLedgerTxns has no system_kind exclusion | CONFIRMED — no such filter present |
| typecheck exit code | 0 (PASS) |
| lint exit code | 0 (PASS) |
| extractor test fail | 1 file, DATABASE_URL only |
| api test fail | 25 files, DATABASE_URL only, no logic errors |
| Pre-existing tests deleted | NONE — both files gained tests (backup: 19→35; statement-duplicate: 1→10) |
