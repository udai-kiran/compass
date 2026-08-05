# Staging evidence — refactor/module-migration-phase1-close

Generated: 2026-08-05

---

## Command 1 — git checkout -b refactor/module-migration-phase1-close

```
Switched to a new branch 'refactor/module-migration-phase1-close'
EXIT:0
```

---

## Command 2 — git add apps/ CLAUDE.md tasks/01.09-cross-module-ports.md tasks/README.md tasks/020-cross-module-ports/ tasks/014-migrate-planning/TASK.md

```
EXIT:0
```

---

## Command 3 — git status --porcelain=v1

```
M  CLAUDE.md
M  apps/api/src/app.ts
M  apps/api/src/db/bootstrap.ts
M  apps/api/src/db/core-schema.ts
A  apps/api/src/db/schema.decomposition.test.ts
M  apps/api/src/db/schema.ts
A  apps/api/src/db/shared/foundation.ts
A  apps/api/src/db/shared/hubs.ts
A  apps/api/src/db/shared/ledger.ts
A  apps/api/src/db/shared/recurring.ts
A  apps/api/src/db/shared/spines.ts
M  apps/api/src/jobs/index.ts
R  apps/api/src/services/cache.ts -> apps/api/src/lib/cache.ts
R  apps/api/src/services/ownership.ts -> apps/api/src/lib/ownership.ts
R  apps/api/src/services/periods.test.ts -> apps/api/src/lib/periods.test.ts
R  apps/api/src/services/periods.ts -> apps/api/src/lib/periods.ts
M  apps/api/src/modules/automation/schema.smoke.test.ts
M  apps/api/src/modules/automation/schema.ts
R  apps/api/src/services/anomaly.test.ts -> apps/api/src/modules/automation/services/anomaly.test.ts
R  apps/api/src/services/anomaly.ts -> apps/api/src/modules/automation/services/anomaly.ts
R  apps/api/src/services/autopilot.test.ts -> apps/api/src/modules/automation/services/autopilot.test.ts
R  apps/api/src/services/autopilot.ts -> apps/api/src/modules/automation/services/autopilot.ts
M  apps/api/src/modules/automation/services/tools.ts
M  apps/api/src/modules/credit/routes/emis.ts
M  apps/api/src/modules/credit/schema.smoke.test.ts
M  apps/api/src/modules/credit/schema.ts
M  apps/api/src/modules/credit/services/alerts.ts
M  apps/api/src/modules/credit/services/emis.ts
M  apps/api/src/modules/ingest/schema.smoke.test.ts
M  apps/api/src/modules/ingest/schema.ts
M  apps/api/src/modules/ingest/services/inbox.test.ts
M  apps/api/src/modules/investments/plugin.ts
M  apps/api/src/modules/investments/routes/sips.ts
M  apps/api/src/modules/investments/schema.smoke.test.ts
M  apps/api/src/modules/investments/schema.ts
M  apps/api/src/modules/investments/services/holdings.ts
M  apps/api/src/modules/investments/services/networth.ts
M  apps/api/src/modules/investments/services/sip-lifecycle.ts
M  apps/api/src/modules/ledger/plugin.ts
M  apps/api/src/modules/ledger/schema.smoke.test.ts
M  apps/api/src/modules/ledger/schema.ts
A  apps/api/src/modules/ledger/services/account-balances.test.ts
M  apps/api/src/modules/ledger/services/accounts.ts
R  apps/api/src/services/balances.ts -> apps/api/src/modules/ledger/services/balances.ts
M  apps/api/src/modules/ledger/services/epf-contributions.test.ts
M  apps/api/src/modules/ledger/services/recurring.test.ts
M  apps/api/src/modules/ledger/services/recurring.ts
M  apps/api/src/modules/ledger/services/transactions.ts
M  apps/api/src/modules/planning/routes/budgets.ts
M  apps/api/src/modules/planning/routes/insights.ts
M  apps/api/src/modules/planning/schema.smoke.test.ts
M  apps/api/src/modules/planning/schema.ts
M  apps/api/src/modules/planning/services/budgets.ts
M  apps/api/src/modules/planning/services/cashflow.ts
M  apps/api/src/modules/planning/services/dashboard.ts
M  apps/api/src/modules/planning/services/goals.ts
M  apps/api/src/modules/planning/services/insights.ts
M  apps/api/src/modules/planning/services/reports.test.ts
M  apps/api/src/modules/planning/services/reports.ts
M  apps/api/src/modules/protection/schema.smoke.test.ts
M  apps/api/src/modules/protection/schema.ts
M  apps/api/src/modules/system/routes/auth.ts
M  apps/api/src/modules/system/schema.smoke.test.ts
M  apps/api/src/modules/system/schema.ts
M  apps/api/src/modules/system/services/auth.ts
M  apps/api/src/modules/system/services/demo.ts
M  apps/api/src/modules/system/services/notifications.ts
M  apps/api/src/modules/system/services/prefs.ts
R  apps/api/src/repositories/users.ts -> apps/api/src/modules/system/services/users.ts
M  tasks/01.09-cross-module-ports.md
M  tasks/014-migrate-planning/TASK.md
A  tasks/020-cross-module-ports/COMMIT_MSG.txt
A  tasks/020-cross-module-ports/DELEGATION-sp1.md
A  tasks/020-cross-module-ports/DELEGATION-sp2a.md
A  tasks/020-cross-module-ports/DELEGATION-sp2b.md
A  tasks/020-cross-module-ports/DELEGATION-sp3.md
A  tasks/020-cross-module-ports/DELEGATION-sp4-fix.md
A  tasks/020-cross-module-ports/DELEGATION-sp4.md
A  tasks/020-cross-module-ports/PR_BODY.md
A  tasks/020-cross-module-ports/TASK.md
A  tasks/020-cross-module-ports/backend-sp1-1.md
A  tasks/020-cross-module-ports/backend-sp2a-1.md
A  tasks/020-cross-module-ports/backend-sp2b-1.md
A  tasks/020-cross-module-ports/backend-sp3-1.md
A  tasks/020-cross-module-ports/investigation-1.md
A  tasks/020-cross-module-ports/investigation-2.md
A  tasks/020-cross-module-ports/investigation-3.md
A  tasks/020-cross-module-ports/release-facts.md
A  tasks/020-cross-module-ports/review-1.md
A  tasks/020-cross-module-ports/review-10.md
A  tasks/020-cross-module-ports/review-11.md
A  tasks/020-cross-module-ports/review-2.md
A  tasks/020-cross-module-ports/review-3.md
A  tasks/020-cross-module-ports/review-4.md
A  tasks/020-cross-module-ports/review-5.md
A  tasks/020-cross-module-ports/review-6.md
A  tasks/020-cross-module-ports/review-7.md
A  tasks/020-cross-module-ports/review-8.md
A  tasks/020-cross-module-ports/review-9.md
A  tasks/020-cross-module-ports/staging-evidence.md
A  tasks/020-cross-module-ports/verification-sp1.md
A  tasks/020-cross-module-ports/verification-sp2a-1.md
A  tasks/020-cross-module-ports/verification-sp2b-final.md
A  tasks/020-cross-module-ports/verification-sp3.md
A  tasks/020-cross-module-ports/verification-sp4.md
M  tasks/README.md
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/BATCH-phase1-close.md
EXIT:0
```

---

## Command 4 — git diff --cached --stat

```
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
 tasks/020-cross-module-ports/COMMIT_MSG.txt        |   30 +
 tasks/020-cross-module-ports/DELEGATION-sp1.md     |  119 ++
 tasks/020-cross-module-ports/DELEGATION-sp2a.md    |   95 +
 tasks/020-cross-module-ports/DELEGATION-sp2b.md    |  137 ++
 tasks/020-cross-module-ports/DELEGATION-sp3.md     |  140 ++
 tasks/020-cross-module-ports/DELEGATION-sp4-fix.md |  156 ++
 tasks/020-cross-module-ports/DELEGATION-sp4.md     |   74 +
 tasks/020-cross-module-ports/PR_BODY.md            |   27 +
 tasks/020-cross-module-ports/TASK.md               |  745 ++++++++
 tasks/020-cross-module-ports/backend-sp1-1.md      |   22 +
 tasks/020-cross-module-ports/backend-sp2a-1.md     |   67 +
 tasks/020-cross-module-ports/backend-sp2b-1.md     |   49 +
 tasks/020-cross-module-ports/backend-sp3-1.md      |   53 +
 tasks/020-cross-module-ports/investigation-1.md    |  669 +++++++
 tasks/020-cross-module-ports/investigation-2.md    |  414 +++++
 tasks/020-cross-module-ports/investigation-3.md    |  394 +++++
 tasks/020-cross-module-ports/release-facts.md      |  119 ++
 tasks/020-cross-module-ports/review-1.md           |  395 +++++
 tasks/020-cross-module-ports/review-10.md          |   50 +
 tasks/020-cross-module-ports/review-11.md          |   18 +
 tasks/020-cross-module-ports/review-2.md           |  303 ++++
 tasks/020-cross-module-ports/review-3.md           |   12 +
 tasks/020-cross-module-ports/review-4.md           |    1 +
 tasks/020-cross-module-ports/review-5.md           |   49 +
 tasks/020-cross-module-ports/review-6.md           |   27 +
 tasks/020-cross-module-ports/review-7.md           |  107 ++
 tasks/020-cross-module-ports/review-8.md           |  144 ++
 tasks/020-cross-module-ports/review-9.md           |   79 +
 tasks/020-cross-module-ports/staging-evidence.md   |    1 +
 tasks/020-cross-module-ports/verification-sp1.md   |  216 +++
 .../020-cross-module-ports/verification-sp2a-1.md  |  306 ++++
 .../verification-sp2b-final.md                     |  205 +++
 tasks/020-cross-module-ports/verification-sp3.md   |  338 ++++
 tasks/020-cross-module-ports/verification-sp4.md   |  200 +++
 tasks/README.md                                    |    2 +-
 106 files changed, 8303 insertions(+), 2171 deletions(-)
EXIT:0
```

---

## Command 5 — git diff --cached --name-only

```
CLAUDE.md
apps/api/src/app.ts
apps/api/src/db/bootstrap.ts
apps/api/src/db/core-schema.ts
apps/api/src/db/schema.decomposition.test.ts
apps/api/src/db/schema.ts
apps/api/src/db/shared/foundation.ts
apps/api/src/db/shared/hubs.ts
apps/api/src/db/shared/ledger.ts
apps/api/src/db/shared/recurring.ts
apps/api/src/db/shared/spines.ts
apps/api/src/jobs/index.ts
apps/api/src/lib/cache.ts
apps/api/src/lib/ownership.ts
apps/api/src/lib/periods.test.ts
apps/api/src/lib/periods.ts
apps/api/src/modules/automation/schema.smoke.test.ts
apps/api/src/modules/automation/schema.ts
apps/api/src/modules/automation/services/anomaly.test.ts
apps/api/src/modules/automation/services/anomaly.ts
apps/api/src/modules/automation/services/autopilot.test.ts
apps/api/src/modules/automation/services/autopilot.ts
apps/api/src/modules/automation/services/tools.ts
apps/api/src/modules/credit/routes/emis.ts
apps/api/src/modules/credit/schema.smoke.test.ts
apps/api/src/modules/credit/schema.ts
apps/api/src/modules/credit/services/alerts.ts
apps/api/src/modules/credit/services/emis.ts
apps/api/src/modules/ingest/schema.smoke.test.ts
apps/api/src/modules/ingest/schema.ts
apps/api/src/modules/ingest/services/inbox.test.ts
apps/api/src/modules/investments/plugin.ts
apps/api/src/modules/investments/routes/sips.ts
apps/api/src/modules/investments/schema.smoke.test.ts
apps/api/src/modules/investments/schema.ts
apps/api/src/modules/investments/services/holdings.ts
apps/api/src/modules/investments/services/networth.ts
apps/api/src/modules/investments/services/sip-lifecycle.ts
apps/api/src/modules/ledger/plugin.ts
apps/api/src/modules/ledger/schema.smoke.test.ts
apps/api/src/modules/ledger/schema.ts
apps/api/src/modules/ledger/services/account-balances.test.ts
apps/api/src/modules/ledger/services/accounts.ts
apps/api/src/modules/ledger/services/balances.ts
apps/api/src/modules/ledger/services/epf-contributions.test.ts
apps/api/src/modules/ledger/services/recurring.test.ts
apps/api/src/modules/ledger/services/recurring.ts
apps/api/src/modules/ledger/services/transactions.ts
apps/api/src/modules/planning/routes/budgets.ts
apps/api/src/modules/planning/routes/insights.ts
apps/api/src/modules/planning/schema.smoke.test.ts
apps/api/src/modules/planning/schema.ts
apps/api/src/modules/planning/services/budgets.ts
apps/api/src/modules/planning/services/cashflow.ts
apps/api/src/modules/planning/services/dashboard.ts
apps/api/src/modules/planning/services/goals.ts
apps/api/src/modules/planning/services/insights.ts
apps/api/src/modules/planning/services/reports.test.ts
apps/api/src/modules/planning/services/reports.ts
apps/api/src/modules/protection/schema.smoke.test.ts
apps/api/src/modules/protection/schema.ts
apps/api/src/modules/system/routes/auth.ts
apps/api/src/modules/system/schema.smoke.test.ts
apps/api/src/modules/system/schema.ts
apps/api/src/modules/system/services/auth.ts
apps/api/src/modules/system/services/demo.ts
apps/api/src/modules/system/services/notifications.ts
apps/api/src/modules/system/services/prefs.ts
apps/api/src/modules/system/services/users.ts
tasks/01.09-cross-module-ports.md
tasks/014-migrate-planning/TASK.md
tasks/020-cross-module-ports/COMMIT_MSG.txt
tasks/020-cross-module-ports/DELEGATION-sp1.md
tasks/020-cross-module-ports/DELEGATION-sp2a.md
tasks/020-cross-module-ports/DELEGATION-sp2b.md
tasks/020-cross-module-ports/DELEGATION-sp3.md
tasks/020-cross-module-ports/DELEGATION-sp4-fix.md
tasks/020-cross-module-ports/DELEGATION-sp4.md
tasks/020-cross-module-ports/PR_BODY.md
tasks/020-cross-module-ports/TASK.md
tasks/020-cross-module-ports/backend-sp1-1.md
tasks/020-cross-module-ports/backend-sp2a-1.md
tasks/020-cross-module-ports/backend-sp2b-1.md
tasks/020-cross-module-ports/backend-sp3-1.md
tasks/020-cross-module-ports/investigation-1.md
tasks/020-cross-module-ports/investigation-2.md
tasks/020-cross-module-ports/investigation-3.md
tasks/020-cross-module-ports/release-facts.md
tasks/020-cross-module-ports/review-1.md
tasks/020-cross-module-ports/review-10.md
tasks/020-cross-module-ports/review-11.md
tasks/020-cross-module-ports/review-2.md
tasks/020-cross-module-ports/review-3.md
tasks/020-cross-module-ports/review-4.md
tasks/020-cross-module-ports/review-5.md
tasks/020-cross-module-ports/review-6.md
tasks/020-cross-module-ports/review-7.md
tasks/020-cross-module-ports/review-8.md
tasks/020-cross-module-ports/review-9.md
tasks/020-cross-module-ports/staging-evidence.md
tasks/020-cross-module-ports/verification-sp1.md
tasks/020-cross-module-ports/verification-sp2a-1.md
tasks/020-cross-module-ports/verification-sp2b-final.md
tasks/020-cross-module-ports/verification-sp3.md
tasks/020-cross-module-ports/verification-sp4.md
tasks/README.md
EXIT:0
```

---

## Command 6 — grep for excluded task dirs

```
NO_EXCLUDED_TASKS_STAGED
EXIT:0
```

---

## Command 7 — grep for 014-migrate-planning files

```
tasks/014-migrate-planning/TASK.md
EXIT:0
```
