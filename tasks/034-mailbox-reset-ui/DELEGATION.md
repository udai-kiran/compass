# Sonnet Worker Delegation

## Task
034-mailbox-reset-ui — "Reprocess all" button in MailboxesPanel

## Approved Plan
- P1: Add `resetWatermark` mutation to `useMailboxMutations` in `mailbox-queries.ts`
- P2: Add "Reprocess all" button to `MailboxRow` in `MailboxesPanel.tsx`; wire reset→sync chain in `MailboxesPanel`

## Files and Symbols
- `apps/web/src/lib/mailbox-queries.ts`
- `apps/web/src/routes/settings/MailboxesPanel.tsx`

## Required Changes

### `apps/web/src/lib/mailbox-queries.ts`

Add `SYNC_WINDOW_MINUTES` to the import from `@compass/shared`.

Inside `useMailboxMutations`, after the `sync` mutation, add:
```ts
const resetWatermark = useMutation({
  mutationFn: (id: string) =>
    apiPost(`/api/mailboxes/${id}/reset-watermark`, z.object({ ok: z.literal(true) })),
});
```

Update the return value to include `resetWatermark`:
```ts
return { add, remove, sync, resetWatermark };
```

### `apps/web/src/routes/settings/MailboxesPanel.tsx`

1. Add `SYNC_WINDOW_MINUTES` to the import from `@compass/shared` (it's already imported from there — just add it).

2. In `MailboxesPanel`:
   - Destructure `resetWatermark` from `useMailboxMutations()`.
   - Pass two new props to `<MailboxRow>`:
     - `resetting={resetWatermark.isPending}`
     - `onReset` callback that chains reset → sync:
       ```ts
       onReset={(id) =>
         resetWatermark.mutate(id, {
           onSuccess: () =>
             sync.mutate(SYNC_WINDOW_MINUTES[0], {
               onSuccess: (res) =>
                 toast(`Watermark reset — sync queued (within ${res.runsInMinutes} min)`, "success"),
               onError: () =>
                 toast("Watermark reset, but couldn't queue sync — use the Queue sync button"),
             }),
           onError: (e) =>
             toast(e instanceof Error ? e.message : "Couldn't reset watermark"),
         })
       }
       ```

3. Extend `MailboxRow` props type to include:
   ```ts
   onReset: (id: string) => void;
   resetting: boolean;
   ```

4. In `MailboxRow`, add a button immediately before (or after) the existing "Remove" button:
   ```tsx
   <button
     type="button"
     disabled={resetting}
     className="text-xs text-amber-600 underline disabled:opacity-50"
     onClick={() => {
       if (confirm(`Reset ${mb.emailAddress} and queue a sync to reprocess its available mail?`))
         onReset(mb.id);
     }}
   >
     {resetting ? "Resetting…" : "Reprocess all"}
   </button>
   ```

## Must Not Change
- Any API / backend files
- Any other web files
- `packages/shared`

## Acceptance Criteria
- AC1: "Reprocess all" button appears in every mailbox row
- AC2: Confirm dialog on click; cancel → no call; confirm → reset then sync
- AC3: Full success → toast "Watermark reset — sync queued (within N min)"
- AC4: Reset ok, sync fails → toast "Watermark reset, but couldn't queue sync — use the Queue sync button"
- AC5: Reset fails → error toast
- AC6: Button disabled + "Resetting…" label while in flight
- AC7: `npm run typecheck` exits 0

## Commands
1. `npm run typecheck` from repo root — must exit 0

## Required Evidence
- complete diff of both changed files
- exact typecheck output and exit code
- any deviations
