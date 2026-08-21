# Implementation 2 — Task 9.3 Iteration 2 (post code-review-3 fixes)

Branch: `feat/shopping-core-capture`

## Files Inspected

- `/work/personal/compass/packages/shared/src/money.ts`
- `/work/personal/compass/packages/shared/src/money.test.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/routes/catalog.route.test.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts`
- `/work/personal/compass/packages/shared/src/schemas/shopping.ts`
- `/work/personal/compass/tasks/066-catalog-canonicalization/DELEGATION.md`

## Files Changed

- `packages/shared/src/money.ts` — added runtime `displayUnit` guard to `convertToBaseQuantity`
- `packages/shared/src/money.test.ts` — added test for invalid `displayUnit`
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts` — strengthened no-write and AC4 assertions

## Implementation Details

### Fix 1: Runtime `displayUnit` guard in `convertToBaseQuantity` (`money.ts`)

Added as the FIRST guard in the function body (before the quantity format check), mirroring `unitPricePaise`'s unit-guard style (`if (x !== "a" && x !== "b" ...) throw new RangeError(...)`):

```diff
export function convertToBaseQuantity(
   quantity: string,
   displayUnit: "kg" | "g" | "litre" | "ml" | "piece",
 ): { quantityBase: number; unit: "g" | "ml" | "piece" } {
+  if (
+    displayUnit !== "kg" &&
+    displayUnit !== "g" &&
+    displayUnit !== "litre" &&
+    displayUnit !== "ml" &&
+    displayUnit !== "piece"
+  ) {
+    throw new RangeError("displayUnit must be one of kg, g, litre, ml, or piece");
+  }
   if (!/^\d+(\.\d+)?$/.test(quantity)) {
```

### Fix 1 cont.: Test case in `money.test.ts`

Added after the existing `"invalid format"` guard test:

```diff
+test("convertToBaseQuantity: invalid displayUnit → RangeError", () => {
+  assert.throws(() => convertToBaseQuantity("1", "lb" as never), RangeError);
+  assert.throws(() => convertToBaseQuantity("1", "oz" as never), RangeError);
+  assert.throws(() => convertToBaseQuantity("1", "" as never), RangeError);
+});
```

### Fix 2: Strengthen no-write assertions (`catalog.route.test.ts`)

**`none` case** — after existing item-updatedAt check, added GET list + assert list.updatedAt unchanged:

```diff
+  const listAfterNone = JSON.parse(
+    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
+  ) as { updatedAt: string };
+  assert.equal(listAfterNone.updatedAt, beforeListUpdatedAt, "list updatedAt unchanged on none");
```

**`ambiguous` case** — added `updatedAt: string` to item2's type assertion, captured `beforeItem2UpdatedAt`, then after existing assertions:

```diff
-  const item2 = (JSON.parse(addRes2.body) as { items: Array<{ id: string; catalogItemId: string | null }> })
+  const item2 = (JSON.parse(addRes2.body) as { items: Array<{ id: string; catalogItemId: string | null; updatedAt: string }> })
       .items.at(-1)!;
+  const beforeItem2UpdatedAt = item2.updatedAt;
   ...
+  assert.equal(ambigResult.item.updatedAt, beforeItem2UpdatedAt, "item2 updatedAt unchanged on ambiguous");
+  const listAfterAmbig = JSON.parse(
+    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
+  ) as { updatedAt: string };
+  assert.equal(listAfterAmbig.updatedAt, listAfter.updatedAt, "list updatedAt unchanged on ambiguous");
```

The baseline for the ambiguous list-updatedAt check uses `listAfter.updatedAt` (captured right after the `matched` call bumped it), which was already in scope.

### Fix 3: AC4 "never creates" `catalog_items` count assertions (`catalog.route.test.ts`)

**Match test**: Captured `matchCountBefore` after all seeding, before any match calls. After each match call's existing assertions, added:

```typescript
assert.equal(
  (await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))).length,
  matchCountBefore,
  "GET /catalog/match must not create catalog_items rows (matched/ambiguous/none case)",
);
```

(Three separate assertions — matched, ambiguous, none — each with its own message.)

**Canonicalize test**: Added count captures before each canonicalize call (`noneCountBefore`, `matchedCountBefore`, `ambigCountBefore`) and count assertions after each, one per case.

## Commands Run and Literal Output

### `npm run typecheck`

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

EXIT:0
```

### `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

### `npm run test -w packages/shared`

```
> @compass/shared@0.1.0 test
> node --test "src/**/*.test.ts"

[... 311 tests, all green ...]
✔ convertToBaseQuantity: invalid displayUnit → RangeError (0.105892ms)
[...]
ℹ tests 311
ℹ suites 0
ℹ pass 311
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 307.942145
EXIT:0
```

The new test `"convertToBaseQuantity: invalid displayUnit → RangeError"` passed (total went from 310 to 311).

### `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts`

```
(node:53121) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
✔ all catalog mutation routes are not marked public (62.348339ms)
✔ all 7 expected catalog routes are registered (2.344208ms)
✔ GET /catalog/match is registered before GET /catalog/:id (static before param) (1.961789ms)
✔ each catalog route has the expected body/params/querystring/response schemas (2.036772ms)
✔ unauthenticated request to GET /catalog → 401 (session guard bites) (7.56056ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 273.547332
EXIT:0
```

### `git status --porcelain`

```
M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M packages/shared/src/money.ts
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
 M tasks/064-shopping-lists-crud/TASK.md
 M tasks/09.02-lists-crud.md
 M tasks/README.md
?? apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/catalog.route.test.ts
?? apps/api/src/modules/shopping/routes/catalog.ts
?? apps/api/src/modules/shopping/services/canonicalize.ts
?? packages/shared/src/money.test.ts
?? tasks/065-test-ci-agents/
?? tasks/066-catalog-canonicalization/
?? tasks/067-paste-text-capture/
EXIT:0
```

The files changed in this iteration (all untracked or previously modified from iteration 1):
- `packages/shared/src/money.ts` (`M` — pre-existing modifications from iteration 1, now with guard added)
- `packages/shared/src/money.test.ts` (`??` — new file from iteration 1, new test case added)
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts` (`??` — new file from iteration 1, strengthened assertions added)

## DB-gated test note

`catalog.route.test.ts` is DB-gated. Running it locally without `DATABASE_URL` throws:
```
Error: catalog.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
```
This is expected; it runs in CI with real DB/Redis.

## Assumptions

- The `ambiguous` canonicalize test uses `listAfter.updatedAt` (captured right after the `matched` call) as the baseline for the post-ambiguous list updatedAt check. This is the correct baseline since the list was last mutated by the `matched` call and should not change again after the `ambiguous` call.
- `item2.updatedAt` is present in the JSON response from `POST /lists/:id/items` (it is — `ShoppingListItemSchema` includes `updatedAt: z.coerce.date()` and the route returns `ShoppingListWithItemsSchema`).
- `ambigResult.item.updatedAt` is present in the canonicalize response (it is — `CanonicalizeItemResponseSchema.item` is `ShoppingListItemSchema` which includes `updatedAt`).

## Unresolved Risks

None. All three fixes apply cleanly; typecheck, lint, and shared tests are green; hermetic test is green; the DB-gated integration test will be verified in CI.
