## High

No high-severity findings.

## Medium

### Blocking — successful abandon displays an error toast

[CartPage.tsx:185](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:185) calls:

```ts
toast("Draft abandoned")
```

The toast helper defaults to `"error"` at [toast.tsx:15](/work/personal/compass/apps/web/src/lib/toast.tsx:15). A successful abandon therefore appears as a red error notification. Pass `"success"` explicitly, as generate and accept already do.

This was missed by both verification reports and is separate from F4: duplicate `onError` callbacks are correctly removed.

## Low

### Non-blocking — F8 has no automated regression coverage

The F8 behavior is implemented at [CartPage.tsx:450](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:450) and [CartPage.tsx:466](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:466), but `cart-view.test.ts` contains no tests for:

- empty, fractional, non-numeric, zero, or negative quantities;
- restoration of the persisted quantity/unit pair;
- prop-driven resynchronization;
- ensuring invalid values do not invoke the mutation.

The current 342-test web suite would still pass if `Number.isInteger` were replaced by the old truncating `parseInt` behavior. This is non-blocking because UI-test limitations were already accepted, although the validation could be extracted into the existing pure `cart-view.ts` seam and tested without a React renderer.

### Non-blocking — in-scope files do not satisfy repository formatting convention

`npx prettier --check` reports formatting issues in six reviewed files:

- `CartPage.tsx`
- `cart-view.ts`
- `cart-view.test.ts`
- `cart-drafts.ts`
- `shopping-queries.ts`
- `AppLayout.tsx`

Lint still passes, but AGENTS.md explicitly requires repository Prettier formatting.

## F1–F8 verification

- **F1:** Pass. The guard banner uses `totalPaise > 0 || unpricedCount > 0`, and the warning is independently rendered.
- **F2:** Pass. “Inactive” requires `sourcesStatus.isSuccess`; loading and error states are shown.
- **F3:** Pass. Accept and abandon use user-scoped conditional updates with `status = "draft"`, `RETURNING`, and 409 on zero rows.
- **F4:** Pass. Generate, accept, and abandon have no local `onError` callbacks.
- **F5:** Pass. Missing and null source IDs resolve to the single `null` group.
- **F6:** Pass. Null quantity displays “Qty not set”; Edit writes `1`/`piece` together.
- **F7:** Pass. Edit claims the draft inside the existing transaction with `UPDATE … status='draft' RETURNING`; zero rows returns 400. Item lookup and writes occur afterward in the same transaction.
- **F8:** Behavior passes source inspection. Props resynchronize local fields; empty, non-numeric, fractional, zero, and negative values restore the persisted pair without mutation. Remove/undo sends persisted values. Coverage remains missing as noted above.

## Verification run

- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run test -w apps/web` — 342 passed
- Hermetic cart-draft tests — 9 passed
- `npm run build -w apps/web` — passed
- `npx prettier --check …` — failed for six files

Previously accepted deferrals—dialog focus trapping, broader UI tests, hermetic SQL-predicate observation, selector/skeleton/brand details, and the full database-backed API suite—were not treated as new blockers.