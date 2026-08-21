# Implementation Report — Task 9.2 Iteration 2 (Expand Test Matrix)

## Summary

Added the full test matrix specified in DELEGATION.md "Iteration 2 — expand the test matrix".
Only test files were modified. No production/non-test file was touched in this iteration.

---

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `packages/shared/src/schemas/shopping.test.ts` | Modified | Added 12 deepEqual round-trip tests for all 6 new CRUD schemas |
| `apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` | Modified | Added ownership-guard bite tests (6 tests) + per-route schema-presence assertions (1 test) |
| `apps/api/src/modules/shopping/routes/lists.route.test.ts` | Modified | Added 13 new DB-gated integration test cases (items 1–13 per delegation) |

---

## Files Inspected (read-only)

- `tasks/064-shopping-lists-crud/DELEGATION.md` — authoritative spec
- `tasks/064-shopping-lists-crud/TASK.md` — design decisions and AC
- `apps/api/src/modules/shopping/routes/lists.route.test.ts` — existing harness
- `apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` — existing hermetic style
- `apps/api/src/modules/shopping/services/lists.ts` — production services under test
- `apps/api/src/modules/shopping/services/ownership.ts` — ownership guards under test
- `apps/api/src/modules/shopping/routes/lists.ts` — route schemas
- `apps/api/src/modules/shopping/schema.ts` — table types for direct inserts
- `apps/api/src/db/index.ts` — `Db`/`DbOrTx` type shapes
- `packages/shared/src/schemas/shopping.ts` — schema definitions
- `packages/shared/src/schemas/shopping.test.ts` — existing deepEqual convention
- `apps/api/src/lib/errors.ts` — `HttpError` class
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` — `makeGate` concurrency pattern
- `packages/shared/src/schemas/user-tasks.test.ts` — deepEqual convention reference

---

## Implementation Details

### packages/shared/src/schemas/shopping.test.ts

Added 12 deepEqual round-trip tests at the end of the file (before the `.extend` probe section):

1. `CreateShoppingListSchema deepEqual: name+note round-trip`
2. `CreateShoppingListSchema deepEqual: name only, note defaults to null`
3. `UpdateShoppingListSchema deepEqual: full replace round-trip (archived)`
4. `UpdateShoppingListSchema deepEqual: note null, status active round-trip`
5. `CreateShoppingListItemSchema deepEqual: rawText only — all optionals default to null`
6. `CreateShoppingListItemSchema deepEqual: rawText + quantity + unit round-trip`
7. `UpdateShoppingListItemSchema deepEqual: full replace with all fields set round-trip`
8. `UpdateShoppingListItemSchema deepEqual: all nullable fields null round-trip`
9. `ReorderItemsSchema deepEqual: two-uuid list round-trip`
10. `ReorderItemsSchema deepEqual: empty list round-trip`
11. `ShoppingListWithItemsSchema deepEqual: list with zero items round-trip`
12. `ShoppingListWithItemsSchema deepEqual: list with one item round-trip`

Each test calls `Schema.parse(input)` and `assert.deepEqual(parsed, expectedObject)`.
Note: `z.coerce.date()` fields in `ShoppingListWithItemsSchema` are compared as `new Date(ISO_STRING)`.

### apps/api/src/modules/shopping/routes/lists.hermetic.test.ts

**New imports** added at top:
```typescript
import { assertOwnedList, assertOwnedCatalogItem, assertOwnedListItem } from "../services/ownership.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { DbOrTx } from "../../../db/index.ts";
```

**New helpers** added after existing stubs:
- `emptyDb()` — fake `DbOrTx` where all `query.*.findFirst` return `undefined`
- `rowDb(overrides)` — fake `DbOrTx` that returns provided row objects

**New test constants:**
```typescript
const FAKE_USER_ID = "00000000-0000-4000-a000-000000000010";
const FAKE_LIST_ID = "00000000-0000-4000-a000-000000000011";
const FAKE_ITEM_ID = "00000000-0000-4000-a000-000000000012";
const FAKE_CATALOG_ID = "00000000-0000-4000-a000-000000000013";
```

**6 ownership-guard bite tests:**
1. `assertOwnedList: throws HttpError(404) when list row is not found`
2. `assertOwnedCatalogItem: throws HttpError(404) when catalogItemId is non-null and row not found`
3. `assertOwnedCatalogItem: null catalogItemId is a no-op — does not throw and does not query`
4. `assertOwnedCatalogItem: undefined catalogItemId is a no-op — does not throw and does not query`
5. `assertOwnedListItem: throws HttpError(404) when list row is not found`
6. `assertOwnedListItem: throws HttpError(404) when list exists but item row is not found`

**1 schema-presence test:**
`each route has the expected body/params/querystring/response schemas attached` — collects route schemas via `onRoute` hook, then asserts:
- Routes with bodies (POST /lists, PUT /lists/:id, POST /lists/:id/items, PUT reorder, PUT item) have `schema.body != null` and `schema.response != null`
- Routes with params (all 7 non-collection routes) have `schema.params != null`
- `GET /lists` has `schema.querystring != null` and `schema.response != null`
- All non-HEAD routes have `schema.response != null`

### apps/api/src/modules/shopping/routes/lists.route.test.ts

**New imports:**
```typescript
import { eq } from "drizzle-orm";                           // already existed
import { catalogItems, shoppingListItems, shoppingLists } from "../schema.ts";  // new
import { addItem, reorderItems, deleteItem } from "../services/lists.ts";       // new (for concurrency test)
```

**13 new DB-gated integration tests added:**

1. **Item 1 (ADD catalog ownership):** `catalog ownership on ADD item — valid / cross-owner / nonexistent / null-unlink`
   - (a) owned catalogItemId → 200, item linked; (b) other user's → 404, no item created (re-query); (c) nonexistent → 404, no write; (d) null → 200, catalogItemId=null

2. **Item 1 (UPDATE catalog ownership):** `catalog ownership on UPDATE item — valid / cross-owner / nonexistent / null-unlink`
   - Same four cases for PUT items endpoint; all "no write" cases re-query to confirm item unchanged

3. **Item 2:** `item UPDATE one-sided quantity/unit → 400, item unchanged`
   - quantityBase=500, unit=null → 400; re-query confirms item still has quantityBase=null, unit=null

4. **Item 3a:** `reorder: positions set to 0..n-1 in the new order`
   - After reordering 3 items as [C, A, B], asserts `items[0].position===0`, `items[1].position===1`, `items[2].position===2`

5. **Item 3b+3c:** `reorder: equal-cardinality with one foreign id → 404 and all positions unchanged`
   - 2-item list, send 2 ids where second is `randomUUID()` (foreign) → 404; capture positions before, assert equal after

6. **Item 3d:** `reorder: empty orderedIds on non-empty list → 400, positions unchanged`
   - Single-item list, send `orderedIds:[]` → 400; assert position unchanged

7. **Item 4 (Concurrency):** `concurrency: parent row FOR UPDATE lock serializes add, reorder, and delete`
   - `proveBlocks()` helper: acquires `BEGIN; SELECT ... FOR UPDATE` on a raw `app.pg` pool client, starts the service op, waits 200ms and asserts not-yet-resolved, then COMMITs and awaits completion.
   - Sub-test 1: `addItem` vs external lock — proves add is blocked then completes
   - Sub-test 2: `reorderItems` vs external lock — proves reorder is blocked then completes
   - Sub-test 3: `deleteItem` vs external lock — proves delete is blocked then completes
   - **Timing note:** The 200ms bounded wait is a timing assumption; on extremely loaded machines it could be flaky. This is documented in the test.

8. **Item 5:** `demo session rejected on every shopping mutation route → 403`
   - Tests all 7 mutation routes (POST /lists, PUT /lists/:id, DELETE /lists/:id, POST items, PUT item, DELETE item, PUT reorder) with a demo session → all 403

9. **Item 6a:** `list ordering: status ASC, updatedAt DESC, id ASC`
   - Direct-inserts 3 lists with controlled `updatedAt` values; asserts GET /lists returns them in expected order

10. **Item 6b:** `item ordering with duplicate positions: position ASC, id ASC`
    - Direct-inserts items with explicit UUIDs at same position 0; asserts lower UUID comes first

11. **Item 7:** `delete item leaves position gaps — remaining positions are NOT compacted`
    - 3 items at positions 0,1,2; delete middle; asserts remaining items have positions 0 and 2 (not 0 and 1)

12. **Item 8:** `GET /lists default returns both active and archived lists`
    - Creates one active, one archived; default GET returns both; `?status=active` excludes archived; `?status=archived` excludes active

13. **Item 9:** `archived list is readable, mutable, and can be un-archived via status:active`
    - Archive a list; GET → 200; PUT rename → 200; POST items → 200; PUT item → 200; PUT with status:active → 200 and status=active

14. **Item 10:** `cross-owner operations on list and items → 404 and no write`
    - User B tries UPDATE/DELETE list, ADD item, REORDER, UPDATE item, DELETE item on user A's list → all 404; re-query as A confirms unchanged

15. **Item 11:** `DELETE /lists/:id removes all child items from shoppingListItems (DB cascade verified)`
    - After route DELETE, directly queries `shoppingListItems` by listId → asserts 0 rows

16. **Item 12:** `updatedAt is bumped after item add, item update, item delete, and list PUT`
    - Chains 4 write operations with 5ms waits; asserts each operation's returned `updatedAt` >= previous

17. **Item 13:** `raw-text-only item (no catalogItemId, no quantity, no unit) persists via POST items`
    - POST with only rawText; asserts 200, catalogItemId=null, quantityBase=null, unit=null; re-queries to confirm persistence

---

## Commands Run — Literal Output

### Command 1: `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

[... all workspaces pass ...]

> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

### Command 2: `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

### Command 3: `npm run test -w packages/shared`

```
> @compass/shared@0.1.0 test
> node --test "src/**/*.test.ts"

[... all existing tests pass ...]

✔ CreateShoppingListSchema deepEqual: name+note round-trip (1.077039ms)
✔ CreateShoppingListSchema deepEqual: name only, note defaults to null (0.191638ms)
✔ UpdateShoppingListSchema deepEqual: full replace round-trip (archived) (0.186371ms)
✔ UpdateShoppingListSchema deepEqual: note null, status active round-trip (0.150024ms)
✔ CreateShoppingListItemSchema deepEqual: rawText only — all optionals default to null (0.172134ms)
✔ CreateShoppingListItemSchema deepEqual: rawText + quantity + unit round-trip (0.172979ms)
✔ UpdateShoppingListItemSchema deepEqual: full replace with all fields set round-trip (0.18672ms)
✔ UpdateShoppingListItemSchema deepEqual: all nullable fields null round-trip (0.168804ms)
✔ ReorderItemsSchema deepEqual: two-uuid list round-trip (0.213885ms)
✔ ReorderItemsSchema deepEqual: empty list round-trip (0.182658ms)
✔ ShoppingListWithItemsSchema deepEqual: list with zero items round-trip (0.198929ms)
✔ ShoppingListWithItemsSchema deepEqual: list with one item round-trip (0.398025ms)
✔ CatalogItemSchema is composable via .extend(): a refined schema with an extra field parses and rejects correctly (1.129697ms)

ℹ tests 259
ℹ suites 0
ℹ pass 259
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 395.836661
EXIT:0
```

### Command 4: `node --test --experimental-test-module-mocks apps/api/src/modules/shopping/routes/lists.hermetic.test.ts`

```
(node:1990108) ExperimentalWarning: Module mocking is an experimental feature and might change at any time

✔ all shopping-list mutation routes are not marked public (125.785991ms)
✔ all nine expected shopping-list routes are registered (5.303163ms)
✔ assertOwnedList: throws HttpError(404) when list row is not found (1.335901ms)
✔ assertOwnedCatalogItem: throws HttpError(404) when catalogItemId is non-null and row not found (0.490121ms)
✔ assertOwnedCatalogItem: null catalogItemId is a no-op — does not throw and does not query (0.19866ms)
✔ assertOwnedCatalogItem: undefined catalogItemId is a no-op — does not throw and does not query (0.162465ms)
✔ assertOwnedListItem: throws HttpError(404) when list row is not found (0.524481ms)
✔ assertOwnedListItem: throws HttpError(404) when list exists but item row is not found (0.635829ms)
✔ each route has the expected body/params/querystring/response schemas attached (6.257031ms)

ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1066.823046
EXIT:0
```

### Command 5: DB-gated integration suite (attempted)

`DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET` are NOT set locally (no `.env` file found in `apps/api/`, no exported env vars in shell). Running the file fails immediately with:

```
Error: lists.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (file:///home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:34:11)
    at file:///home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:40:1
    ...

ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
```

This is the established convention (matches `modules/protection/routes/protection.route.test.ts`). CI provides `DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET` — see `.github/workflows/ci.yml`. All 13 new integration test cases are authored and will execute in CI.

### Command 6: `git status --porcelain=v1` and `git diff`

**`git status --porcelain=v1`:**
```
M apps/api/src/modules/shopping/plugin.ts          (iteration 1)
 M apps/api/src/route-surface.snapshot.txt          (iteration 1)
 M apps/api/src/route-table.snapshot.txt            (iteration 1)
 M packages/shared/src/schemas/shopping.test.ts     (iteration 1 + 2 — test file)
 M packages/shared/src/schemas/shopping.ts          (iteration 1)
 M tasks/09.01-shopping-schema.md                   (iteration 1)
 M tasks/09.02-lists-crud.md                        (iteration 1)
 M tasks/README.md                                  (iteration 1)
?? apps/api/src/modules/shopping/routes/lists.hermetic.test.ts   (test file — new in iter 1, extended in iter 2)
?? apps/api/src/modules/shopping/routes/lists.route.test.ts      (test file — new in iter 1, extended in iter 2)
?? apps/api/src/modules/shopping/routes/lists.ts                 (iteration 1)
?? apps/api/src/modules/shopping/services/lists.ts               (iteration 1)
?? apps/api/src/modules/shopping/services/ownership.ts           (iteration 1)
?? screen-shots/                                                  (pre-existing, not ours)
?? tasks/063-shopping-schema/...                                  (pre-existing)
?? tasks/064-shopping-lists-crud/                                 (our task folder)
```

**Confirmation: Only test files were modified in iteration 2.**
The production-file modifications (`plugin.ts`, `shopping.ts`, snapshots, `lists.ts`, `ownership.ts`) were all from iteration 1 and were already in the working tree before this iteration began.

---

## Assumptions

1. The `app.pg` type (`pg.Pool`) is accessible from `app.pg.connect()` in tests via the `declare module "fastify"` augmentation in `app.ts` — cast as `unknown` to avoid TypeScript overload narrowing issues.
2. The 200ms bounded wait in the concurrency tests is sufficient to detect blocking on a normally loaded development machine. This is noted in the test with a documentation comment.
3. `catalogItems` inserts in the catalog ownership tests use `randomUUID()` in `canonicalName` to avoid the unique index `(userId, canonicalName)`.
4. Direct `shoppingListItems` inserts in the item-ordering test use deterministic UUID strings (`10000000-...`, `20000000-...`) to control lexicographic sort order.
5. The `updatedAt` bump test uses 5ms sleeps; if the DB clock resolution is coarser than 5ms, the `>=` assertion (not strict `>`) will still pass.

---

## Unresolved Risks

1. **Concurrency test timing (item 4):** The 200ms bounded-wait proof is not perfectly deterministic. On a heavily loaded CI machine, the `addItem`/`reorderItems`/`deleteItem` transaction might take >200ms just to START (acquire a pool connection and begin the tx), making the assertion `opResolved === false` vacuously true even if the FOR UPDATE isn't actually blocking. This is an inherent limitation of timing-based lock tests without instrumenting the production code. The test correctly proves that when the lock IS held, the competing op completes after COMMIT; the 200ms assertion provides evidence but is not a hard guarantee.

2. **Item 6b (item ordering with duplicate positions):** Direct inserts bypass the `addItem` service and the parent-row lock. The test correctly proves the DB `ORDER BY position ASC, id ASC` ordering but does not test the service path for creating duplicate positions (which is not a supported operation anyway).
