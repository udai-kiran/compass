# Sonnet Worker Delegation — Iteration 1

## Task
040-reprocess-fix: Fix "Reprocess All" not re-extracting emails

## Approved Plan
- P1: In `resetMailboxWatermark` (services/mailboxes.ts), after the
  `mailboxAccounts` update confirms 1 row updated, run a second Drizzle update
  to reset `email_ingestions` status to `'pending'` (and clear `error`) for all
  terminal-status rows belonging to that mailbox/user.
- P2: Wrap both updates in `db.transaction(...)`.
- P3: In `enqueue()` (ingestor/src/index.ts), before `queue.add()`, call
  `queue.getJob(ingestionId)`. If the existing job's state is `"failed"`, remove
  it before adding the new one. This prevents BullMQ jobId dedup from silently
  blocking re-enqueue of previously-failed emails.

## Files and Symbols

### File 1: `apps/api/src/modules/ingest/services/mailboxes.ts`
- `resetMailboxWatermark` function (currently lines 151-158)
- Add imports: `emailIngestions` from `"../schema.ts"`, `inArray` from `"drizzle-orm"`

### File 2: `apps/ingestor/src/index.ts`
- `enqueue` function (currently lines 58-70)
- No new imports needed (`queue` is already the BullMQ `Queue` instance)

## Required Changes

### services/mailboxes.ts

Change the import line from drizzle-orm:
```
import { and, desc, eq } from "drizzle-orm";
```
to:
```
import { and, desc, eq, inArray } from "drizzle-orm";
```

Add `emailIngestions` to the schema import:
```
import { mailboxAccounts, mailboxCredentials, emailIngestions } from "../schema.ts";
```

Replace `resetMailboxWatermark` entirely:
```typescript
export async function resetMailboxWatermark(db: Db, userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Reset the IMAP resume watermark and verify ownership.
    const updated = await tx
      .update(mailboxAccounts)
      .set({ lastUid: 0, updatedAt: new Date() })
      .where(and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId)))
      .returning({ id: mailboxAccounts.id });
    if (updated.length === 0) throw new HttpError(404, "Mailbox not found");

    // 2. Reset all terminal-status ingestions so the ingestor re-enqueues them.
    // Do NOT touch 'processing' rows — those are in-flight and resetting them
    // risks double-extraction if the extractor job is still running.
    await tx
      .update(emailIngestions)
      .set({ status: "pending", error: null, updatedAt: new Date() })
      .where(
        and(
          eq(emailIngestions.mailboxId, id),
          eq(emailIngestions.userId, userId),
          inArray(emailIngestions.status, ["extracted", "ignored", "deferred", "failed"]),
        ),
      );
  });
}
```

### ingestor/src/index.ts

Replace the `enqueue` function (lines 58-70) with:
```typescript
async function enqueue(ingestionId: string): Promise<void> {
  // If a failed job with this ID is retained in the queue (removeOnFail: 500),
  // queue.add() with the same jobId would be a silent no-op due to BullMQ
  // deduplication. Remove the stale failed job first so a fresh one can be added.
  const existing = await queue.getJob(ingestionId);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (state === "failed") await existing.remove();
  }
  await queue.add(
    "extract",
    { ingestionId },
    {
      jobId: ingestionId,
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
}
```

## Must Not Change
- The route handler in `routes/mailboxes.ts` — no changes needed there
- The 404 error behavior — still thrown if mailbox not found or wrong user
- `recordIngestion` in the ingestor — no change
- Any schema files

## Acceptance Criteria
- AC1: After reset-watermark, `email_ingestions` rows for the mailbox with
  status `extracted|ignored|deferred|failed` have `status = 'pending'` and `error = null`
- AC2: `processing` rows are NOT touched
- AC3: Rows for other mailboxes/users are NOT touched
- AC4: Missing/wrong-owner mailbox still returns 404 with no ingestions modified
- AC5: Both DB updates are inside a single transaction
- AC6: `enqueue()` removes a failed BullMQ job before re-adding when one exists

## Commands
1. `npm run typecheck` — must exit 0
2. `npm run lint` — must exit 0
3. `npm run test` — must exit 0

## Required Evidence
- Complete diff of both files
- Exact command outputs and exit codes for typecheck, lint, test
- Any deviations from plan
