## High

None.

## Medium

None.

## Low

None.

F9 is verified: `handleAbandon` calls `toast("Draft abandoned", "success")` in [CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:183). The toast helper maps `"success"` to the emerald success presentation in [toast.tsx](/work/personal/compass/apps/web/src/lib/toast.tsx:15).

F1–F8 remain present:

- F1: all-unpriced disclosure renders independently of a positive total.
- F2: inactive status is shown only after source loading succeeds.
- F3/F7: accept, abandon, and edit use conditional `status = "draft"` updates with `RETURNING`.
- F4: cart mutations have no local `onError` handlers duplicating the global handler.
- F5: unresolved source IDs consolidate into one unknown-source group.
- F6: null quantities use the “Qty not set” initialization path.
- F8: editor state resynchronizes from props and rejects/restores invalid, empty, fractional, or non-positive quantities.

Verification:

- Typecheck: passed.
- Web tests: 342 passed, 0 failed.
- Web build: passed.
- Cart-draft hermetic tests: 9 passed, 0 failed.
- Repository-wide lint currently fails on an unused `sql` import in the unrelated, untracked `apps/api/src/modules/shopping/routes/receipts.ts`. This is outside task 083 and was not introduced by F9.

Verdict: no blocking or non-blocking task-083 defects found; F9 is correctly fixed.