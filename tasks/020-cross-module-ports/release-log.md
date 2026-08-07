# Release log — roadmap 1.9 (v2.1.0)

Date: 2026-08-05

---

## Step 1 — git commit -F tasks/020-cross-module-ports/COMMIT_MSG.txt

```
[refactor/module-migration-phase1-close e58dbe1] refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
 106 files changed, 8687 insertions(+), 2171 deletions(-)
 create mode 100644 apps/api/src/db/schema.decomposition.test.ts
 create mode 100644 apps/api/src/db/shared/foundation.ts
 create mode 100644 apps/api/src/db/shared/hubs.ts
 create mode 100644 apps/api/src/db/shared/ledger.ts
 create mode 100644 apps/api/src/db/shared/recurring.ts
 create mode 100644 apps/api/src/db/shared/spines.ts
 rename apps/api/src/{services => lib}/cache.ts (100%)
 rename apps/api/src/{services => lib}/ownership.ts (97%)
 rename apps/api/src/{services => lib}/periods.test.ts (100%)
 rename apps/api/src/{services => lib}/periods.ts (100%)
 rename apps/api/src/{ => modules/automation}/services/anomaly.test.ts (100%)
 rename apps/api/src/{ => modules/automation}/services/anomaly.ts (93%)
 rename apps/api/src/{ => modules/automation}/services/autopilot.test.ts (100%)
 rename apps/api/src/{ => modules/automation}/services/autopilot.ts (95%)
 create mode 100644 apps/api/src/modules/ledger/services/account-balances.test.ts
 rename apps/api/src/{ => modules/ledger}/services/balances.ts (97%)
 rename apps/api/src/{repositories => modules/system/services}/users.ts (91%)
 create mode 100644 tasks/020-cross-module-ports/COMMIT_MSG.txt
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp1.md
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp2a.md
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp2b.md
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp3.md
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp4-fix.md
 create mode 100644 tasks/020-cross-module-ports/DELEGATION-sp4.md
 create mode 100644 tasks/020-cross-module-ports/PR_BODY.md
 create mode 100644 tasks/020-cross-module-ports/TASK.md
 create mode 100644 tasks/020-cross-module-ports/backend-sp1-1.md
 create mode 100644 tasks/020-cross-module-ports/backend-sp2a-1.md
 create mode 100644 tasks/020-cross-module-ports/backend-sp2b-1.md
 create mode 100644 tasks/020-cross-module-ports/backend-sp3-1.md
 create mode 100644 tasks/020-cross-module-ports/investigation-1.md
 create mode 100644 tasks/020-cross-module-ports/investigation-2.md
 create mode 100644 tasks/020-cross-module-ports/investigation-3.md
 create mode 100644 tasks/020-cross-module-ports/release-facts.md
 create mode 100644 tasks/020-cross-module-ports/review-1.md
 create mode 100644 tasks/020-cross-module-ports/review-10.md
 create mode 100644 tasks/020-cross-module-ports/review-11.md
 create mode 100644 tasks/020-cross-module-ports/review-2.md
 create mode 100644 tasks/020-cross-module-ports/review-3.md
 create mode 100644 tasks/020-cross-module-ports/review-4.md
 create mode 100644 tasks/020-cross-module-ports/review-5.md
 create mode 100644 tasks/020-cross-module-ports/review-6.md
 create mode 100644 tasks/020-cross-module-ports/review-7.md
 create mode 100644 tasks/020-cross-module-ports/review-8.md
 create mode 100644 tasks/020-cross-module-ports/review-9.md
 create mode 100644 tasks/020-cross-module-ports/staging-evidence.md
 create mode 100644 tasks/020-cross-module-ports/verification-sp1.md
 create mode 100644 tasks/020-cross-module-ports/verification-sp2a-1.md
 create mode 100644 tasks/020-cross-module-ports/verification-sp2b-final.md
 create mode 100644 tasks/020-cross-module-ports/verification-sp3.md
 create mode 100644 tasks/020-cross-module-ports/verification-sp4.md
EXIT:0
```

---

## Step 2 — git log --oneline -3

```
e58dbe1 refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
cfc36b5 refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8)
825705d test(api): add Storage backend contract tests (roadmap 1.10)
EXIT:0
```

---

## Step 3 — git push -u origin refactor/module-migration-phase1-close

```
remote: 
remote: Create a pull request for 'refactor/module-migration-phase1-close' on GitHub by visiting:        
remote:      https://github.com/udai-kiran/PennyPilot/pull/new/refactor/module-migration-phase1-close        
remote: 
To https://github.com/udai-kiran/PennyPilot.git
 * [new branch]      refactor/module-migration-phase1-close -> refactor/module-migration-phase1-close
branch 'refactor/module-migration-phase1-close' set up to track 'origin/refactor/module-migration-phase1-close'.
EXIT:0
```

---

## Step 4 — gh pr create

```
https://github.com/udai-kiran/PennyPilot/pull/165
EXIT:0
```

PR URL: https://github.com/udai-kiran/PennyPilot/pull/165

---

## Step 5 — gh pr merge refactor/module-migration-phase1-close --merge --delete-branch

Command used: `gh pr merge refactor/module-migration-phase1-close --merge --delete-branch` (primary, no fallback needed)

```
From https://github.com/udai-kiran/PennyPilot
 * branch            main       -> FETCH_HEAD
   5031b88..4e0182a  main       -> origin/main
Updating cfc36b5..4e0182a
Fast-forward
 CLAUDE.md                                          |    6 +-
 apps/api/src/app.ts                                |    2 +-
 apps/api/src/db/bootstrap.ts                       |    2 +-
 apps/api/src/db/core-schema.ts                     |   14 +-
 apps/api/src/db/schema.decomposition.test.ts       |  253 +++
 apps/api/src/db/schema.ts                          | 1849 +-------------------
 apps/api/src/db/shared/foundation.ts               |  154 ++
 apps/api/src/db/shared/hubs.ts                     |  148 ++
 apps/api/src/db/shared/ledger.ts                   |  125 ++
 apps/api/src/db/shared/recurring.ts                |   59 +
 apps/api/src/db/shared/spines.ts                   |  305 ++++
 apps/api/src/jobs/index.ts                         |    4 +-
 apps/api/src/{services => lib}/cache.ts            |    0
 apps/api/src/{services => lib}/ownership.ts        |    2 +-
 apps/api/src/{services => lib}/periods.test.ts     |    0
 apps/api/src/{services => lib}/periods.ts          |    0
 .../src/modules/automation/schema.smoke.test.ts    |   11 +-
 apps/api/src/modules/automation/schema.ts          |  125 +-
 .../automation}/services/anomaly.test.ts           |    0
 .../{ => modules/automation}/services/anomaly.ts   |   10 +-
 .../automation}/services/autopilot.test.ts         |    0
 .../{ => modules/automation}/services/autopilot.ts |   14 +-
 apps/api/src/modules/automation/services/tools.ts  |    2 +-
 apps/api/src/modules/credit/routes/emis.ts         |    2 +-
 apps/api/src/modules/credit/schema.smoke.test.ts   |   11 +-
 apps/api/src/modules/credit/schema.ts              |  296 +++-
 apps/api/src/modules/credit/services/alerts.ts     |    2 +-
 apps/api/src/modules/credit/services/emis.ts       |    2 +-
 apps/api/src/modules/ingest/schema.smoke.test.ts   |   12 +-
 apps/api/src/modules/ingest/schema.ts              |  250 ++-
 apps/api/src/modules/ingest/services/inbox.test.ts |    2 +-
 apps/api/src/modules/investments/plugin.ts         |    3 +-
 apps/api/src/modules/investments/routes/sips.ts    |    2 +-
 .../src/modules/investments/schema.smoke.test.ts   |   12 +-
 apps/api/src/modules/investments/schema.ts         |  220 ++-
 .../src/modules/investments/services/holdings.ts   |    2 +-
 .../src/modules/investments/services/networth.ts   |   21 +-
 .../modules/investments/services/sip-lifecycle.ts  |    4 +-
 apps/api/src/modules/ledger/plugin.ts              |    4 +-
 apps/api/src/modules/ledger/schema.smoke.test.ts   |   12 +-
 apps/api/src/modules/ledger/schema.ts              |  201 ++-
 .../ledger/services/account-balances.test.ts       |   36 +
 apps/api/src/modules/ledger/services/accounts.ts   |   29 +-
 .../src/{ => modules/ledger}/services/balances.ts  |    2 +-
 .../ledger/services/epf-contributions.test.ts      |    2 +-
 .../src/modules/ledger/services/recurring.test.ts  |    2 +-
 apps/api/src/modules/ledger/services/recurring.ts  |    2 +-
 .../src/modules/ledger/services/transactions.ts    |    2 +-
 apps/api/src/modules/planning/routes/budgets.ts    |    2 +-
 apps/api/src/modules/planning/routes/insights.ts   |    4 +-
 apps/api/src/modules/planning/schema.smoke.test.ts |   12 +-
 apps/api/src/modules/planning/schema.ts            |  138 +-
 apps/api/src/modules/planning/services/budgets.ts  |    4 +-
 apps/api/src/modules/planning/services/cashflow.ts |    6 +-
 .../api/src/modules/planning/services/dashboard.ts |    6 +-
 apps/api/src/modules/planning/services/goals.ts    |    4 +-
 apps/api/src/modules/planning/services/insights.ts |    2 +-
 .../src/modules/planning/services/reports.test.ts  |    2 +-
 apps/api/src/modules/planning/services/reports.ts  |    2 +-
 .../src/modules/protection/schema.smoke.test.ts    |   12 +-
 apps/api/src/modules/protection/schema.ts          |  107 +-
 apps/api/src/modules/system/routes/auth.ts         |    2 +-
 apps/api/src/modules/system/schema.smoke.test.ts   |   11 +-
 apps/api/src/modules/system/schema.ts              |  164 +-
 apps/api/src/modules/system/services/auth.ts       |    2 +-
 apps/api/src/modules/system/services/demo.ts       |    2 +-
 .../src/modules/system/services/notifications.ts   |    2 +-
 apps/api/src/modules/system/services/prefs.ts      |    4 +-
 .../system/services}/users.ts                      |    4 +-
 tasks/01.09-cross-module-ports.md                  |   34 +-
 tasks/014-migrate-planning/TASK.md                 |    7 +-
 [... task files omitted for brevity ...]
 106 files changed, 8687 insertions(+), 2171 deletions(-)
EXIT:0
```

---

## Step 6 — git checkout main

```
Already on 'main'
Your branch is up to date with 'origin/main'.
EXIT:0
```

---

## Step 7 — git pull origin main

```
From https://github.com/udai-kiran/PennyPilot
 * branch            main       -> FETCH_HEAD
Already up to date.
EXIT:0
```

---

## Step 8 — git log --oneline -3 (on main after pull)

```
4e0182a Merge pull request #165 from udai-kiran/refactor/module-migration-phase1-close
e58dbe1 refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
cfc36b5 refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8)
EXIT:0
```

---

## Step 9 — git tag -a v2.1.0

```
EXIT:0
```

---

## Step 10 — git push origin v2.1.0

```
To https://github.com/udai-kiran/PennyPilot.git
 * [new tag]         v2.1.0 -> v2.1.0
EXIT:0
```

---

## Step 11 — git tag --sort=-v:refname | head -5

```
v2.1.0
v2.0.0
v1.99.0
v1.98.0
v1.97.0
EXIT:0
```

v2.1.0 is present at the top of the tag list.
