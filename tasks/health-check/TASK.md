# Task: Health-check cleanup

## Status
COMPLETE

## Objective
Fix all issues found in the v3.0.0 health check: CI blocker (route snapshots),
stale documentation (ROADMAP.md), dead code, and stale task/trap references.
Single commit, deployed together.

## Root Cause
Task 2.6 added `GET /api/ledger/integrity` but did not regenerate route
snapshots. ROADMAP.md section 4 was written before the task board was
restructured into 9 releases. Metrics line (29) not updated after test/route
growth. `reprojectAllLegacyColumns` kept as a transition stub with zero callers.

## Scope

### B1 — Route snapshots (BLOCKER)
- `apps/api/src/route-surface.snapshot.txt` — add `GET /api/ledger/integrity` and `HEAD /api/ledger/integrity`
- `apps/api/src/route-table.snapshot.txt` — add integrity route in ledger section

### S1 — ROADMAP.md section 4 rewrite
- Rewrite to match task board's 9-release structure (2.0.0 done, 2.1.0 Household, ..., 2.8.0 Portfolio)
- Update "53 tasks across four releases" to actual count
- Mark 2.0.0 as complete/shipped

### S2 — ROADMAP.md line 29 metrics
- 88 test files -> 133
- 155 routes -> 158 (after snapshot update)
- 39 route modules -> 40
- 31 web pages -> 32

### S3 — Dead code deletion
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` lines 98-110: delete `reprojectAllLegacyColumns`
- `apps/api/src/modules/ledger/services/reconcile-postings.test.ts`: delete import + test block for same

### S5 — ROADMAP.md section 6 stale reference
- "No OCR anywhere until vision lands in 2.0.0" -> fix to reference 2.3.0 (task 8.1)

### S6 — tasks/README.md known-traps
- Remove `transaction_splits` from "8 tables have no user_id" list (now 7 tables)
- Update "155 URLs" to 158

### L1 — Task 035 status
- `tasks/035-investments-font/TASK.md` status: IMPLEMENTING -> COMPLETE

## Dependencies
None

## Plan
- P1: Update route snapshots with integrity endpoint (B1)
- P2: Delete reprojectAllLegacyColumns stub + test (S3)
- P3: Rewrite ROADMAP.md — metrics (S2), section 4 (S1), section 6 (S5)
- P4: Fix tasks/README.md known-traps (S6)
- P5: Mark task 035 COMPLETE (L1)

## Acceptance Criteria
- AC1: `npm run test` has zero non-env-gated failures (route snapshot tests pass)
- AC2: `npm run typecheck` and `npm run lint` remain green
- AC3: ROADMAP.md section 4 release versions match tasks/README.md release table exactly
- AC4: ROADMAP.md metrics line matches actual counts
- AC5: No references to `reprojectAllLegacyColumns` remain in source
- AC6: `transaction_splits` removed from known-traps list

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test — snapshot tests pass, no new failures
- T4: grep for reprojectAllLegacyColumns returns only this task file
- T5: ROADMAP section 4 release versions manually compared to task board

## Non-Goals
- Task 041 (EPF double-edit bug) — separate task
- Task 040 (opening-txn test debt) — separate task
- Branch cleanup — manual later
