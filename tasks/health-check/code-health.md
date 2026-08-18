# Code Health Check — 2026-08-14

Working directory: `/work/personal/compass`

---

## 1. `npm run typecheck`

**Command:** `npm run typecheck`  
**Exit code:** 0 — PASS  
**Duration:** ~12.2 s (user 21.40 s, system 1.85 s)

**Output (full — 16 lines):**
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

All 7 workspaces (`api`, `docs`, `extractor`, `ingestor`, `web`, `ai`, `shared`) typecheck cleanly with zero errors.

---

## 2. `npm run lint`

**Command:** `npm run lint`  
**Exit code:** 0 — PASS  
**Duration:** ~2.9 s (user 5.18 s, system 0.48 s)

**Output (full — 3 lines):**
```
> compass@0.1.0 lint
> eslint .
```

No lint errors or warnings.

---

## 3. `npm run test`

**Command:** `npm run test`  
**Exit code:** 1 — FAIL  
**Duration:** ~9.3 s (user 60.44 s, system 16.78 s)

### Per-workspace counts

| Workspace         | Tests | Pass | Fail | Skip | Notes |
|-------------------|-------|------|------|------|-------|
| @compass/api      |   667 |  639 |   27 |    1 | see below |
| @compass/extractor|    74 |   73 |    1 |    0 | see below |
| @compass/ingestor |    12 |   12 |    0 |    0 | |
| @compass/web      |   264 |  264 |    0 |    0 | |
| @compass/ai       |    32 |   32 |    0 |    0 | |
| @compass/shared   |   212 |  212 |    0 |    0 | |
| **TOTAL**         | **1261** | **1232** | **28** | **1** | |

### Failing tests — @compass/api (27 failures)

**Category A — Route snapshot mismatch (2 genuine test failures):**

```
✖ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte
  AssertionError: Canonical route surface does not match route-surface.snapshot.txt
  + actual vs expected:
  +   'GET /api/ledger/integrity\n'  (line present in actual, absent in snapshot)
  +   'HEAD /api/ledger/integrity\n' (line present in actual, absent in snapshot)
```

```
✖ raw printRoutes() tree matches the committed snapshot byte-for-byte
  Error: Raw route-table tree does not match the committed snapshot (route-table.snapshot.txt)
```

Two new routes (`GET /api/ledger/integrity` and `HEAD /api/ledger/integrity`) exist in the running app but are not in the committed snapshot files (`route-surface.snapshot.txt` and `route-table.snapshot.txt`). The snapshots need to be regenerated to acknowledge these routes.

**Category B — DATABASE_URL / Redis not set (25 env-gate failures):**

All remaining api failures are tests that explicitly require a live Postgres or Redis connection and deliberately throw an error when `DATABASE_URL` is not exported. They are environment gates, not logic failures. The affected files are:

```
✖ src/app.test.ts
✖ src/modules/automation/routes/automation.route.test.ts
✖ src/modules/credit/services/card-due-tasks.test.ts
✖ src/modules/credit/services/emis.test.ts
✖ src/modules/credit/services/reconciliation-writes.test.ts
✖ src/modules/credit/services/rewards.test.ts
✖ src/modules/ingest/routes/ingest.route.test.ts
✖ src/modules/ingest/services/inbox.test.ts
✖ src/modules/investments/routes/networth.route.test.ts
✖ src/modules/investments/services/sip-installments.test.ts
✖ src/modules/ledger/routes/ledger-events.route.test.ts
✖ src/modules/ledger/routes/user-tasks.route.test.ts
✖ src/modules/ledger/services/epf-contributions.test.ts
✖ src/modules/ledger/services/postings-balance-parity.test.ts
✖ src/modules/ledger/services/postings-pr-e-parity.test.ts
✖ src/modules/ledger/services/reconcile-postings.test.ts
✖ src/modules/ledger/services/recurring.test.ts
✖ src/modules/ledger/services/user-tasks.test.ts
✖ src/modules/planning/routes/planning.route.test.ts
✖ src/modules/planning/routes/projection-settings.route.test.ts
✖ src/modules/planning/services/postings-planning-parity.test.ts
✖ src/modules/planning/services/projection-settings.test.ts
✖ src/modules/protection/routes/protection.route.test.ts
✖ src/modules/system/routes/system.route.test.ts
✖ src/modules/system/services/backup.test.ts
```

**Skipped test (1):**
```
﹣ storage contract: disk + s3 (live backends)
  # set RUN_STORAGE_CONTRACT_TEST=1 and docker to run
```

### Failing tests — @compass/extractor (1 failure)

```
✖ src/statement-duplicate.test.ts
  Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection)
```

This is the same env-gate pattern as the api failures above.

---

## 4. `npm run build -w apps/web`

**Command:** `npm run build -w apps/web`  
**Exit code:** 0 — PASS  
**Duration:** ~0.4 s wall clock (vite built in 201 ms)

**Output (first 10 lines, then summary):**
```
> @compass/web@0.1.0 build
> vite build

vite v8.1.4 building client environment for production...
✓ 328 modules transformed.
dist/index.html                              0.53 kB │ gzip:   0.31 kB
dist/assets/index-C-LYtfSC.css              54.57 kB │ gzip:  10.29 kB
...
dist/assets/index-B6R4hCNc.js              338.51 kB │ gzip: 104.90 kB

✓ built in 201ms
```

328 modules transformed, all chunks emitted, no warnings.

---

## 5. `npm audit --omit=dev --audit-level=high`

**Command:** `npm audit --omit=dev --audit-level=high`  
**Exit code:** 0 — PASS  
**Duration:** ~4.5 s

**Output (full — 1 line):**
```
found 0 vulnerabilities
```

Zero high/critical vulnerabilities in production dependencies.

---

## Summary Table

| Check                        | Result | Exit Code | Key Detail |
|------------------------------|--------|-----------|------------|
| `npm run typecheck`          | PASS   | 0         | 7 workspaces, 0 errors |
| `npm run lint`               | PASS   | 0         | 0 errors, 0 warnings |
| `npm run test`               | FAIL   | 1         | 1232/1261 pass; 28 fail (2 snapshot + 26 env-gate) |
| `npm run build -w apps/web`  | PASS   | 0         | 328 modules, 201 ms |
| `npm audit --omit=dev ...`   | PASS   | 0         | 0 vulnerabilities |

---

## Notable findings

1. **Route snapshot drift (actionable):** Two new routes — `GET /api/ledger/integrity` and `HEAD /api/ledger/integrity` — are registered in the running app but absent from the committed snapshot files (`apps/api/src/app.route-snapshot.test.ts` references `route-surface.snapshot.txt` and `route-table.snapshot.txt`). This causes 2 genuine test failures. The snapshots must be regenerated to unblock the test suite.

2. **DB/Redis env-gate failures (expected in this environment):** 26 test files require `DATABASE_URL` (and some also `REDIS_URL`) to be set. They intentionally fail-fast with a descriptive error when those env vars are absent. These are not logic regressions — they are integration tests that need a live database.

3. **One skipped test:** The storage contract test for disk + S3 backends is gated behind `RUN_STORAGE_CONTRACT_TEST=1` and requires Docker; skipped by design.

4. **All pure/unit tests pass:** Every test that does not require a live database (logic tests, schema tests, schema barrel tests, algorithm tests, UI hook tests) passes across all 6 workspaces.
