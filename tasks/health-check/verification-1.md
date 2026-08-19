# Verification Run 1 — 2026-08-14

## Commands and Results

---

### 1. `npm run typecheck`

**Exit code: 0**

All 7 workspaces passed:
- `@compass/api` — ok
- `@compass/docs` — ok
- `@compass/extractor` — ok
- `@compass/ingestor` — ok
- `@compass/web` — ok
- `@compass/ai` — ok
- `@compass/shared` — ok

---

### 2. `npm run lint`

**Exit code: 0**

```
> compass@0.1.0 lint
> eslint .
```

No errors or warnings.

---

### 3. `npm run test`

**Exit code: 1** (expected — DB-gated tests fail without DATABASE_URL)

#### Per-workspace counts

| Workspace       | tests | pass | fail | skip |
|-----------------|-------|------|------|------|
| @compass/api    |   667 |  641 |   25 |    1 |
| @compass/extractor |  74 |   73 |    1 |    0 |
| @compass/ingestor |   12 |   12 |    0 |    0 |
| @compass/web    |   264 |  264 |    0 |    0 |
| @compass/ai     |    32 |   32 |    0 |    0 |
| @compass/shared |   212 |  212 |    0 |    0 |
| **TOTAL**       | **1261** | **1234** | **26** | **1** |

#### 26 failing tests — all DATABASE_URL-gated

All 26 failures are DB-gated: each test file throws an error at module load time
because `DATABASE_URL` is not set. This is the expected 26 DB-gated failures.

Failing files:
1. `apps/api/src/app.test.ts`
2. `apps/api/src/modules/automation/routes/automation.route.test.ts`
3. `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
4. `apps/api/src/modules/credit/services/emis.test.ts`
5. `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
6. `apps/api/src/modules/credit/services/rewards.test.ts`
7. `apps/api/src/modules/ingest/routes/ingest.route.test.ts`
8. `apps/api/src/modules/ingest/services/inbox.test.ts`
9. `apps/api/src/modules/investments/routes/networth.route.test.ts`
10. `apps/api/src/modules/investments/services/sip-installments.test.ts`
11. `apps/api/src/modules/ledger/routes/ledger-events.route.test.ts`
12. `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`
13. `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
14. `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts`
15. `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
16. `apps/api/src/modules/ledger/services/reconcile-postings.test.ts`
17. `apps/api/src/modules/ledger/services/recurring.test.ts`
18. `apps/api/src/modules/ledger/services/user-tasks.test.ts`
19. `apps/api/src/modules/planning/routes/planning.route.test.ts`
20. `apps/api/src/modules/planning/routes/projection-settings.route.test.ts`
21. `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`
22. `apps/api/src/modules/planning/services/projection-settings.test.ts`
23. `apps/api/src/modules/protection/routes/protection.route.test.ts`
24. `apps/api/src/modules/system/routes/system.route.test.ts`
25. `apps/api/src/modules/system/services/backup.test.ts`
26. `apps/extractor/src/statement-duplicate.test.ts`

#### 1 skipped test

```
﹣ storage contract: disk + s3 (live backends) — set RUN_STORAGE_CONTRACT_TEST=1 and docker to run
```

---

### 4. `grep -rn 'reprojectAllLegacyColumns' apps/api/src/ --include='*.ts'`

**Exit code: 1** (no matches found — PASS)

No occurrences of `reprojectAllLegacyColumns` in `apps/api/src/`.

---

### 5. `git diff --stat`

**Exit code: 0**

```
ROADMAP.md                                         | 41 +++++++++++++++-------
apps/api/src/modules/ledger/services/reconcile-postings.test.ts | 24 +------------
apps/api/src/modules/ledger/services/reconcile-postings.ts      | 14 --------
apps/api/src/route-surface.snapshot.txt            |  2 ++
apps/api/src/route-table.snapshot.txt              |  1 +
tasks/035-investments-font/TASK.md                 |  2 +-
tasks/README.md                                    |  4 +--
7 files changed, 36 insertions(+), 52 deletions(-)
```

---

### 6. `git diff --name-only`

**Exit code: 0**

```
ROADMAP.md
apps/api/src/modules/ledger/services/reconcile-postings.test.ts
apps/api/src/modules/ledger/services/reconcile-postings.ts
apps/api/src/route-surface.snapshot.txt
apps/api/src/route-table.snapshot.txt
tasks/035-investments-font/TASK.md
tasks/README.md
```

---

## 15-Line Digest

```
1.  typecheck         exit 0   — all 7 workspaces clean
2.  lint              exit 0   — no errors
3.  test              exit 1   — 1234 pass / 26 fail / 1 skip (1261 total)
4.  test failures     all 26 are DATABASE_URL-gated; none unexpected
5.  snapshot tests    PASS — both snapshot tests pass (route-surface, route-table)
6.  grep              exit 1   — 0 matches for 'reprojectAllLegacyColumns' (PASS)
7.  git diff --stat   exit 0   — 7 files changed
8.  changed: ROADMAP.md
9.  changed: apps/api/src/modules/ledger/services/reconcile-postings.test.ts
10. changed: apps/api/src/modules/ledger/services/reconcile-postings.ts
11. changed: apps/api/src/route-surface.snapshot.txt
12. changed: apps/api/src/route-table.snapshot.txt
13. changed: tasks/035-investments-font/TASK.md
14. changed: tasks/README.md
15. UNEXPECTED: none — all results within expected parameters
```
