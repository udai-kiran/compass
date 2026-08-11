# Implementation Report — 034-mailbox-reset-ui

## Files Inspected
- `apps/web/src/lib/mailbox-queries.ts`
- `apps/web/src/routes/settings/MailboxesPanel.tsx`

## Files Changed
- `apps/web/src/lib/mailbox-queries.ts`
- `apps/web/src/routes/settings/MailboxesPanel.tsx`

## Implementation Details

### `apps/web/src/lib/mailbox-queries.ts`
- Added `SYNC_WINDOW_MINUTES` to the `@compass/shared` import (per delegation; not consumed in this file — `noUnusedLocals` is not set so no typecheck error).
- Added `resetWatermark` mutation after the existing `sync` mutation, calling `apiPost` on `/api/mailboxes/${id}/reset-watermark` expecting `{ ok: true }`.
- Updated return to `{ add, remove, sync, resetWatermark }`.

### `apps/web/src/routes/settings/MailboxesPanel.tsx`
- `SYNC_WINDOW_MINUTES` was already imported — no import change needed.
- Destructured `resetWatermark` from `useMailboxMutations()`.
- Replaced inline `<MailboxRow>` call with expanded form passing `resetting={resetWatermark.isPending}` and `onReset` callback that chains `resetWatermark.mutate → sync.mutate` with the three toast outcomes specified.
- Extended `MailboxRow` props type with `onReset: (id: string) => void` and `resetting: boolean`.
- Added "Reprocess all" button immediately before the existing "Remove" button, with confirm dialog, disabled state, and "Resetting…" label while in flight.

## Diff

```diff
diff --git a/apps/web/src/lib/mailbox-queries.ts b/apps/web/src/lib/mailbox-queries.ts
index 13d8813..64f43b4 100644
--- a/apps/web/src/lib/mailbox-queries.ts
+++ b/apps/web/src/lib/mailbox-queries.ts
@@ -4,6 +4,7 @@ import {
   MailboxAccountSchema,
   MailboxCredentialsStatusSchema,
   QueueSyncResultSchema,
+  SYNC_WINDOW_MINUTES,
 } from "@compass/shared";
 import { apiDelete, apiGet, apiPost } from "./api.ts";
 
@@ -50,5 +51,10 @@ export function useMailboxMutations() {
       ),
   });
 
-  return { add, remove, sync };
+  const resetWatermark = useMutation({
+    mutationFn: (id: string) =>
+      apiPost(`/api/mailboxes/${id}/reset-watermark`, z.object({ ok: z.literal(true) })),
+  });
+
+  return { add, remove, sync, resetWatermark };
 }
diff --git a/apps/web/src/routes/settings/MailboxesPanel.tsx b/apps/web/src/routes/settings/MailboxesPanel.tsx
index 67445c1..0037067 100644
--- a/apps/web/src/routes/settings/MailboxesPanel.tsx
+++ b/apps/web/src/routes/settings/MailboxesPanel.tsx
@@ -26,7 +26,7 @@ function fmtWhen(iso: string | null): string {
 export function MailboxesPanel() {
   const { data: mailboxes } = useMailboxes();
   const { data: creds } = useMailboxCredentials();
-  const { add, remove, sync } = useMailboxMutations();
+  const { add, remove, sync, resetWatermark } = useMailboxMutations();
   const [bundle, setBundle] = useState("");
   const [windowMinutes, setWindowMinutes] = useState<number>(SYNC_WINDOW_MINUTES[0]);
 
@@ -128,7 +128,25 @@ export function MailboxesPanel() {
 
       <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
         {mailboxes?.map((mb) => (
-          <MailboxRow key={mb.id} mailbox={mb} onRemove={(id) => remove.mutate(id)} />
+          <MailboxRow
+            key={mb.id}
+            mailbox={mb}
+            onRemove={(id) => remove.mutate(id)}
+            resetting={resetWatermark.isPending}
+            onReset={(id) =>
+              resetWatermark.mutate(id, {
+                onSuccess: () =>
+                  sync.mutate(SYNC_WINDOW_MINUTES[0], {
+                    onSuccess: (res) =>
+                      toast(`Watermark reset — sync queued (within ${res.runsInMinutes} min)`, "success"),
+                    onError: () =>
+                      toast("Watermark reset, but couldn't queue sync — use the Queue sync button"),
+                  }),
+                onError: (e) =>
+                  toast(e instanceof Error ? e.message : "Couldn't reset watermark"),
+              })
+            }
+          />
         ))}
       </ul>
     </div>
@@ -138,9 +156,13 @@ export function MailboxesPanel() {
 function MailboxRow({
   mailbox: mb,
   onRemove,
+  onReset,
+  resetting,
 }: {
   mailbox: MailboxAccount;
   onRemove: (id: string) => void;
+  onReset: (id: string) => void;
+  resetting: boolean;
 }) {
   return (
     <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
@@ -150,6 +172,17 @@ function MailboxRow({
       <span className="font-medium text-slate-800">{mb.emailAddress}</span>
       <span className="text-xs text-slate-400">{mb.folder}</span>
       <span className="ml-auto text-xs text-slate-400">last sync {fmtWhen(mb.lastSyncedAt)}</span>
+      <button
+        type="button"
+        disabled={resetting}
+        className="text-xs text-amber-600 underline disabled:opacity-50"
+        onClick={() => {
+          if (confirm(`Reset ${mb.emailAddress} and queue a sync to reprocess its available mail?`))
+            onReset(mb.id);
+        }}
+      >
+        {resetting ? "Resetting…" : "Reprocess all"}
+      </button>
       <button
         className="text-xs text-red-500 underline"
         onClick={() => {
```

## Typecheck Output

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

EXIT_CODE: 0
```

## Deviations

- The delegation's step "Add `SYNC_WINDOW_MINUTES` to the import from `@compass/shared`" for `mailbox-queries.ts` was followed literally, even though `SYNC_WINDOW_MINUTES` is unused in that file. No typecheck error results because `noUnusedLocals` is not set in any tsconfig.
- The delegation's step 1 for `MailboxesPanel.tsx` ("Add `SYNC_WINDOW_MINUTES` to the import") was a no-op: it was already present on line 2 of the original file. No change made to that import line.
- "Reprocess all" button was placed immediately **before** the "Remove" button (delegation said "before (or after)").

## Assumptions
- No backend route for `/api/mailboxes/:id/reset-watermark` is implemented yet; that is out of scope per the brief.
