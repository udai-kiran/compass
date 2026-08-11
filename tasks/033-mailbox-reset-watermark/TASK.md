# Task: mailbox-reset-watermark

## Status
COMPLETE

## Objective
Add a `POST /api/mailboxes/:id/reset-watermark` endpoint that resets the IMAP
resume watermark so the ingestor reprocesses all mail from the beginning on the
next sync.

## Root Cause
The `mailbox_accounts` table stores `uid_validity` (bigint) and `last_uid`
(bigint) as the IMAP resume watermark. `planSync()` in `sync.ts` checks:
  - if `stored === null` → baseline to `uidNext − 1` (no history re-fetch)
  - if `stored.uidValidity !== current.uidValidity` → same baseline behaviour
  - if match → `fromUid = stored.lastUid + 1`

To re-fetch all messages, set `last_uid = 0` while keeping `uid_validity`
unchanged. This makes `planSync` return `fromUid = 1` (all UIDs ≥ 1).
Setting both to `null` would instead baseline to "now" — wrong.

## Scope
- `apps/api/src/modules/ingest/services/mailboxes.ts` — add `resetMailboxWatermark`
- `apps/api/src/modules/ingest/routes/mailboxes.ts` — add `POST /api/mailboxes/:id/reset-watermark`

## Dependencies
none

## Plan
- P1: In `services/mailboxes.ts`, add:
  ```ts
  export async function resetMailboxWatermark(db: Db, userId: string, id: string): Promise<void> {
    const updated = await db
      .update(mailboxAccounts)
      .set({ lastUid: 0, updatedAt: new Date() })
      .where(and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId)))
      .returning({ id: mailboxAccounts.id });
    if (updated.length === 0) throw new HttpError(404, "Mailbox not found");
  }
  ```
- P2: In `routes/mailboxes.ts`, import `resetMailboxWatermark` and add:
  ```ts
  r.post(
    "/api/mailboxes/:id/reset-watermark",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req) => {
      await resetMailboxWatermark(app.db, req.session!.userId, req.params.id);
      return { ok: true as const };
    },
  );
  ```

## Acceptance Criteria
- AC1: `POST /api/mailboxes/:id/reset-watermark` sets `last_uid = 0` for the matching row; `uid_validity` is unchanged.
- AC2: Returns `{ ok: true }` on success; returns 404 if the mailbox doesn't belong to the caller.
- AC3: No migration needed — only updates existing nullable bigint columns.
- AC4: Typecheck passes (`npm run typecheck`).

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run test -w apps/api` exits 0 (no regressions)

## Codex Review Findings (review-1.md)
- **Never-synced edge case**: `(uid_validity=null, last_uid=0)` → ingestor reconstructs `stored=null` → `planSync` baselines to now. This is semantically correct — never-synced mailboxes have nothing to reprocess; the behaviour is identical with or without the reset. No ingestor change needed.
- **Concurrent sync race**: An in-flight sync that loaded the old watermark can overwrite the reset via `saveWatermark()`. Acknowledged as a known limitation; acceptable for this personal-finance context (BullMQ jobs are short, syncs are infrequent).
- **Security/ownership**: Filtering by both `id` and `userId` is correct. 404 for non-existent and foreign-owned mailboxes avoids enumeration.
- **Conventions**: The route follows existing patterns; static `/sync` route already placed before parameterized routes.

## Non-Goals
- No UI changes (user can trigger via API/curl until UI support is added)
- No new Zod shared schema (response is trivially `{ ok: true }`)
- No migration
- No ingestor changes (never-synced edge case is a semantic no-op)
- No serialization for concurrent sync race (acceptable trade-off)
