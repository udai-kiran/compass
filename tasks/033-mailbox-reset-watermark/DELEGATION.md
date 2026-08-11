# Sonnet Worker Delegation

## Task
033-mailbox-reset-watermark — Add POST /api/mailboxes/:id/reset-watermark

## Approved Plan
- P1: In `apps/api/src/modules/ingest/services/mailboxes.ts`, add `resetMailboxWatermark` function
- P2: In `apps/api/src/modules/ingest/routes/mailboxes.ts`, import and register the new route

## Files and Symbols
- `apps/api/src/modules/ingest/services/mailboxes.ts` — add `resetMailboxWatermark`
- `apps/api/src/modules/ingest/routes/mailboxes.ts` — add POST route, import new service fn

## Required Changes

### services/mailboxes.ts
Add at the end of the file (before the last closing line):

```ts
/**
 * Reset the IMAP resume watermark for a mailbox so the ingestor re-fetches all
 * messages from UID 1 on the next sync. Sets last_uid=0 while preserving
 * uid_validity so planSync() returns fromUid=1 (full re-fetch).
 *
 * Note: for a never-synced mailbox (uid_validity=null) this is a no-op — the
 * behaviour is identical with or without the reset, since planSync baselines to
 * "now" in either case.
 */
export async function resetMailboxWatermark(db: Db, userId: string, id: string): Promise<void> {
  const updated = await db
    .update(mailboxAccounts)
    .set({ lastUid: 0, updatedAt: new Date() })
    .where(and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId)))
    .returning({ id: mailboxAccounts.id });
  if (updated.length === 0) throw new HttpError(404, "Mailbox not found");
}
```

### routes/mailboxes.ts
1. Add `resetMailboxWatermark` to the import from `../services/mailboxes.ts`
2. Add the route BEFORE the closing brace of `mailboxRoutes`:

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

## Must Not Change
- The ingestor code (`apps/ingestor/`)
- Any other modules or shared packages
- Database schema / migrations
- The `uid_validity` column (only `last_uid` and `updated_at` are updated)

## Acceptance Criteria
- AC1: `POST /api/mailboxes/:id/reset-watermark` sets `last_uid = 0`; `uid_validity` is unchanged
- AC2: Returns `{ ok: true }` on success; 404 if mailbox not found or belongs to another user
- AC3: No migration needed
- AC4: `npm run typecheck` exits 0
- AC5: `npm run test -w apps/api` exits 0

## Commands
1. `npm run typecheck` — must exit 0
2. `npm run test -w apps/api` — must exit 0

## Required Evidence
- files changed (with diff)
- exact output of typecheck command with exit code
- exact output of `npm run test -w apps/api` with exit code
- any plan deviations or blockers
