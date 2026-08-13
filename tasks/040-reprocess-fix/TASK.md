# Task: Fix "Reprocess All" not re-extracting emails

## Status
COMPLETE

## Objective
`POST /api/mailboxes/:id/reset-watermark` must reset `email_ingestions.status`
to `'pending'` (and clear `error`) for all terminal-status rows belonging to
that mailbox, so the ingestor re-enqueues them on the next sync pass.

## Root Cause
`resetMailboxWatermark` (apps/api/src/modules/ingest/services/mailboxes.ts:151)
only sets `last_uid = 0` on `mailbox_accounts`. It does **not** touch
`email_ingestions`.

When the ingestor re-fetches all UIDs (which it does correctly from UID 1 after
the watermark reset), `recordIngestion` uses:
  `ON CONFLICT (user_id, message_id) DO UPDATE SET message_id = excluded.message_id`
This is a deliberate no-op — `status` is NOT updated. The row comes back with
its existing terminal status (`extracted`, `ignored`, `deferred`, or `failed`).

Back in `syncPass` (apps/ingestor/src/index.ts:109), the guard:
  `if (rec.status === "pending") { await enqueue(rec.id); }`
skips every row whose status is not `pending`. Zero messages are enqueued.

The IMAP re-fetch is correct; only the extraction re-trigger is broken.

## Scope
**Files changed:**
1. `apps/api/src/modules/ingest/services/mailboxes.ts` — P1 + P2
2. `apps/ingestor/src/index.ts` — P3

**Imports to add in services/mailboxes.ts:**
- `emailIngestions` from `"../schema.ts"` (already exported there)
- `inArray` from `"drizzle-orm"` (in addition to existing `and`, `eq`, `desc`)

**No DB migration needed** — no schema change.

## Dependencies
- None

## Plan
- P1: In `resetMailboxWatermark`, after the `mailboxAccounts` update (and only
  if it affected 1 row), run a second update:
  ```
  UPDATE email_ingestions
  SET status = 'pending', error = null, updated_at = now()
  WHERE mailbox_id = $id
    AND user_id = $userId
    AND status IN ('extracted','ignored','deferred','failed')
  ```
  Do NOT reset `processing` rows (they are in-flight; resetting would risk
  double-extraction if the extractor job is still running).
- P2: Wrap both updates in `db.transaction(...)` so the watermark reset and
  the status reset are atomic — a crash between the two would otherwise leave
  the watermark at 0 but ingestions still terminal, causing the ingestor to
  re-fetch but again enqueue nothing.
- P3: Fix BullMQ dedup for `failed` jobs in `apps/ingestor/src/index.ts`.
  `queue.add()` with `jobId: ingestionId` is a no-op when a failed job with
  the same ID is retained in Redis (`removeOnFail: 500`). In `enqueue()`, before
  calling `queue.add()`, call `queue.getJob(ingestionId)`. If the returned job's
  state is `"failed"`, call `job.remove()` first. This clears the retained job so
  the subsequent `queue.add()` creates a fresh one. This adds one Redis round-trip
  per enqueue (null for completed/removed jobs — the common case).

## Codex review notes (review-1.md)
- Blocking: BullMQ `failed` job dedup (P3 addresses this)
- Non-blocking: nullable `mailbox_id` on orphaned ingestions — document as known
  limitation (mailbox deleted+re-added edge case; not in scope of "Reprocess All")
- Non-blocking: no automated tests added — acceptable given no test infra for BullMQ
  integration in this codebase; typecheck + lint + existing tests are the gates

## Acceptance Criteria
- AC1: After `reset-watermark`, all `email_ingestions` rows for that mailbox
  with status `extracted|ignored|deferred|failed` have `status = 'pending'`
  and `error = null`.
- AC2: Rows with `status = 'processing'` are NOT touched.
- AC3: Rows belonging to a different mailbox or different user are NOT touched.
- AC4: If the mailbox ID does not exist or belongs to another user, the 404
  error is still returned and no ingestion rows are modified.
- AC5: Both updates are wrapped in a single DB transaction (atomic).

## Verification
- T1: TypeScript compiles with `npm run typecheck`.
- T2: Lint passes with `npm run lint`.
- T3: Existing tests pass with `npm run test`.
- T4: (Manual/prod) Confirm via SQL on prod that after calling the endpoint,
  the affected rows show `status = 'pending'`.

## Non-Goals
- Resetting `extracted_transactions` rows — the extractor's `ON CONFLICT DO NOTHING`
  means old pending review items remain visible (harmless), and rejected ones
  staying suppressed is arguably correct behaviour.
- Any UI change.
- Any migration.
