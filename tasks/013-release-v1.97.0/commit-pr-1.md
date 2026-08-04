# Release v1.97.0 — Stage 1: branch, two commits, push, PR (no merge, no tag)

## Task read
`tasks/013-release-v1.97.0/TASK.md` read in full before starting.

## STEP 1 — Branch created

Command: `git checkout -b refactor/module-migration-phase1-protection`

Output:
```
Switched to a new branch 'refactor/module-migration-phase1-protection'
```

Starting `git status --porcelain` (before staging, for record):
```
 M apps/api/src/app.ts
 D apps/api/src/routes/insurance.ts
 D apps/api/src/routes/retirement.ts
 D apps/api/src/services/insurance.ts
 D apps/api/src/services/retirement.ts
 M tasks/01.04-migrate-protection.md
 M tasks/01.09-cross-module-ports.md
 M tasks/011-migrate-protection/TASK.md
 M tasks/README.md
?? apps/api/src/modules/protection/
?? tasks/00.01-00.02-verification-1.md
?? tasks/000-agent-harness/
?? tasks/001-domain-event-bus/
?? tasks/001-engineer-routing-memory/
?? tasks/002-resume-refactor/
?? tasks/002-retire-url-regex-hook/
?? tasks/003-demo-monthday-utc-fix/
?? tasks/004-fix-eslint-no-undef/
?? tasks/005-fix-api-test-env-loading/
?? tasks/006-module-scaffold-and-route-gate/
?? tasks/01.10-storage-backend-contract-tests.md
?? tasks/011-migrate-protection/DELEGATION.md
?? tasks/011-migrate-protection/backend-1.md
?? tasks/011-migrate-protection/implementation-1.md
?? tasks/011-migrate-protection/review-2.md
?? tasks/011-migrate-protection/review-3.md
?? tasks/011-migrate-protection/review-4.md
?? tasks/011-migrate-protection/verification-1.md
?? tasks/012-release-checkpoint/
?? tasks/013-release-v1.97.0/
```

Pre-check: `ls -la tasks/011-migrate-protection/` confirmed both `investigation-1.md` and `review-1.md`
already existed on disk. Neither line was dropped from the pathspec.

## STEP 2 — commit1-filelist.txt written

`tasks/013-release-v1.97.0/commit1-filelist.txt` written with the 23 named paths plus the 4 appended
review files, 27 lines total. Confirmed with `wc -l`:
```
27 /home/udai/PennyPilot/tasks/013-release-v1.97.0/commit1-filelist.txt
```

## STEP 3 — Staged commit 1

Command: `git add --pathspec-from-file=tasks/013-release-v1.97.0/commit1-filelist.txt`
(no output)

## STEP 4 — Verification before commit 1

`git diff --cached --name-status`:
```
M	apps/api/src/app.ts
A	apps/api/src/modules/protection/plugin.test.ts
A	apps/api/src/modules/protection/plugin.ts
R097	apps/api/src/routes/insurance.ts	apps/api/src/modules/protection/routes/insurance.ts
A	apps/api/src/modules/protection/routes/protection.route.test.ts
R100	apps/api/src/routes/retirement.ts	apps/api/src/modules/protection/routes/retirement.ts
A	apps/api/src/modules/protection/schema.smoke.test.ts
A	apps/api/src/modules/protection/schema.ts
R095	apps/api/src/services/insurance.ts	apps/api/src/modules/protection/services/insurance.ts
R092	apps/api/src/services/retirement.ts	apps/api/src/modules/protection/services/retirement.ts
M	tasks/01.04-migrate-protection.md
M	tasks/01.09-cross-module-ports.md
A	tasks/01.10-storage-backend-contract-tests.md
A	tasks/011-migrate-protection/DELEGATION.md
M	tasks/011-migrate-protection/TASK.md
A	tasks/011-migrate-protection/backend-1.md
A	tasks/011-migrate-protection/implementation-1.md
A	tasks/011-migrate-protection/review-2.md
A	tasks/011-migrate-protection/review-3.md
A	tasks/011-migrate-protection/review-4.md
A	tasks/011-migrate-protection/verification-1.md
M	tasks/README.md
```
(`investigation-1.md` and `review-1.md` produced no diff entries — they were already tracked and
unmodified, confirmed separately with `git diff --cached -- tasks/011-migrate-protection/investigation-1.md
tasks/011-migrate-protection/review-1.md` returning empty output, and `git ls-files` showing both tracked.)

`git diff --cached --stat`:
```
 apps/api/src/app.ts                                |  15 +-
 apps/api/src/modules/protection/plugin.test.ts     |  40 +
 apps/api/src/modules/protection/plugin.ts          |  23 +
 .../{ => modules/protection}/routes/insurance.ts   |   4 +-
 .../protection/routes/protection.route.test.ts     | 168 +++++
 .../{ => modules/protection}/routes/retirement.ts  |   0
 .../src/modules/protection/schema.smoke.test.ts    |  38 +
 apps/api/src/modules/protection/schema.ts          |  33 +
 .../{ => modules/protection}/services/insurance.ts |  15 +-
 .../protection}/services/retirement.ts             |   7 +-
 tasks/01.04-migrate-protection.md                  |  22 +-
 tasks/01.09-cross-module-ports.md                  |   2 +-
 tasks/01.10-storage-backend-contract-tests.md      |  19 +
 tasks/011-migrate-protection/DELEGATION.md         | 165 +++++
 tasks/011-migrate-protection/TASK.md               | 240 +++++-
 tasks/011-migrate-protection/backend-1.md          |  25 +
 tasks/011-migrate-protection/implementation-1.md   | 514 +++++++++++++
 tasks/011-migrate-protection/review-2.md           |  75 ++
 tasks/011-migrate-protection/review-3.md           |  66 ++
 tasks/011-migrate-protection/review-4.md           | 301 ++++++++
 tasks/011-migrate-protection/verification-1.md     | 805 +++++++++++++++++++++
 tasks/README.md                                    |   3 +-
 22 files changed, 2529 insertions(+), 51 deletions(-)
```

`git diff --cached --name-only | grep -Ei '\.pdf|data/|\.env|Pasted image|001-engineer-routing-memory' ; echo "EXIT:$?"`:
```
EXIT:1
```
(grep exit 1 = no matches, as required)

Matches the brief's expectation: 1 modified `app.ts`, 4 renamed pairs (git collapsed delete+add into
`R092`–`R100` renames), 5 net-new files under `apps/api/src/modules/protection/` (plugin.ts,
plugin.test.ts, protection.route.test.ts, schema.smoke.test.ts, schema.ts) + 4 renamed = 9 files total
under `modules/protection/`, plus the `tasks/` files.

## STEP 5 — Commit 1

Command: `git commit -F -` with the exact message specified in the brief.

Output:
```
[refactor/module-migration-phase1-protection 02964b5] refactor(api): migrate protection module into modules/ (roadmap 1.4)
 22 files changed, 2529 insertions(+), 51 deletions(-)
 create mode 100644 apps/api/src/modules/protection/plugin.test.ts
 create mode 100644 apps/api/src/modules/protection/plugin.ts
 rename apps/api/src/{ => modules/protection}/routes/insurance.ts (97%)
 create mode 100644 apps/api/src/modules/protection/routes/protection.route.test.ts
 rename apps/api/src/{ => modules/protection}/routes/retirement.ts (100%)
 create mode 100644 apps/api/src/modules/protection/schema.smoke.test.ts
 create mode 100644 apps/api/src/modules/protection/schema.ts
 rename apps/api/src/{ => modules/protection}/services/insurance.ts (95%)
 rename apps/api/src/{ => modules/protection}/services/retirement.ts (92%)
 create mode 100644 tasks/01.10-storage-backend-contract-tests.md
 create mode 100644 tasks/011-migrate-protection/DELEGATION.md
 create mode 100644 tasks/011-migrate-protection/backend-1.md
 create mode 100644 tasks/011-migrate-protection/implementation-1.md
 create mode 100644 tasks/011-migrate-protection/review-2.md
 create mode 100644 tasks/011-migrate-protection/review-3.md
 create mode 100644 tasks/011-migrate-protection/review-4.md
 create mode 100644 tasks/011-migrate-protection/verification-1.md
```
Commit hash: `02964b5`

## STEP 6 — commit2-filelist.txt written

`tasks/013-release-v1.97.0/commit2-filelist.txt` written with the exact 11 lines. Confirmed with `wc -l`:
```
11 /home/udai/PennyPilot/tasks/013-release-v1.97.0/commit2-filelist.txt
```

## STEP 7 — Staged commit 2

Command: `git add --pathspec-from-file=tasks/013-release-v1.97.0/commit2-filelist.txt`
(no output)

## STEP 8 — Verification before commit 2

`git diff --cached --name-status` (55 files, all `A`):
```
A	tasks/00.01-00.02-verification-1.md
A	tasks/000-agent-harness/DELEGATION.md
A	tasks/000-agent-harness/TASK.md
A	tasks/000-agent-harness/backend-smoke-1.md
A	tasks/000-agent-harness/frontend-smoke-1.md
A	tasks/000-agent-harness/verification-1.md
A	tasks/001-domain-event-bus/DELEGATION.md
A	tasks/001-domain-event-bus/TASK.md
A	tasks/001-domain-event-bus/review-1.md
A	tasks/001-domain-event-bus/review-2.md
A	tasks/001-domain-event-bus/review-3.md
A	tasks/002-resume-refactor/investigation-1.md
A	tasks/002-retire-url-regex-hook/DELEGATION.md
A	tasks/002-retire-url-regex-hook/TASK.md
A	tasks/002-retire-url-regex-hook/implementation-1.md
A	tasks/002-retire-url-regex-hook/review-1.md
A	tasks/002-retire-url-regex-hook/review-2.md
A	tasks/002-retire-url-regex-hook/review-3.md
A	tasks/002-retire-url-regex-hook/review-4.md
A	tasks/002-retire-url-regex-hook/verification-1.md
A	tasks/003-demo-monthday-utc-fix/DELEGATION.md
A	tasks/003-demo-monthday-utc-fix/TASK.md
A	tasks/003-demo-monthday-utc-fix/review-1.md
A	tasks/003-demo-monthday-utc-fix/review-2.md
A	tasks/004-fix-eslint-no-undef/DELEGATION.md
A	tasks/004-fix-eslint-no-undef/TASK.md
A	tasks/004-fix-eslint-no-undef/review-1.md
A	tasks/004-fix-eslint-no-undef/review-2.md
A	tasks/005-fix-api-test-env-loading/DELEGATION.md
A	tasks/005-fix-api-test-env-loading/TASK.md
A	tasks/005-fix-api-test-env-loading/review-1.md
A	tasks/005-fix-api-test-env-loading/review-2.md
A	tasks/006-module-scaffold-and-route-gate/DELEGATION.md
A	tasks/006-module-scaffold-and-route-gate/TASK.md
A	tasks/006-module-scaffold-and-route-gate/implementation-1.md
A	tasks/006-module-scaffold-and-route-gate/review-1.md
A	tasks/006-module-scaffold-and-route-gate/review-2.md
A	tasks/006-module-scaffold-and-route-gate/review-3.md
A	tasks/006-module-scaffold-and-route-gate/review-4.md
A	tasks/006-module-scaffold-and-route-gate/verification-1.md
A	tasks/012-release-checkpoint/TASK.md
A	tasks/012-release-checkpoint/audit-fix-1.md
A	tasks/012-release-checkpoint/commit-1.md
A	tasks/012-release-checkpoint/commit-2.md
A	tasks/012-release-checkpoint/commit-filelist.txt
A	tasks/012-release-checkpoint/dryrun-full.txt
A	tasks/012-release-checkpoint/preflight-1.md
A	tasks/012-release-checkpoint/push-pr-1.md
A	tasks/012-release-checkpoint/release-1.md
A	tasks/012-release-checkpoint/staging-1.md
A	tasks/013-release-v1.97.0/TASK.md
A	tasks/013-release-v1.97.0/commit1-filelist.txt
A	tasks/013-release-v1.97.0/commit2-filelist.txt
A	tasks/013-release-v1.97.0/preflight-1.md
A	tasks/013-release-v1.97.0/secret-scan-1.md
```

`git diff --cached --stat` tail:
```
 55 files changed, 11013 insertions(+)
```
(full per-file stat captured in command output during execution; total line above is the summary line)

`git diff --cached --name-only | grep -Ei '\.pdf|data/|\.env|Pasted image|001-engineer-routing-memory' ; echo "EXIT:$?"`:
```
EXIT:1
```
No `001-engineer-routing-memory` path present anywhere in the staged list.

## STEP 9 — Commit 2

Command: `git commit -F -` with the exact message specified in the brief.

Output:
```
[refactor/module-migration-phase1-protection b4cc143] docs(tasks): add phase-0/1 task records and release checkpoints
 55 files changed, 11013 insertions(+)
 create mode 100644 tasks/00.01-00.02-verification-1.md
 ... (53 more create-mode lines, one per file listed in STEP 8 name-status)
```
Commit hash: `b4cc143`

## STEP 10 — Final working-tree check

Command: `git status --porcelain`

Output:
```
?? tasks/001-engineer-routing-memory/
```

Confirmed: the only remaining untracked entry is `tasks/001-engineer-routing-memory/`. Nothing under
`apps/` or `packages/` is left uncommitted.

## STEP 11 — Push

Command: `git push -u origin refactor/module-migration-phase1-protection`

Output:
```
remote:
remote: Create a pull request for 'refactor/module-migration-phase1-protection' on GitHub by visiting:
remote:      https://github.com/udai-kiran/PennyPilot/pull/new/refactor/module-migration-phase1-protection
remote:
To https://github.com/udai-kiran/PennyPilot.git
 * [new branch]      refactor/module-migration-phase1-protection -> refactor/module-migration-phase1-protection
branch 'refactor/module-migration-phase1-protection' set up to track 'origin/refactor/module-migration-phase1-protection'.
```

## STEP 12 — PR created

Command: `gh pr create --title "refactor(api): migrate protection module into modules/ (roadmap 1.4)" --body "<body exactly as specified>"`

Output:
```
Warning: 1 uncommitted change
https://github.com/udai-kiran/PennyPilot/pull/160
```
The "1 uncommitted change" warning refers to the intentionally-untracked
`tasks/001-engineer-routing-memory/` directory (confirmed by STEP 10's `git status --porcelain`) — this is
expected and correct; that directory is deliberately excluded per the brief.

**PR URL: https://github.com/udai-kiran/PennyPilot/pull/160**

## STEP 13 — Initial `gh pr checks` output

Command: `gh pr checks 160`

Exit code: 8

Output:
```
audit	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993090
check	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993096
publish (api)	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993226
publish (extractor)	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993332
publish (ingestor)	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993257
publish (web)	pending	0	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993140
```
All six checks pending at time of check (immediately after PR creation) — expected, CI had not yet run.

## Files inspected
- `tasks/013-release-v1.97.0/TASK.md`
- `tasks/011-migrate-protection/` directory listing (confirmed `investigation-1.md` and `review-1.md` exist)

## Files changed
- Created: `tasks/013-release-v1.97.0/commit1-filelist.txt`, `tasks/013-release-v1.97.0/commit2-filelist.txt`,
  `tasks/013-release-v1.97.0/commit-pr-1.md` (this file)
- Two commits made on branch `refactor/module-migration-phase1-protection`: `02964b5`, `b4cc143`
- Branch pushed to `origin`
- No files outside the brief's explicit lists were staged or committed

## Assumptions
- `investigation-1.md` and `review-1.md` in `tasks/011-migrate-protection/` were already tracked from a
  prior commit (confirmed via `git ls-files` and empty `git diff --cached`), so including them in the
  pathspec was a no-op as the brief anticipated.
- The "9 additions under apps/api/src/modules/protection/" in the brief's expectation is satisfied by 5
  genuinely new files (plugin.ts, plugin.test.ts, protection.route.test.ts, schema.smoke.test.ts,
  schema.ts) plus 4 git-detected renames from the deleted flat files, totaling 9 files present at that
  path post-commit.

## Unresolved risks / not done in this stage
- STOPPED BEFORE MERGING as instructed. No merge, no tag performed.
- CI checks were pending at the time of the STEP 13 snapshot; not polled to completion (brief only asked
  for "initial output").
- `tasks/001-engineer-routing-memory/` remains untracked on disk, as required by the brief — it was never
  staged or committed at any point in this session.
