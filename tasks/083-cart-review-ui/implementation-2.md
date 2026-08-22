Implemented F1–F6.

Files modified:

- `apps/web/src/routes/shopping/CartPage.tsx`
- `apps/web/src/routes/shopping/cart-view.ts`
- `apps/web/src/routes/shopping/cart-view.test.ts`
- `apps/api/src/modules/shopping/routes/cart-drafts.ts`
- `apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts` — required fixture update for the new `returning()` chain and 409 responses.

Changes:

- F1: unpriced-item warning renders even when the priced total is zero.
- F2: source headers only show `Inactive` after source data succeeds; show loading/unavailable text for unresolved suggested sources.
- F3: accept and abandon writes now condition on `status = "draft"`, use `returning`, and return 409 on a race/lost conditional update.
- F4: removed per-call mutation error toasts for generate, accept, and abandon.
- F5: unknown and null source IDs consolidate into one `Unknown source` group; added regression coverage.
- F6: items without quantity/unit show `Qty not set` and an `Edit` action that initializes both fields to `1`/`piece`; remove/undo preserves null pairs.

Verification:

```text
$ npm run typecheck
exit 0

> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit
...
> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

```text
$ npm run lint
exit 0

> compass@0.1.0 lint
> eslint .
```

```text
$ npm run test -w apps/web
exit 0

ℹ tests 342
ℹ suites 16
ℹ pass 342
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
$ node --env-file-if-exists=../../.env --experimental-test-module-mocks --test src/modules/shopping/routes/cart-drafts.hermetic.test.ts
exit 0

✔ POST /drafts/:id/accept with status=draft → 200
✔ POST /drafts/:id/accept with status=abandoned → 409
✔ POST /drafts/:id/accept with status=ordered → 409
✔ PUT /drafts/:id/items/:itemId with status=ordered → 400
✔ PUT /drafts/:id/items/:itemId with status=abandoned → 400
✔ DELETE /drafts/:id with status=ordered → 409
✔ DELETE /drafts/:id with status=abandoned → 409 (cannot abandon already-abandoned)
✔ DELETE /drafts/:id with status=draft → 204
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

```text
$ npm run test -w apps/api
exit 1

../../.env not found. Continuing without it.
Error: app.test.ts needs DATABASE_URL set ...
ℹ tests 1056
ℹ pass 1016
ℹ fail 39
ℹ skipped 1
```

The API suite is blocked by the absent `DATABASE_URL`; before the fixture update it also surfaced six task-local failures caused by the missing mocked `returning()` method. Those are now resolved by the passing 8-test cart-draft suite.

```text
$ npm run build -w apps/web
exit 0

vite v8.2.1 building client environment for production...
✓ 357 modules transformed.
✓ built in 167ms
```

```text
$ git diff --check
exit 2

tasks/075-reward-aware-checkout/review-3.md:3: trailing whitespace.
```

This whitespace issue is pre-existing and unrelated to this task. No cart-review file has whitespace errors.