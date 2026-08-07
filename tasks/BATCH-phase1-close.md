# Batch: close Phase 1 module migration (1.7 → 1.10)

Coordinator-owned plan for the remaining Phase-1 tasks. Kicked off from user request
"start 1.7 and bunch the other related tasks."

## Tasks & orchestration folders
| Roadmap | Task file | Orchestration | Status |
|---|---|---|---|
| 1.7 Migrate ingest | `tasks/01.07-migrate-ingest.md` | `tasks/017-migrate-ingest/` | COMMITTED `cfc36b5` (with 1.8) |
| 1.8 Migrate system | `tasks/01.08-migrate-system.md` | `tasks/018-migrate-system/` | COMMITTED `cfc36b5` (with 1.7) — 2× independent verify + Codex review-2 zero-blocking |
| 1.10 Storage contract tests | `tasks/01.10-storage-backend-contract-tests.md` | `tasks/019-storage-contract-tests/` | COMMITTED `825705d` |
| 1.9 Cross-module ports (closer) | `tasks/01.09-cross-module-ports.md` | `tasks/020-cross-module-ports/` | IN PROGRESS (planning) — the final Phase-1 task |

## Commit record (2026-08-05, on main, not yet pushed)
- `825705d` test(api): add Storage backend contract tests (roadmap 1.10) — 7 files.
- `cfc36b5` refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8) — 78 files,
  5858+/987−. 1.7+1.8 committed together (forced: shared app.ts + route-table.snapshot.txt; 1.8 moved
  routes/auth.ts which 1.7 had edited). Renames detected; route-surface.snapshot.txt unchanged.
- Left uncommitted by design: tasks/014 TASK.md (M, stray), tasks/013, tasks/015, this BATCH file.

## Dependency & sequencing decision
- **1.7 depends on 1.1 (done); 1.8 depends on 1.1 (done); 1.10 depends on 1.4 (done).**
- **1.9 depends on 1.1–1.8 + 1.10** — the closer, cannot start until all others land.
- **1.7 and 1.8 both edit `apps/api/src/app.ts` (module registration) and `db/schema.ts` thin
  re-exports.** Shared files ⇒ run **sequentially 1.7 → 1.8**, never two workers on `app.ts` at once.
- **1.10 is genuinely independent** (new storage contract-test harness; no route/schema/app.ts edits)
  ⇒ run **in parallel** with 1.7.

## Route → module assignment (remaining 8 flat routes)
- **ingest (1.7):** imports.ts, inbox.ts, mailboxes.ts
- **system (1.8):** health.ts, auth.ts, profile.ts, notifications.ts, backup.ts

## Flat services disposition (confirm during each task's planning)
- **ingest (1.7):** imports(+test), inbox(+test), mailboxes, import-reconciliation(+test)
- **system (1.8):** auth, session, profile(+test), prefs, notifications, backup(+test), restore-user,
  demo(+test), health
- **deferred to 1.9 closer:** cache, anomaly(+test), balances, ownership, periods(+test),
  autopilot(+test) — cross-cutting; 1.9 owns final homes + flat-folder deletion.

## Invariants carried across the batch (from roadmap "Known traps")
- Route snapshot (`route-surface` + `route-table`) must not change during any 1.x migration.
- No migration diff; `backup.test.ts` green (ALL_TABLES/USER_TABLES table *names* unchanged).
- `apps/ingestor` + `apps/extractor` read/write ingest tables via raw SQL — table names/columns MUST NOT change (1.7).
- Global auth/security guards stay app-level and must apply into every encapsulated module (1.8).
- Each 1.x task separately verifies auth requirement, `config.public`, demo-write 403, CSRF/rate-limit
  survive plugin encapsulation (roadmap note, not proven by the route snapshot alone).
