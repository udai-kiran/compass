# Branch & Issue Inventory (2026-08-21)

Repo: udai-kiran/PennyPilot  
Working tree is clean at start of session.  
`git fetch --prune` was NOT run (disallowed by brief). Remote state queried via `git ls-remote --heads origin`.  
All commands run from `/work/personal/compass`.

---

## 1. Currently checked-out branch

```
feat/shopping-core-capture
```

## 2. Local branches with tracking info (`git branch -vv`)

```
  feat/misc-features         5f2f6bb [origin/feat/misc-features] feat(planning): v2.2.0 goal-based planning release
  feat/postings-model-pr-e   bab59d8 [origin/feat/postings-model-pr-e] feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1)
* feat/shopping-core-capture 21bd02d [origin/feat/shopping-core-capture] fix(test): clean up user-owned categories before user delete in catalog route test
  main                       f3eb78f [origin/main: behind 7] Merge pull request #199 from udai-kiran/feat/shopping-catalogue
  pr-d-fullchanges           39dd99a [origin/main: ahead 2, behind 56] docs(tasks): record user decision — old backups need not restore to new system
```

Note: `feat/postings-model-pr-e` and `feat/shopping-core-capture` show no `[gone]` marker because
`git fetch --prune` has not run; their remote branches are actually absent (confirmed below).

## 3. Remote branches (`git ls-remote --heads origin`)

```
a8166139b9915e755b753859c83850bf253d2d33	refs/heads/ci/self-hosted-runner
bbb00bd69e2ec1603e5e0e58659f633d058a99c8	refs/heads/docs/docusaurus-site
26a207f5c60528a9e391ae2ab0d9240502f9029f	refs/heads/emi-account-link
b7900686f49b4747f3d8d33195bcf1eaa218fc59	refs/heads/feat/emi-loan-destination-account
4f44b0d06c2449e310bcc81b8ded5b7d3f3a9a04	refs/heads/feat/family-profile
a918d049a793f3edbb83d06e96bf0a6062681dba	refs/heads/feat/goal-assets-grouped-by-class
5f2f6bba7c1e4922e5708bf060e5d047da79fa78	refs/heads/feat/misc-features
37683a0ccb040846b9de8a4ba5aea28aff00d49d	refs/heads/feat/module-scaffold-route-gate
1fa78b5effd7dfe8575de4478f3d32e586530b54	refs/heads/feat/postings-model-dualwrite
3e2f3fd0254c6d45b2917e72cb27b92f9836fca5	refs/heads/feat/serve-docs-from-web-container
5033b379e23e08b7180f1fa5368cc676355d019e	refs/heads/feat/shopping-catalogue
e1c9734f927f1b0d1285e8ff3e7ec89ddb18e164	refs/heads/feat/shopping-schema
8e50b361da95aab7378d38f93c86d1dbc367a7e0	refs/heads/feat/sip-nav-and-bulk-record
75d491ac33edf8180210c3f8093b6d5b7f71e18a	refs/heads/feat/tasks-page
5ffb07d4cfc03e071a11a7558b9c3b624b521c1d	refs/heads/feat/transaction-date-display
473a85fd8c38a7c8f61a88c21c1f2aa74777bd84	refs/heads/feat/xirr-ui-surface
4b92f69a09c90724bfde1e74df3d6b70d34909dd	refs/heads/fix/030-misc-bug-fixes
715d6a3ade5d6d1fcce01a3c14e052ab4b5d5efd	refs/heads/fix/032-dashboard-500
16978f93fb68a319c8dac4d3fabe10e90cdf4de5	refs/heads/fix/ci-green
dc4f0a59b0b47071f38bfaa58b9c1c88c678c1bf	refs/heads/fix/correctable-opening-balance
8c5f1f06d2599bcf91b84fb0f7a3e69177a00d1d	refs/heads/fix/debt-holding-projection-rate
d51d347f5b9289571c487fc4d53b3360c7ed7ea2	refs/heads/fix/edit-assets-and-connections
3ad0bc7fa98c24e4fc89027171d2f1c2d731c531	refs/heads/fix/extractor-day-first-dates
2e4c5f2f001c369ff48248475fe71caedf4d5c06	refs/heads/fix/job-schedules-utc-and-targeted-recompute
1da3b48c753bdd9034ec19b4ff0c98910c1096b6	refs/heads/fix/misc-improvements
32341a56d17f6c1945e51d457f81e2cd5cf4266f	refs/heads/fix/pr-g1-followups
a056a3c48ba8d9181030c24b5ec8feba59e128f9	refs/heads/fix/profile-dob-not-saved
b3760cfbf5897ef8db78e1174f42eb6eae08c2b2	refs/heads/fix/recurring-resource-update-schema-defaults
d2377865257d8820c71fdbedc1876b811357177b	refs/heads/main
a219cbc7a3da89ce3859334db2cb178e89297fd9	refs/heads/refactor/module-migration-phase1-automation
```

Total remote branches (excluding main): **29**

Absent from ls-remote (i.e., deleted from origin):
- `feat/shopping-core-capture` — gone (PR #200 merged)
- `feat/postings-model-pr-e` — gone
- `pr-d-fullchanges` — no remote counterpart (local branch tracks `origin/main` directly)

## 4. Merged vs not-merged into origin/main

### `git branch --merged origin/main`
```
  feat/misc-features
* feat/shopping-core-capture
  main
```

### `git branch --no-merged origin/main`
```
  feat/postings-model-pr-e
  pr-d-fullchanges
```

Note: local `main` is behind `origin/main` by 7 commits (needs `git pull`), but counts as
merged because its tip is already an ancestor of `origin/main`.

## 5. Distance from origin/main per local branch

Command pattern: `git rev-list --left-right --count origin/main...B`  
Format: `branch: <behind> <ahead>` (ahead=0 means fully merged)

```
feat/misc-features: 16	0
feat/shopping-core-capture: 1	0
main: 7	0
feat/postings-model-pr-e: 55	1
pr-d-fullchanges: 56	2
```

## 6. Branch classification

### Local branches — safe to delete (merged / remote gone)

| Branch | Merged | Remote | Action |
|---|---|---|---|
| `feat/misc-features` | YES (ahead 0) | EXISTS on origin | Safe to delete locally; remote also merged, safe to delete from origin |
| `feat/shopping-core-capture` | YES (ahead 0) | GONE from origin | Safe to delete locally (currently checked out — must switch first) |

### Local branches — NOT safe to auto-delete

| Branch | Merged | Remote | Notes |
|---|---|---|---|
| `main` | — | EXISTS | NEVER delete |
| `feat/postings-model-pr-e` | NO (ahead 1) | GONE from origin | Has 1 unique commit not in main; manual decision needed |
| `pr-d-fullchanges` | NO (ahead 2) | NEVER existed on origin | Tracks origin/main; has 2 unique commits; manual decision needed |

### Remote branches (on actual origin) — merged into main (candidates for remote deletion)

All of the following are confirmed merged (in `git branch -r --merged origin/main`) and
present in `git ls-remote --heads origin`:

```
ci/self-hosted-runner
docs/docusaurus-site
emi-account-link
feat/emi-loan-destination-account
feat/family-profile
feat/goal-assets-grouped-by-class
feat/misc-features
feat/module-scaffold-route-gate
feat/serve-docs-from-web-container
feat/shopping-catalogue
feat/shopping-schema
feat/sip-nav-and-bulk-record
feat/tasks-page
feat/transaction-date-display
feat/xirr-ui-surface
fix/ci-green
fix/correctable-opening-balance
fix/debt-holding-projection-rate
fix/edit-assets-and-connections
fix/extractor-day-first-dates
fix/job-schedules-utc-and-targeted-recompute
fix/misc-improvements
fix/profile-dob-not-saved
fix/recurring-resource-update-schema-defaults
refactor/module-migration-phase1-automation
```

Total: **25 remote branches** that are merged and can be deleted from origin.

### Remote branches (on actual origin) — NOT merged into main (keep)

| Remote branch | Ahead | Notes |
|---|---|---|
| `feat/postings-model-dualwrite` | unknown (r/--no-merged) | Active work; do NOT delete |
| `fix/030-misc-bug-fixes` | unknown (r/--no-merged) | Not merged; do NOT delete |
| `fix/032-dashboard-500` | unknown (r/--no-merged) | Not merged; do NOT delete |
| `fix/pr-g1-followups` | unknown (r/--no-merged) | Not merged; do NOT delete |

Note: stale local tracking refs `origin/feat/postings-model-pr-e` and `origin/pr-d-fullchanges`
also appear in `git branch -r --no-merged` but neither exists on the actual remote (per ls-remote).

### `feat/shopping-core-capture` — specific note

- Local branch: EXISTS, checked out, merged into origin/main (ahead 0), remote gone.
- `origin/feat/shopping-core-capture`: stale local tracking ref only — branch DELETED from
  actual remote after PR #200 merge.
- **Conclusion:** remote already clean; local can be deleted after switching away.

---

## 7. Open GitHub issues (`gh issue list --state open --limit 200`)

```
#153 [OPEN] [3.2] 2.0.0 release :: task,release:2.0.0,phase:3
#152 [OPEN] [3.1] Architecture & docs update :: task,release:2.0.0,phase:3
#151 [OPEN] [2.7] Transaction UI for postings :: task,ui,release:2.0.0,phase:2
#150 [OPEN] [2.6] Ledger invariants & reconciliation guard :: task,release:2.0.0,phase:2
#149 [OPEN] [2.5] Keep the simple transaction API; add multi-leg :: task,release:2.0.0,phase:2
#148 [OPEN] [2.4] Convert consuming services to postings :: task,release:2.0.0,phase:2
#147 [OPEN] [2.3] Fold transaction_splits into postings :: task,release:2.0.0,phase:2
```

Total open issues: **7**. All carry label `task`.

## 8. Issue map and task statuses

### `tasks/.issue-map.json`

```json
{
  "0.1": 133,
  "0.2": 134,
  "0.3": 135,
  "1.1": 136,
  "1.2": 137,
  "1.3": 138,
  "1.4": 139,
  "1.5": 140,
  "1.6": 141,
  "1.7": 142,
  "1.8": 143,
  "1.9": 144,
  "2.1": 145,
  "2.2": 146,
  "2.3": 147,
  "2.4": 148,
  "2.5": 149,
  "2.6": 150,
  "2.7": 151,
  "3.1": 152,
  "3.2": 153
}
```

Issues 133–146 (tasks 0.1–2.2) are already CLOSED (not in open list).  
Issues 147–153 (tasks 2.3–3.2) are still OPEN.  
No issues were created for tasks 4.x–9.x or 10.x+.

### Task status from `tasks/README.md` (lines 92–196)

Done tasks (phases 0–9): **0.1–9.5** (all done, confirmed in table)  
Todo tasks (phases 10+): **10.1–17.3** (all todo)

Specifically for tasks corresponding to open issues:

| Task | Status in README.md |
|---|---|
| 2.3 | done |
| 2.4 | done |
| 2.5 | done |
| 2.6 | done |
| 2.7 | done |
| 3.1 | done |
| 3.2 | done |

## 9. Issue cross-reference — CLOSE vs KEEP

| Issue | Title | Task | Task status | Recommend |
|---|---|---|---|---|
| #147 | [2.3] Fold transaction_splits into postings | 2.3 | done | **CLOSE** |
| #148 | [2.4] Convert consuming services to postings | 2.4 | done | **CLOSE** |
| #149 | [2.5] Keep the simple transaction API; add multi-leg | 2.5 | done | **CLOSE** |
| #150 | [2.6] Ledger invariants & reconciliation guard | 2.6 | done | **CLOSE** |
| #151 | [2.7] Transaction UI for postings | 2.7 | done | **CLOSE** |
| #152 | [3.1] Architecture & docs update | 3.1 | done | **CLOSE** |
| #153 | [3.2] 2.0.0 release | 3.2 | done | **CLOSE** |

No open issues correspond to `todo` tasks. No open issues are manual bug/meta issues.
**All 7 open issues are candidates to close.**

## 10. Token / permissions check

`gh issue list` succeeded with output → authenticated and can read issues.  
Closing issues via `gh issue close` should work (not tested, brief forbids editing).

---

## Summary

**Local branches to delete:** `feat/misc-features`, `feat/shopping-core-capture` (switch away first — currently checked out)  
**Local branches needing human decision:** `feat/postings-model-pr-e` (1 unique commit, remote gone), `pr-d-fullchanges` (2 unique commits, no remote)  
**Remote branches to delete:** 25 (listed in §6 above, all merged into main)  
**Remote branches to keep:** `feat/postings-model-dualwrite`, `fix/030-misc-bug-fixes`, `fix/032-dashboard-500`, `fix/pr-g1-followups` (not merged), plus `main`  
**Issues to close:** #147, #148, #149, #150, #151, #152, #153 (all 7 open issues, all done tasks)  
**Issues to keep open:** none
