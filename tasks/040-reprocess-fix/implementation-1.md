# Implementation Report — Iteration 1: 040-reprocess-fix

## Files Inspected
- `apps/api/src/modules/ingest/services/mailboxes.ts`
- `apps/api/src/modules/ingest/schema.ts` (confirmed `emailIngestions` re-exported)
- `apps/api/src/db/shared/hubs.ts` (confirmed `email_ingestions` columns: `status`, `error`, `mailboxId`, `userId`, `updatedAt`)
- `apps/ingestor/src/index.ts`

## Files Changed
- `apps/api/src/modules/ingest/services/mailboxes.ts`
- `apps/ingestor/src/index.ts`

## Implementation Details

### mailboxes.ts
1. Added `inArray` to drizzle-orm import.
2. Added `emailIngestions` to `../schema.ts` import (it is already re-exported from `schema.ts` line 39 via `../../db/shared/hubs.ts`).
3. Replaced `resetMailboxWatermark` with a `db.transaction()` version that:
   - First updates `mailboxAccounts` and throws 404 if ownership check fails (returns 0 rows).
   - Then updates `email_ingestions` rows where `status IN ('extracted','ignored','deferred','failed')` AND `mailboxId = id` AND `userId = userId`, setting `status = 'pending'`, `error = null`, `updatedAt = now()`. `processing` rows are intentionally excluded.

### ingestor/src/index.ts
- Before `queue.add()`, calls `queue.getJob(ingestionId)`. If an existing job is found and its state is `"failed"`, removes it. This defeats BullMQ's jobId deduplication that would silently block re-enqueue of previously-failed emails.

## Complete Diff

```diff
diff --git a/apps/api/src/modules/ingest/services/mailboxes.ts b/apps/api/src/modules/ingest/services/mailboxes.ts
index ab80721..e5a7f50 100644
--- a/apps/api/src/modules/ingest/services/mailboxes.ts
+++ b/apps/api/src/modules/ingest/services/mailboxes.ts
@@ -1,11 +1,11 @@
-import { and, desc, eq } from "drizzle-orm";
+import { and, desc, eq, inArray } from "drizzle-orm";
 import {
   ConnectBundleSchema,
   type MailboxAccount,
   type MailboxCredentialsStatus,
 } from "@compass/shared";
 import type { Db } from "../../../db/index.ts";
-import { mailboxAccounts, mailboxCredentials } from "../schema.ts";
+import { mailboxAccounts, mailboxCredentials, emailIngestions } from "../schema.ts";
 import { HttpError } from "../../../lib/errors.ts";
 import { encryptSecret } from "../../../lib/secret-box.ts";
 
@@ -149,10 +149,27 @@ export async function getCredentialsStatus(
  * "now" in either case.
  */
 export async function resetMailboxWatermark(db: Db, userId: string, id: string): Promise<void> {
-  const updated = await db
-    .update(mailboxAccounts)
-    .set({ lastUid: 0, updatedAt: new Date() })
-    .where(and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId)))
-    .returning({ id: mailboxAccounts.id });
-  if (updated.length === 0) throw new HttpError(404, "Mailbox not found");
+  await db.transaction(async (tx) => {
+    // 1. Reset the IMAP resume watermark and verify ownership.
+    const updated = await tx
+      .update(mailboxAccounts)
+      .set({ lastUid: 0, updatedAt: new Date() })
+      .where(and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId)))
+      .returning({ id: mailboxAccounts.id });
+    if (updated.length === 0) throw new HttpError(404, "Mailbox not found");
+
+    // 2. Reset all terminal-status ingestions so the ingestor re-enqueues them.
+    // Do NOT touch 'processing' rows — those are in-flight and resetting them
+    // risks double-extraction if the extractor job is still running.
+    await tx
+      .update(emailIngestions)
+      .set({ status: "pending", error: null, updatedAt: new Date() })
+      .where(
+        and(
+          eq(emailIngestions.mailboxId, id),
+          eq(emailIngestions.userId, userId),
+          inArray(emailIngestions.status, ["extracted", "ignored", "deferred", "failed"]),
+        ),
+      );
+  });
 }
diff --git a/apps/ingestor/src/index.ts b/apps/ingestor/src/index.ts
index 969ba41..1a1e485 100644
--- a/apps/ingestor/src/index.ts
+++ b/apps/ingestor/src/index.ts
@@ -56,6 +56,14 @@ async function accessTokenFor(
 }
 
 async function enqueue(ingestionId: string): Promise<void> {
+  // If a failed job with this ID is retained in the queue (removeOnFail: 500),
+  // queue.add() with the same jobId would be a silent no-op due to BullMQ
+  // deduplication. Remove the stale failed job first so a fresh one can be added.
+  const existing = await queue.getJob(ingestionId);
+  if (existing !== undefined) {
+    const state = await existing.getState();
+    if (state === "failed") await existing.remove();
+  }
   await queue.add(
     "extract",
     { ingestionId },
```

## Command Outputs

### npm run typecheck
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

EXIT: 0
```

### npm run lint
```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```

### npm run test
Exit code: **1**

All 26 failing test files fail with one of these messages:
- `Error: app.test.ts needs DATABASE_URL set (a real Redis-backed subscriber test)`
- `Error: postings-periods-parity.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection)`
- (same pattern for all 26 failures)

These are pre-existing DB/Redis integration tests that require a live Postgres and Redis connection. They are environment-specific failures unrelated to this change.

The non-DB test suite (packages/shared and others) shows:
```
ℹ tests 212
ℹ pass 212
ℹ fail 0
```

## Assumptions
- All test failures are pre-existing and due to missing `DATABASE_URL`/`REDIS_URL` in the dev environment — confirmed by reading all failure messages.
- `emailIngestions` in the ingest module schema (`../schema.ts` line 39) re-exports the symbol from `db/shared/hubs.ts`, making it available for import in `mailboxes.ts`.

## Unresolved Risks
- None introduced by this change. The `processing` exclusion is intentional per the brief to avoid double-extraction of in-flight jobs.
