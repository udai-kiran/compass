# Sonnet Worker Delegation — Close resolved GitHub issues + update stale task files

## Task
029-close-issues: Close 12 GitHub issues whose work is done; update 4 stale TASK.md files.

## Part A — Close GitHub issues

### Issues to close with `gh issue close --repo udai-kiran/PennyPilot <number> --comment "<message>"`

Close each with the comment shown below.

**#135** — [0.3] Module scaffold + route-table identity gate
Comment: "Completed in task 006 (`tasks/006-module-scaffold-and-route-gate/`). All plan items implemented and merged."

**#136** — [1.1] Migrate ledger module
Comment: "Completed in task 007 (`tasks/007-migrate-ledger/`). All plan items implemented and merged."

**#137** — [1.2] Migrate credit module
Comment: "Completed in task 008 (`tasks/008-migrate-credit/`). All plan items implemented and merged."

**#138** — [1.3] Migrate investments module
Comment: "Completed in task 010 (`tasks/010-migrate-investments/`). All plan items implemented and merged."

**#139** — [1.4] Migrate protection module
Comment: "Completed in task 011 (`tasks/011-migrate-protection/`). All plan items implemented and merged."

**#140** — [1.5] Migrate planning module
Comment: "Completed in task 014 (`tasks/014-migrate-planning/`). Shipped as PR #163, tagged v1.99.0."

**#141** — [1.6] Migrate automation/AI module
Comment: "Completed in task 016 (`tasks/016-migrate-automation/`). All plan items implemented and merged."

**#142** — [1.7] Migrate ingest module
Comment: "Completed in task 017 (`tasks/017-migrate-ingest/`). All plan items implemented and merged."

**#143** — [1.8] Migrate system module
Comment: "Completed in task 018 (`tasks/018-migrate-system/`). All plan items implemented and merged."

**#144** — [1.9] Cross-module ports + flat-services cleanup
Comment: "Completed in task 020 (`tasks/020-cross-module-ports/`). All sub-phases SP0–SP4 complete. Schema ownership is fully physical via `db/shared/` layered files."

**#145** — [2.1] Postings model & balance invariant
Comment: "Completed across the dual-write PR series (PR-A through PR-G1). All reader/writer conversions done, postings-parity tests passing, migration 0067 applied. Tagged v2.8.0 (PR #179) and v2.8.1 (PR #180)."

**#146** — [2.2] Retire transfer_links & transfer-exclusion logic
Comment: "Functionally complete in PR-G1 (PR #179, tagged v2.8.0). The `transfer_links` table is no longer populated — all transfer identity is derived from postings shape (2 real postings, 0 system postings). Transfer-exclusion predicates in legacy helper queries replaced with the postings-shape predicate (task 028, PR #180, v2.8.1). One minor deferred cleanup remains: a dead `transfer_links` lookup in `imports.ts` (tracked as F5) — this is a code-hygiene item only and does not affect runtime behaviour."

### Commands (run each in order; report full output and exit code for each)
```
gh issue close --repo udai-kiran/PennyPilot 135 --comment "Completed in task 006 (tasks/006-module-scaffold-and-route-gate/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 136 --comment "Completed in task 007 (tasks/007-migrate-ledger/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 137 --comment "Completed in task 008 (tasks/008-migrate-credit/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 138 --comment "Completed in task 010 (tasks/010-migrate-investments/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 139 --comment "Completed in task 011 (tasks/011-migrate-protection/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 140 --comment "Completed in task 014 (tasks/014-migrate-planning/). Shipped as PR #163, tagged v1.99.0."

gh issue close --repo udai-kiran/PennyPilot 141 --comment "Completed in task 016 (tasks/016-migrate-automation/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 142 --comment "Completed in task 017 (tasks/017-migrate-ingest/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 143 --comment "Completed in task 018 (tasks/018-migrate-system/). All plan items implemented and merged."

gh issue close --repo udai-kiran/PennyPilot 144 --comment "Completed in task 020 (tasks/020-cross-module-ports/). All sub-phases SP0-SP4 complete. Schema ownership is fully physical via db/shared/ layered files."

gh issue close --repo udai-kiran/PennyPilot 145 --comment "Completed across the dual-write PR series (PR-A through PR-G1). All reader/writer conversions done, postings-parity tests passing, migration 0067 applied. Tagged v2.8.0 (PR #179) and v2.8.1 (PR #180)."

gh issue close --repo udai-kiran/PennyPilot 146 --comment "Functionally complete in PR-G1 (PR #179, tagged v2.8.0). The transfer_links table is no longer populated — all transfer identity is derived from postings shape (2 real postings, 0 system postings). Transfer-exclusion predicates in legacy helper queries replaced with the postings-shape predicate (task 028, PR #180, v2.8.1). One minor deferred cleanup remains: a dead transfer_links lookup in imports.ts (tracked as F5) — code-hygiene only, no runtime impact."
```

## Part B — Update stale TASK.md files

Edit the `## Status` line (first line of the Status section) in these 4 files.
Do NOT change any other content in these files — the rest must remain intact.

### 1. `tasks/009-claude-md-schema-ownership-note/TASK.md`
Find:
```
## Status
BLOCKED — structural, not a process defect (see "Second decline" below)
```
Replace with:
```
## Status
SUPERSEDED — The CLAUDE.md has been comprehensively rewritten by task 020
(cross-module-ports, COMPLETE) and later tasks. The thin-surface/physical-ownership
distinction this task wanted to document no longer applies: all module schemas now
use physical ownership via `db/shared/` layered files. This task's proposed
CLAUDE.md paragraph is obsolete. No further action required.
```

### 2. `tasks/021-postings-model/TASK.md`
Find the VERY FIRST line of the file content after `# Task: 2.1 Postings model & balance invariant` that begins with `## Status`:
The current status line reads:
```
## Status
IMPLEMENTING (dual-write strategy — see `PLAN-dualwrite.md`, which SUPERSEDES the atomic SP0/SP1/SP2 plan recorded below).
```
Replace ONLY that first status line (leave the bullet lines below it intact):
Replace:
```
IMPLEMENTING (dual-write strategy — see `PLAN-dualwrite.md`, which SUPERSEDES the atomic SP0/SP1/SP2 plan recorded below).
```
With:
```
COMPLETE — Full dual-write PR series (PR-A through PR-G1) merged and tagged.
v2.1.0 (SP0), v2.2.0 (PR-A), v2.3.0/v2.4.0 (PR-B+C), v2.5.0 (PR-D), v2.6.0 (PR-E),
v2.8.0 (PR-G1 / PR #179), v2.8.1 (task 028 follow-ups / PR #180). GitHub issue #145 closed.
Historical implementation log preserved below.
(dual-write strategy — see `PLAN-dualwrite.md`, which SUPERSEDES the atomic SP0/SP1/SP2 plan recorded below).
```

### 3. `tasks/024-fix-pr-e-ci-red/TASK.md`
Find:
```
## Status
IMPLEMENTING (plan review closed at review-1; DELEGATION.md iteration 1 issued)
```
Replace with:
```
## Status
SUPERSEDED — All 57 failures this task targeted were fixed by task 027
(tasks/027-pr179-fix-regressions/) as part of the PR #179 regression-fix pass.
CI is green on main as of commit f671b17. GitHub issue #176 tracked separately.
No further action required here.
```

### 4. `tasks/026-pr-179-merge/TASK.md`
Find:
```
## Status
BLOCKED — conflict resolution COMPLETE, verified, reviewed and PUSHED (P1-P7,
AC1-AC9 all met; PR #179 is now `MERGEABLE`). The SQUASH MERGE (P8/AC10) is
withheld pending a user decision: CI proves the delta leaves 36 failing tests.
See D6 and D7 below.
```
Replace with:
```
## Status
COMPLETE — PR #179 squash-merged to main by task 027 (tasks/027-pr179-fix-regressions/).
All 36 CI failures fixed before merge. Squash commit: the commit preceding f671b17.
Tagged v2.8.0. GitHub issue #145 closed (postings model series complete).
```

## Must Not Change
- Any file other than the 4 TASK.md files listed in Part B
- Any line in those files other than the Status section first-line content

## Required Evidence
- Output and exit code for each `gh issue close` command (12 total)
- Confirm each issue is now closed (`gh issue view --repo udai-kiran/PennyPilot <number> --json state`)
- Confirm the 4 TASK.md files have their Status sections updated
- `git diff --stat` showing only the 4 task files changed (no production code touched)
