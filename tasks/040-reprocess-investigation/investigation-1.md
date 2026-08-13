# Investigation: "Reprocess All" not reprocessing from the beginning

## Summary

The "Reprocess all" button resets the IMAP watermark correctly (so the ingestor
re-fetches all mail from UID 1), but the `email_ingestions` table still holds
the old, terminal statuses for every previously-seen message. The ingestor only
enqueues messages whose `status = 'pending'`; already-extracted rows are skipped.
Net result: zero emails are re-sent to the extractor.

---

## Files inspected

- `apps/web/src/routes/settings/MailboxesPanel.tsx` — UI button
- `apps/web/src/lib/mailbox-queries.ts` — frontend mutation hooks
- `apps/api/src/modules/ingest/routes/mailboxes.ts` — API routes
- `apps/api/src/modules/ingest/services/mailboxes.ts` — service layer
- `apps/api/src/db/shared/foundation.ts` — `mailbox_accounts` schema
- `apps/api/src/db/shared/hubs.ts` — `email_ingestions` schema + status enum
- `apps/ingestor/src/sync.ts` — pure IMAP plan/filter/advance logic
- `apps/ingestor/src/imap.ts` — IMAP connection wrapper
- `apps/ingestor/src/db.ts` — `recordIngestion`, `saveWatermark`, `loadSyncableMailboxes`
- `apps/ingestor/src/index.ts` — `syncPass`, BullMQ worker

---

## Flow traced end-to-end

### 1. UI ("Reprocess all" button)

`MailboxesPanel.tsx:184` — label "Reprocess all" on a button that calls:

```tsx
// MailboxesPanel.tsx:136-148
onReset={(id) =>
  resetWatermark.mutate(id, {
    onSuccess: () =>
      sync.mutate(SYNC_WINDOW_MINUTES[0], { ... }),
  })
}
```

On confirm, it fires `resetWatermark` then immediately queues a sync.

### 2. Frontend hooks

`mailbox-queries.ts:53-56`:
```ts
const resetWatermark = useMutation({
  mutationFn: (id: string) =>
    apiPost(`/api/mailboxes/${id}/reset-watermark`, z.object({ ok: z.literal(true) })),
});
```
No body is sent; the mailbox id comes from the URL path.

### 3. API route

`apps/api/src/modules/ingest/routes/mailboxes.ts:69-76`:
```ts
r.post(
  "/api/mailboxes/:id/reset-watermark",
  { schema: { params: z.object({ id: z.uuid() }), ... } },
  async (req) => {
    await resetMailboxWatermark(app.db, req.session!.userId, req.params.id);
    return { ok: true as const };
  },
);
```

### 4. Service — the watermark reset

`apps/api/src/modules/ingest/services/mailboxes.ts:151-158`:
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

Sets `last_uid = 0`, leaves `uid_validity` **unchanged**.

### 5. Ingestor — how the watermark is read

`apps/ingestor/src/index.ts:82-96` (inside `syncPass`):
```ts
const stored =
  mb.uidValidity !== null && mb.lastUid !== null
    ? { uidValidity: mb.uidValidity, lastUid: mb.lastUid }
    : null;
const plan = planSync(stored, box.state);

if (plan.baseline) {
  await saveWatermark(pool, mb.id, plan.baseline.uidValidity, plan.baseline.lastUid);
  return; // ingest nothing on baseline
}
```

After the reset, `mb.uidValidity` is still set and `mb.lastUid = 0` (not null).
`stored = { uidValidity: <saved_value>, lastUid: 0 }`.

`apps/ingestor/src/sync.ts:34-41` (`planSync`):
```ts
export function planSync(stored: Watermark | null, current: MailboxState): SyncPlan {
  const matches = stored !== null && stored.uidValidity === current.uidValidity;
  if (!matches) {
    // baseline → ingest nothing historical
    ...
  }
  return { fromUid: stored.lastUid + 1, baseline: null };
}
```

Because `uidValidity` still matches the IMAP server value, `matches = true` and
the plan is `{ fromUid: 1, baseline: null }` — the ingestor DOES fetch from UID 1.
This part is correct.

### 6. The bug — `recordIngestion` conflict path

`apps/ingestor/src/db.ts:81-101`:
```ts
export async function recordIngestion(...): Promise<{ id: string; status: string }> {
  const res = await pool.query(
    `insert into email_ingestions (..., status)
     values (...,'pending')
     on conflict (user_id, message_id) do update set message_id = excluded.message_id
     returning id, status`,
    [...],
  );
  return res.rows[0]!;
}
```

The `ON CONFLICT` clause is a deliberate no-op update (sets `message_id` to itself)
that makes `RETURNING` yield the **existing row unchanged**. `status` is NOT reset
to `'pending'`.

Back in `syncPass` (`index.ts:109-112`):
```ts
if (rec.status === "pending") {
  await enqueue(rec.id);
  enqueued++;
}
```

For every previously-ingested email, `rec.status` will be `extracted`, `ignored`,
`deferred`, or `failed` — **never `pending`**. Nothing is enqueued.

---

## Schema reference

`email_ingest_status` enum (`hubs.ts:138-145`):
```
pending | processing | extracted | deferred | ignored | failed
```

Unique constraint on `email_ingestions`: `(user_id, message_id)` —
so re-inserting the same email always hits the conflict path.

---

## Root cause

`resetMailboxWatermark` only resets the IMAP resume cursor. It does **not** touch
`email_ingestions`. When the ingestor re-fetches old UIDs and calls
`recordIngestion`, the conflict path returns each row with its current (terminal)
status. The `if (rec.status === "pending")` guard then prevents re-enqueueing.

The IMAP fetch is correct; the extraction re-trigger is broken.

---

## What "reprocess from the beginning" should do

1. Reset `last_uid = 0` on `mailbox_accounts` (already done) so the IMAP fetch
   starts from UID 1.
2. Reset `status = 'pending'` on every `email_ingestions` row for that mailbox
   that has already been processed (i.e., `status IN ('extracted','ignored',
   'deferred','failed')`), so `recordIngestion`'s conflict path returns `pending`
   and the ingestor enqueues them.

Neither step alone is sufficient. Currently only step 1 is performed.

---

## API endpoints involved

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/mailboxes/:id/reset-watermark` | Resets `last_uid=0` on the mailbox |
| POST | `/api/mailboxes/sync` | Enqueues an ingestor run (BullMQ, delayed) |

---

## Unresolved questions

- Should `processing` status rows also be reset? (Those are in-flight extractions;
  resetting them could cause a double-extract if the extractor is still running.)
- Should `extracted_transactions` rows from the original pass be deleted or kept?
  (A re-extract could produce duplicate inbox items if the dedupe hash covers the
  same content.)
- The note in `resetMailboxWatermark` source says "for a never-synced mailbox
  (uid_validity=null) this is a no-op" — confirming the developer was aware the
  current implementation only helps already-watermarked mailboxes, but did not
  connect this to the ingestion-status gap.
