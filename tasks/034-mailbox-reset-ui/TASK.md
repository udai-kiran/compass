# Task: mailbox-reset-ui

## Status
COMPLETE

## Objective
Add a "Reprocess all" button to each mailbox row in Settings → Mailboxes that
calls `POST /api/mailboxes/:id/reset-watermark` and then queues an immediate sync.

## Scope
- `apps/web/src/lib/mailbox-queries.ts` — add `resetWatermark` mutation to `useMailboxMutations`
- `apps/web/src/routes/settings/MailboxesPanel.tsx` — wire button into `MailboxRow`

## Dependencies
- Task 033 (API endpoint) — already implemented and in PR #185

## Codex Review Findings (review-1.md)
- **High**: Plan never called sync after reset — fixed: `onReset` now chains reset→sync.
- **Medium**: Pending/disabled state missing — fixed: `resetting` prop disables button across rows while in-flight.
- **Medium**: Sync failure must be handled separately from reset failure — fixed: two distinct toast paths.
- **Medium**: Confirmation text overpromised — fixed: new wording is accurate.
- **Low**: `sync.isPending` already disables the panel-level "Queue sync" button while chain runs — acceptable.
- `apiPost` with no body is valid (third arg is optional). Mutation pattern matches existing hooks.
- Add `type="button"` and `disabled:opacity-50` to the button.

## Plan
- P1: In `mailbox-queries.ts`, add inside `useMailboxMutations`:
  ```ts
  const resetWatermark = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/mailboxes/${id}/reset-watermark`, z.object({ ok: z.literal(true) })),
  });
  ```
  Return it in the object: `{ add, remove, sync, resetWatermark }`.
  (No `onSuccess: invalidate` — watermark columns aren't in the MailboxAccount DTO.)

- P2: In `MailboxesPanel.tsx`:
  - Destructure `resetWatermark` from `useMailboxMutations()`
  - Extend `MailboxRow` props: `onReset: (id: string) => void` and `resetting: boolean`
  - In `MailboxRow`, add button:
    - `type="button"`, label `{resetting ? "Resetting…" : "Reprocess all"}`
    - `disabled={resetting}`, styling: `text-xs text-amber-600 underline disabled:opacity-50`
    - `onClick`: confirm `"Reset ${mb.emailAddress} and queue a sync to reprocess its available mail?"` then `onReset(mb.id)`
  - In `MailboxesPanel`, pass to `MailboxRow`:
    - `resetting={resetWatermark.isPending}`
    - `onReset={(id) => resetWatermark.mutate(id, {
        onSuccess: () =>
          sync.mutate(SYNC_WINDOW_MINUTES[0], {
            onSuccess: (res) => toast(\`Watermark reset — sync queued (within ${res.runsInMinutes} min)\`, "success"),
            onError: () => toast("Watermark reset, but couldn't queue sync — use the Queue sync button"),
          }),
        onError: (e) => toast(e instanceof Error ? e.message : "Couldn't reset watermark"),
      })}`

## Acceptance Criteria
- AC1: "Reprocess all" button appears in every connected mailbox row
- AC2: Clicking shows confirm dialog; cancelling does nothing; confirming calls reset then sync
- AC3: Full success → toast "Watermark reset — sync queued (within N min)"
- AC4: Reset ok but sync fails → toast "Watermark reset, but couldn't queue sync — use the Queue sync button"
- AC5: Reset fails → error toast with the server message
- AC6: Button is disabled and labelled "Resetting…" while mutation in flight
- AC7: `npm run typecheck` exits 0

## Verification
- T1: `npm run typecheck` exits 0

## Non-Goals
- No backend changes (API is already done in task 033)
- No new shared schema
- No tests (UI component, no existing test infra for it)
