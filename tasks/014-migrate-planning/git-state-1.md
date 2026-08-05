# Git State Snapshot — tasks/014-migrate-planning/git-state-1.md

Generated: 2026-08-05

---

## 1. `git branch --show-current`

```
main
```

---

## 2. `git status --porcelain=v1`

```
 M CLAUDE.md
 M apps/api/src/app.ts
 M apps/api/src/db/schema.smoke.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/plugin.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 M apps/api/src/route-table.snapshot.txt
 D apps/api/src/routes/bills.ts
 D apps/api/src/routes/budgets.ts
 D apps/api/src/routes/cashflow.ts
 D apps/api/src/routes/dashboard.ts
 D apps/api/src/routes/goals.ts
 D apps/api/src/routes/insights.ts
 D apps/api/src/routes/reports.ts
 M apps/api/src/services/ai/summary.ts
 M apps/api/src/services/ai/tools.ts
 M apps/api/src/services/autopilot.ts
 D apps/api/src/services/bills.ts
 D apps/api/src/services/budgets.ts
 D apps/api/src/services/cashflow.ts
 D apps/api/src/services/dashboard.ts
 D apps/api/src/services/goal-allocation.test.ts
 D apps/api/src/services/goal-allocation.ts
 D apps/api/src/services/goal-plan.test.ts
 D apps/api/src/services/goal-plan.ts
 D apps/api/src/services/goal-projection.test.ts
 D apps/api/src/services/goal-projection.ts
 D apps/api/src/services/goal-returns.test.ts
 D apps/api/src/services/goal-returns.ts
 D apps/api/src/services/goals.ts
 D apps/api/src/services/insights.test.ts
 D apps/api/src/services/insights.ts
 M apps/api/src/services/notifications.ts
 D apps/api/src/services/reports.test.ts
 D apps/api/src/services/reports.ts
 M tasks/01.05-migrate-planning.md
 M tasks/01.08-migrate-system.md
 M tasks/01.09-cross-module-ports.md
 M tasks/README.md
?? apps/api/src/modules/planning/plugin.test.ts
?? apps/api/src/modules/planning/routes/bills.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/cashflow.ts
?? apps/api/src/modules/planning/routes/dashboard.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/routes/insights.ts
?? apps/api/src/modules/planning/routes/planning.route.test.ts
?? apps/api/src/modules/planning/routes/reports.ts
?? apps/api/src/modules/planning/schema.smoke.test.ts
?? apps/api/src/modules/planning/services/bills.ts
?? apps/api/src/modules/planning/services/budgets.ts
?? apps/api/src/modules/planning/services/cashflow.ts
?? apps/api/src/modules/planning/services/dashboard.ts
?? apps/api/src/modules/planning/services/goal-allocation.test.ts
?? apps/api/src/modules/planning/services/goal-allocation.ts
?? apps/api/src/modules/planning/services/goal-plan.test.ts
?? apps/api/src/modules/planning/services/goal-plan.ts
?? apps/api/src/modules/planning/services/goal-projection.test.ts
?? apps/api/src/modules/planning/services/goal-projection.ts
?? apps/api/src/modules/planning/services/goal-returns.test.ts
?? apps/api/src/modules/planning/services/goal-returns.ts
?? apps/api/src/modules/planning/services/goals.ts
?? apps/api/src/modules/planning/services/insights.test.ts
?? apps/api/src/modules/planning/services/insights.ts
?? apps/api/src/modules/planning/services/reports.test.ts
?? apps/api/src/modules/planning/services/reports.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```

---

## 3. `git status --porcelain=v1 -M` (rename detection)

Output is identical to #2 — git detected NO renames. All deletions under
`apps/api/src/routes/` and `apps/api/src/services/` are reported as pure
deletions; all additions under `apps/api/src/modules/planning/` are reported
as new untracked files. Git's rename threshold was not met.

```
 M CLAUDE.md
 M apps/api/src/app.ts
 M apps/api/src/db/schema.smoke.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/plugin.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 M apps/api/src/route-table.snapshot.txt
 D apps/api/src/routes/bills.ts
 D apps/api/src/routes/budgets.ts
 D apps/api/src/routes/cashflow.ts
 D apps/api/src/routes/dashboard.ts
 D apps/api/src/routes/goals.ts
 D apps/api/src/routes/insights.ts
 D apps/api/src/routes/reports.ts
 M apps/api/src/services/ai/summary.ts
 M apps/api/src/services/ai/tools.ts
 M apps/api/src/services/autopilot.ts
 D apps/api/src/services/bills.ts
 D apps/api/src/services/budgets.ts
 D apps/api/src/services/cashflow.ts
 D apps/api/src/services/dashboard.ts
 D apps/api/src/services/goal-allocation.test.ts
 D apps/api/src/services/goal-allocation.ts
 D apps/api/src/services/goal-plan.test.ts
 D apps/api/src/services/goal-plan.ts
 D apps/api/src/services/goal-projection.test.ts
 D apps/api/src/services/goal-projection.ts
 D apps/api/src/services/goal-returns.test.ts
 D apps/api/src/services/goal-returns.ts
 D apps/api/src/services/goals.ts
 D apps/api/src/services/insights.test.ts
 D apps/api/src/services/insights.ts
 M apps/api/src/services/notifications.ts
 D apps/api/src/services/reports.test.ts
 D apps/api/src/services/reports.ts
 M tasks/01.05-migrate-planning.md
 M tasks/01.08-migrate-system.md
 M tasks/01.09-cross-module-ports.md
 M tasks/README.md
?? apps/api/src/modules/planning/plugin.test.ts
?? apps/api/src/modules/planning/routes/bills.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/cashflow.ts
?? apps/api/src/modules/planning/routes/dashboard.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/routes/insights.ts
?? apps/api/src/modules/planning/routes/planning.route.test.ts
?? apps/api/src/modules/planning/routes/reports.ts
?? apps/api/src/modules/planning/schema.smoke.test.ts
?? apps/api/src/modules/planning/services/bills.ts
?? apps/api/src/modules/planning/services/budgets.ts
?? apps/api/src/modules/planning/services/cashflow.ts
?? apps/api/src/modules/planning/services/dashboard.ts
?? apps/api/src/modules/planning/services/goal-allocation.test.ts
?? apps/api/src/modules/planning/services/goal-allocation.ts
?? apps/api/src/modules/planning/services/goal-plan.test.ts
?? apps/api/src/modules/planning/services/goal-plan.ts
?? apps/api/src/modules/planning/services/goal-projection.test.ts
?? apps/api/src/modules/planning/services/goal-projection.ts
?? apps/api/src/modules/planning/services/goal-returns.test.ts
?? apps/api/src/modules/planning/services/goal-returns.ts
?? apps/api/src/modules/planning/services/goals.ts
?? apps/api/src/modules/planning/services/insights.test.ts
?? apps/api/src/modules/planning/services/insights.ts
?? apps/api/src/modules/planning/services/reports.test.ts
?? apps/api/src/modules/planning/services/reports.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```

---

## 4. `git log --oneline -8`

```
2217636 Merge pull request #162 from udai-kiran/docs/release-records-final
a986c83 docs(tasks): land final scrub evidence and release record
5dde6b7 chore: add gitignored secret-pattern file to stop scan-report recursion
6fa2e2f chore(tasks): scrub remaining credential quotes, land routing-memory record
77fa613 Merge pull request #161 from udai-kiran/chore/release-records-v1.98.0
7ac03c1 chore(tasks): redact credentials from secret-scan report, add release records
d3155a6 Merge pull request #160 from udai-kiran/refactor/module-migration-phase1-protection
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
```

---

## 5. `git tag --sort=-v:refname | head -20`

```
v1.98.0
v1.97.0
v1.96.0
v1.95.0
v1.94.0
v1.93.0
v1.92.0
v1.91.0
v1.90.0
v1.89.0
v1.88.0
v1.87.0
v1.86.0
v1.85.0
v1.84.0
v1.83.0
v1.82.0
v1.81.0
v1.80.0
v1.79.0
```

---

## 6. `git ls-files --others --exclude-standard` (all untracked, gitignore-filtered)

```
apps/api/src/modules/planning/plugin.test.ts
apps/api/src/modules/planning/routes/bills.ts
apps/api/src/modules/planning/routes/budgets.ts
apps/api/src/modules/planning/routes/cashflow.ts
apps/api/src/modules/planning/routes/dashboard.ts
apps/api/src/modules/planning/routes/goals.ts
apps/api/src/modules/planning/routes/insights.ts
apps/api/src/modules/planning/routes/planning.route.test.ts
apps/api/src/modules/planning/routes/reports.ts
apps/api/src/modules/planning/schema.smoke.test.ts
apps/api/src/modules/planning/services/bills.ts
apps/api/src/modules/planning/services/budgets.ts
apps/api/src/modules/planning/services/cashflow.ts
apps/api/src/modules/planning/services/dashboard.ts
apps/api/src/modules/planning/services/goal-allocation.test.ts
apps/api/src/modules/planning/services/goal-allocation.ts
apps/api/src/modules/planning/services/goal-plan.test.ts
apps/api/src/modules/planning/services/goal-plan.ts
apps/api/src/modules/planning/services/goal-projection.test.ts
apps/api/src/modules/planning/services/goal-projection.ts
apps/api/src/modules/planning/services/goal-returns.test.ts
apps/api/src/modules/planning/services/goal-returns.ts
apps/api/src/modules/planning/services/goals.ts
apps/api/src/modules/planning/services/insights.test.ts
apps/api/src/modules/planning/services/insights.ts
apps/api/src/modules/planning/services/reports.test.ts
apps/api/src/modules/planning/services/reports.ts
tasks/013-release-v1.97.0/commit-pr-final.md
tasks/014-migrate-planning/DELEGATION.md
tasks/014-migrate-planning/TASK.md
tasks/014-migrate-planning/assessment-1.md
tasks/014-migrate-planning/backend-1.md
tasks/014-migrate-planning/backend-3.md
tasks/014-migrate-planning/backend-5.md
tasks/014-migrate-planning/backend-6.md
tasks/014-migrate-planning/investigation-1.md
tasks/014-migrate-planning/investigation-2.md
tasks/014-migrate-planning/review-1.md
tasks/014-migrate-planning/review-2.md
tasks/014-migrate-planning/review-3.md
tasks/014-migrate-planning/review-4.md
tasks/014-migrate-planning/verification-1.md
tasks/014-migrate-planning/verification-2.md
tasks/014-migrate-planning/verification-3.md
tasks/014-migrate-planning/verification-4.md
```

(Total: 46 untracked files; this file git-state-1.md will be 47th once written.)

---

## 7. Private artifacts — presence and gitignore status

| Artifact | Exists | Gitignore rule |
|---|---|---|
| `9907616356178351_24062026.pdf` (repo root) | YES | `.gitignore:21: *.pdf` — IGNORED |
| `data/` directory | YES | `.gitignore:12: data/` — IGNORED |
| `.env` | YES | `.gitignore:2: .env` — IGNORED |
| `.secret-patterns` | YES | `.gitignore:26: .secret-patterns` — IGNORED |
| `Pasted image*` anywhere | NONE FOUND | n/a |
| Statement/credential dumps under `apps/` | NONE FOUND | n/a |

All four private artifacts present are gitignored. None would be included by `git add <path>` unless explicitly force-added.

---

## 8. Untracked files grouped

### (a) Under `apps/api/src/modules/planning/` — 27 files

```
apps/api/src/modules/planning/plugin.test.ts
apps/api/src/modules/planning/routes/bills.ts
apps/api/src/modules/planning/routes/budgets.ts
apps/api/src/modules/planning/routes/cashflow.ts
apps/api/src/modules/planning/routes/dashboard.ts
apps/api/src/modules/planning/routes/goals.ts
apps/api/src/modules/planning/routes/insights.ts
apps/api/src/modules/planning/routes/planning.route.test.ts
apps/api/src/modules/planning/routes/reports.ts
apps/api/src/modules/planning/schema.smoke.test.ts
apps/api/src/modules/planning/services/bills.ts
apps/api/src/modules/planning/services/budgets.ts
apps/api/src/modules/planning/services/cashflow.ts
apps/api/src/modules/planning/services/dashboard.ts
apps/api/src/modules/planning/services/goal-allocation.test.ts
apps/api/src/modules/planning/services/goal-allocation.ts
apps/api/src/modules/planning/services/goal-plan.test.ts
apps/api/src/modules/planning/services/goal-plan.ts
apps/api/src/modules/planning/services/goal-projection.test.ts
apps/api/src/modules/planning/services/goal-projection.ts
apps/api/src/modules/planning/services/goal-returns.test.ts
apps/api/src/modules/planning/services/goal-returns.ts
apps/api/src/modules/planning/services/goals.ts
apps/api/src/modules/planning/services/insights.test.ts
apps/api/src/modules/planning/services/insights.ts
apps/api/src/modules/planning/services/reports.test.ts
apps/api/src/modules/planning/services/reports.ts
```

### (b) Under `tasks/014-migrate-planning/` — 16 files (+ this file once written)

```
tasks/014-migrate-planning/DELEGATION.md
tasks/014-migrate-planning/TASK.md
tasks/014-migrate-planning/assessment-1.md
tasks/014-migrate-planning/backend-1.md
tasks/014-migrate-planning/backend-3.md
tasks/014-migrate-planning/backend-5.md
tasks/014-migrate-planning/backend-6.md
tasks/014-migrate-planning/investigation-1.md
tasks/014-migrate-planning/investigation-2.md
tasks/014-migrate-planning/review-1.md
tasks/014-migrate-planning/review-2.md
tasks/014-migrate-planning/review-3.md
tasks/014-migrate-planning/review-4.md
tasks/014-migrate-planning/verification-1.md
tasks/014-migrate-planning/verification-2.md
tasks/014-migrate-planning/verification-3.md
tasks/014-migrate-planning/verification-4.md
```

### (c) Everything else — 1 file

```
tasks/013-release-v1.97.0/commit-pr-final.md
```

No untracked files outside `apps/api/src/`, `tasks/`, or `CLAUDE.md`.

---

## 9. `git diff --stat` and `git diff --stat --staged`

### `git diff --stat` (unstaged tracked changes):

```
 CLAUDE.md                                          |   2 +-
 apps/api/src/app.ts                                |  24 +-
 apps/api/src/db/schema.smoke.test.ts               |   2 +-
 apps/api/src/db/schema.ts                          |  22 +-
 apps/api/src/jobs/index.ts                         |   2 +-
 .../investments/services/sip-commitments.ts        |   2 +-
 apps/api/src/modules/ledger/schema.ts              |  15 +-
 apps/api/src/modules/planning/plugin.ts            |  37 ++-
 apps/api/src/modules/planning/schema.ts            |  46 ++-
 .../planning/services/projection-settings.ts       |   2 +-
 apps/api/src/route-table.snapshot.txt              |  52 +--
 apps/api/src/routes/bills.ts                       |  40 ---
 apps/api/src/routes/budgets.ts                     | 130 --------
 apps/api/src/routes/cashflow.ts                    |  35 --
 apps/api/src/routes/dashboard.ts                   |  26 --
 apps/api/src/routes/goals.ts                       |  64 ----
 apps/api/src/routes/insights.ts                    |  27 --
 apps/api/src/routes/reports.ts                     |  31 --
 apps/api/src/services/ai/summary.ts                |   4 +-
 apps/api/src/services/ai/tools.ts                  |   8 +-
 apps/api/src/services/autopilot.ts                 |   6 +-
 apps/api/src/services/bills.ts                     | 166 ----------
 apps/api/src/services/budgets.ts                   | 286 ----------------
 apps/api/src/services/cashflow.ts                  | 157 ---------
 apps/api/src/services/dashboard.ts                 | 127 --------
 apps/api/src/services/goal-allocation.test.ts      | 116 -------
 apps/api/src/services/goal-allocation.ts           |  99 ------
 apps/api/src/services/goal-plan.test.ts            | 205 ------------
 apps/api/src/services/goal-plan.ts                 | 130 --------
 apps/api/src/services/goal-projection.test.ts      | 100 ------
 apps/api/src/services/goal-projection.ts           | 133 --------
 apps/api/src/services/goal-returns.test.ts         | 110 -------
 apps/api/src/services/goal-returns.ts              | 162 ----------
 apps/api/src/services/goals.ts                     | 360 ---------------------
 apps/api/src/services/insights.test.ts             |  64 ----
 apps/api/src/services/insights.ts                  | 284 ----------------
 apps/api/src/services/notifications.ts             |   2 +-
 apps/api/src/services/reports.test.ts              | 209 ------------
 apps/api/src/services/reports.ts                   | 160 ---------
 tasks/01.05-migrate-planning.md                    |  36 ++-
 tasks/01.08-migrate-system.md                      |   4 +-
 tasks/01.09-cross-module-ports.md                  |   2 +-
 tasks/README.md                                    |   2 +-
 43 files changed, 168 insertions(+), 3323 deletions(-)
```

### `git diff --stat --staged` (staged changes):

```
(empty — no output; the staging area is clean)
```

---

## 10. `tasks/001-engineer-routing-memory/new-memory-content.md` — tracked, ignored, or untracked?

```
git check-ignore -v tasks/001-engineer-routing-memory/new-memory-content.md
(exit code 1 — file is NOT gitignored)

git ls-files tasks/001-engineer-routing-memory/new-memory-content.md
tasks/001-engineer-routing-memory/new-memory-content.md
(exit code 0 — file IS tracked)

git status --porcelain -- tasks/001-engineer-routing-memory/new-memory-content.md
(empty output — no modifications; file is tracked and clean)
```

Status: **TRACKED, unmodified, not gitignored.**
