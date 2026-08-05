# git-state — tasks/018-migrate-system evidence run
# Date: 2026-08-05

---

## 1. git status --porcelain=v1 -uall

```
 M apps/api/src/app.ts
 M apps/api/src/db/restore.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/automation/routes/ai.ts
 M apps/api/src/modules/automation/routes/automation.route.test.ts
 M apps/api/src/modules/credit/routes/cards.ts
 M apps/api/src/modules/credit/services/alerts.ts
R  apps/api/src/routes/imports.ts -> apps/api/src/modules/ingest/routes/imports.ts
R  apps/api/src/routes/inbox.ts -> apps/api/src/modules/ingest/routes/inbox.ts
R  apps/api/src/routes/mailboxes.ts -> apps/api/src/modules/ingest/routes/mailboxes.ts
R  apps/api/src/services/import-reconciliation.test.ts -> apps/api/src/modules/ingest/services/import-reconciliation.test.ts
R  apps/api/src/services/import-reconciliation.ts -> apps/api/src/modules/ingest/services/import-reconciliation.ts
R  apps/api/src/services/imports.test.ts -> apps/api/src/modules/ingest/services/imports.test.ts
R  apps/api/src/services/imports.ts -> apps/api/src/modules/ingest/services/imports.ts
R  apps/api/src/services/inbox.test.ts -> apps/api/src/modules/ingest/services/inbox.test.ts
R  apps/api/src/services/mailboxes.ts -> apps/api/src/modules/ingest/services/mailboxes.ts
 M apps/api/src/modules/investments/routes/networth.route.test.ts
 M apps/api/src/modules/ledger/routes/ledger-events.route.test.ts
 M apps/api/src/modules/ledger/routes/user-tasks.route.test.ts
 M apps/api/src/modules/planning/routes/planning.route.test.ts
 M apps/api/src/modules/planning/routes/projection-settings.route.test.ts
 M apps/api/src/modules/planning/services/bills.ts
 M apps/api/src/modules/planning/services/goals.ts
 M apps/api/src/modules/protection/routes/protection.route.test.ts
RM apps/api/src/routes/auth.ts -> apps/api/src/modules/system/routes/auth.ts
RM apps/api/src/routes/backup.ts -> apps/api/src/modules/system/routes/backup.ts
R  apps/api/src/routes/health.ts -> apps/api/src/modules/system/routes/health.ts
R  apps/api/src/routes/notifications.ts -> apps/api/src/modules/system/routes/notifications.ts
R  apps/api/src/routes/profile.ts -> apps/api/src/modules/system/routes/profile.ts
RM apps/api/src/services/auth.ts -> apps/api/src/modules/system/services/auth.ts
RM apps/api/src/services/backup.test.ts -> apps/api/src/modules/system/services/backup.test.ts
RM apps/api/src/services/backup.ts -> apps/api/src/modules/system/services/backup.ts
R  apps/api/src/services/demo.test.ts -> apps/api/src/modules/system/services/demo.test.ts
RM apps/api/src/services/demo.ts -> apps/api/src/modules/system/services/demo.ts
RM apps/api/src/services/health.ts -> apps/api/src/modules/system/services/health.ts
RM apps/api/src/services/notifications.ts -> apps/api/src/modules/system/services/notifications.ts
RM apps/api/src/services/prefs.ts -> apps/api/src/modules/system/services/prefs.ts
RM apps/api/src/services/profile.test.ts -> apps/api/src/modules/system/services/profile.test.ts
RM apps/api/src/services/profile.ts -> apps/api/src/modules/system/services/profile.ts
RM apps/api/src/services/restore-user.ts -> apps/api/src/modules/system/services/restore-user.ts
R  apps/api/src/services/session.ts -> apps/api/src/modules/system/services/session.ts
 M apps/api/src/plugins/auth.ts
 M apps/api/src/route-table.snapshot.txt
 M apps/api/src/services/anomaly.ts
 M apps/api/src/services/autopilot.ts
D  apps/api/src/services/inbox.ts
 M tasks/014-migrate-planning/TASK.md
?? apps/api/src/lib/storage.test.ts
?? apps/api/src/modules/ingest/plugin.test.ts
?? apps/api/src/modules/ingest/plugin.ts
?? apps/api/src/modules/ingest/routes/ingest.route.test.ts
?? apps/api/src/modules/ingest/schema.smoke.test.ts
?? apps/api/src/modules/ingest/schema.ts
?? apps/api/src/modules/ingest/services/inbox-shared.ts
?? apps/api/src/modules/ingest/services/review-actions.ts
?? apps/api/src/modules/ingest/services/review-queue.ts
?? apps/api/src/modules/ingest/services/transfer-classification.ts
?? apps/api/src/modules/system/plugin.test.ts
?? apps/api/src/modules/system/plugin.ts
?? apps/api/src/modules/system/routes/system.route.test.ts
?? apps/api/src/modules/system/schema.smoke.test.ts
?? apps/api/src/modules/system/schema.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/DELEGATION.md
?? tasks/015-statusline/TASK.md
?? tasks/015-statusline/backend-1.md
?? tasks/015-statusline/investigation-1.md
?? tasks/015-statusline/investigation-2.md
?? tasks/015-statusline/review-1.md
?? tasks/015-statusline/verification-1.md
?? tasks/017-migrate-ingest/DELEGATION-2.md
?? tasks/017-migrate-ingest/DELEGATION-3.md
?? tasks/017-migrate-ingest/DELEGATION.md
?? tasks/017-migrate-ingest/TASK.md
?? tasks/017-migrate-ingest/investigation-1.md
?? tasks/017-migrate-ingest/review-1.md
?? tasks/017-migrate-ingest/review-2.md
?? tasks/017-migrate-ingest/review-3.md
?? tasks/018-migrate-system/DELEGATION.md
?? tasks/018-migrate-system/TASK.md
?? tasks/018-migrate-system/backend-1.md
?? tasks/018-migrate-system/backend-2.md
?? tasks/018-migrate-system/investigation-1.md
?? tasks/018-migrate-system/review-1.md
?? tasks/018-migrate-system/review-2.md
?? tasks/018-migrate-system/verification-1.md
?? tasks/018-migrate-system/verification-2.md
?? tasks/019-storage-contract-tests/DELEGATION.md
?? tasks/019-storage-contract-tests/TASK.md
?? tasks/019-storage-contract-tests/investigation-1.md
?? tasks/019-storage-contract-tests/review-1.md
?? tasks/019-storage-contract-tests/review-2.md
?? tasks/019-storage-contract-tests/review-3.md
?? tasks/BATCH-phase1-close.md
```

---

## 2. git diff --stat HEAD -- apps/api/src/app.ts

```
 apps/api/src/app.ts | 39 +++++++++++++++++++++++----------------
 1 file changed, 23 insertions(+), 16 deletions(-)
```

---

## 3. git log --oneline -3

```
5031b88 Merge pull request #164 from udai-kiran/refactor/module-migration-phase1-automation
a219cbc refactor(api): migrate automation/AI module into modules/automation (roadmap 1.6)
f58ad0f Merge pull request #163 from udai-kiran/refactor/module-migration-phase1-planning
```

---

## 4. git diff HEAD -- apps/api/src/app.ts (full diff)

```diff
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index 4066b66..72882cc 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -16,20 +16,14 @@ import multipart from "@fastify/multipart";
 import compress from "@fastify/compress";
 import { setupAuth } from "./plugins/auth.ts";
 import { setupSecurity } from "./plugins/security.ts";
-import { healthRoutes } from "./routes/health.ts";
-import { authRoutes } from "./routes/auth.ts";
+import { systemRoutes } from "./modules/system/plugin.ts";
 import { ledgerRoutes } from "./modules/ledger/plugin.ts";
-import { importRoutes } from "./routes/imports.ts";
-import { notificationRoutes } from "./routes/notifications.ts";
+import { ingestRoutes } from "./modules/ingest/plugin.ts";
 import { investmentsRoutes } from "./modules/investments/plugin.ts";
 import { creditRoutes } from "./modules/credit/plugin.ts";
 import { protectionRoutes } from "./modules/protection/plugin.ts";
-import { backupRoutes } from "./routes/backup.ts";
 import { automationRoutes } from "./modules/automation/plugin.ts";
 import { planningRoutes } from "./modules/planning/plugin.ts";
-import { profileRoutes } from "./routes/profile.ts";
-import { inboxRoutes } from "./routes/inbox.ts";
-import { mailboxRoutes } from "./routes/mailboxes.ts";
 import { invalidateUserCache } from "./services/cache.ts";
 import { enqueueBudgetEvaluation } from "./jobs/index.ts";
 import { createStorage, type Storage } from "./lib/storage.ts";
@@ -122,22 +116,35 @@ export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
  * already-adjacent, already-in-order registrations in a plugin does not
  * change the raw `printRoutes()` tree — see `route-table.snapshot.txt`
  * whose regenerated content is expected byte-identical.
+ *
+ * As of task 1.7 (migrate-ingest), the 3 email→transaction route
+ * registrations (imports/inbox/mailboxes) are collapsed into the single
+ * `ingestRoutes` plugin, in the position `importRoutes` used to occupy.
+ * `inboxRoutes`/`mailboxRoutes` used to register much later (after
+ * `profileRoutes`, interleaved with other flat registrations) — like the
+ * three earlier migrations that moved interleaved registrations together,
+ * this legitimately restructures the raw `printRoutes()` tree — see
+ * `modules/ingest/plugin.ts`.
+ * As of task 1.8 (migrate-system), the 5 system route registrations that used
+ * to sit here directly (health/auth/notifications/backup/profile) are collapsed
+ * into the single `systemRoutes` plugin registered below, in the position
+ * `healthRoutes` used to occupy. `notificationRoutes`/`backupRoutes`/
+ * `profileRoutes` used to register much later (interleaved with other module
+ * registrations), so collapsing all 5 into one contiguous plugin call, in the
+ * position `healthRoutes` used to occupy, legitimately restructures the raw
+ * `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated diff) but
+ * does not change the canonical (method, path) surface
+ * (`route-surface.snapshot.txt`).
  */
 export async function registerRoutes(app: FastifyInstance): Promise<void> {
-  await app.register(healthRoutes);
-  await app.register(authRoutes);
+  await app.register(systemRoutes);
   await app.register(ledgerRoutes);
-  await app.register(importRoutes);
+  await app.register(ingestRoutes);
   await app.register(planningRoutes);
-  await app.register(notificationRoutes);
   await app.register(investmentsRoutes);
   await app.register(creditRoutes);
   await app.register(protectionRoutes);
-  await app.register(backupRoutes);
   await app.register(automationRoutes);
-  await app.register(profileRoutes);
-  await app.register(inboxRoutes);
-  await app.register(mailboxRoutes);
 }
 
 export async function buildApp(config: Config): Promise<FastifyInstance> {
```

---

## 5. git diff HEAD --stat -- apps/api/src/route-table.snapshot.txt

```
 apps/api/src/route-table.snapshot.txt | 78 +++++++++++++++++------------------
 1 file changed, 39 insertions(+), 39 deletions(-)
```

---

## 6a. ls -la apps/api/src/routes/ 2>&1 | head -40

```
drwxrwxr-x udai udai 4.0 KB Wed Aug  5 15:49:57 2026 .
drwxrwxr-x udai udai 4.0 KB Wed Aug  5 16:20:42 2026 ..
```

(routes/ directory is EMPTY — all files have been moved out)

---

## 6b. ls -la apps/api/src/modules/system/routes/ 2>&1

```
drwxrwxr-x udai udai 4.0 KB Wed Aug  5 16:12:26 2026 .
drwxrwxr-x udai udai 4.0 KB Wed Aug  5 15:53:39 2026 ..
.rw-rw-r-- udai udai 5.7 KB Wed Aug  5 15:50:18 2026 auth.ts
.rw-rw-r-- udai udai 4.7 KB Wed Aug  5 15:50:30 2026 backup.ts
.rw-rw-r-- udai udai 511 B  Wed Aug  5 15:49:57 2026 health.ts
.rw-rw-r-- udai udai 1.9 KB Tue Jul 14 17:32:42 2026 notifications.ts
.rw-rw-r-- udai udai 2.0 KB Fri Jul 24 18:33:01 2026 profile.ts
.rw-rw-r-- udai udai  14 KB Wed Aug  5 16:13:57 2026 system.route.test.ts
```

---

## 7. git diff HEAD --name-status -- apps/api/src/routes/ apps/api/src/modules/system/ apps/api/src/modules/ingest/

```
R098	apps/api/src/routes/imports.ts	apps/api/src/modules/ingest/routes/imports.ts
R092	apps/api/src/routes/inbox.ts	apps/api/src/modules/ingest/routes/inbox.ts
R097	apps/api/src/routes/mailboxes.ts	apps/api/src/modules/ingest/routes/mailboxes.ts
A	apps/api/src/modules/ingest/services/import-reconciliation.test.ts
A	apps/api/src/modules/ingest/services/import-reconciliation.ts
A	apps/api/src/modules/ingest/services/imports.test.ts
A	apps/api/src/modules/ingest/services/imports.ts
A	apps/api/src/modules/ingest/services/inbox.test.ts
A	apps/api/src/modules/ingest/services/mailboxes.ts
R093	apps/api/src/routes/auth.ts	apps/api/src/modules/system/routes/auth.ts
R097	apps/api/src/routes/backup.ts	apps/api/src/modules/system/routes/backup.ts
R100	apps/api/src/routes/health.ts	apps/api/src/modules/system/routes/health.ts
R100	apps/api/src/routes/notifications.ts	apps/api/src/modules/system/routes/notifications.ts
R100	apps/api/src/routes/profile.ts	apps/api/src/modules/system/routes/profile.ts
A	apps/api/src/modules/system/services/auth.ts
A	apps/api/src/modules/system/services/backup.test.ts
A	apps/api/src/modules/system/services/backup.ts
A	apps/api/src/modules/system/services/demo.test.ts
A	apps/api/src/modules/system/services/demo.ts
A	apps/api/src/modules/system/services/health.ts
A	apps/api/src/modules/system/services/notifications.ts
A	apps/api/src/modules/system/services/prefs.ts
A	apps/api/src/modules/system/services/profile.test.ts
A	apps/api/src/modules/system/services/profile.ts
A	apps/api/src/modules/system/services/restore-user.ts
A	apps/api/src/modules/system/services/session.ts
```
