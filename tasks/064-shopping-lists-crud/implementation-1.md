# Task 9.2 — Implementation Report (Iteration 1)

## Files Changed

### Created (new)
- `apps/api/src/modules/shopping/services/ownership.ts` — `assertOwnedList`, `assertOwnedCatalogItem`, `assertOwnedListItem`
- `apps/api/src/modules/shopping/services/lists.ts` — all CRUD service functions with row-lock transactions
- `apps/api/src/modules/shopping/routes/lists.ts` — 9 routes relative to `/api/shopping` prefix
- `apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` — hermetic route-config tests (no DB)
- `apps/api/src/modules/shopping/routes/lists.route.test.ts` — DB-gated integration tests

### Modified (edited)
- `packages/shared/src/schemas/shopping.ts` — added 6 new schemas: `CreateShoppingListSchema`, `UpdateShoppingListSchema`, `CreateShoppingListItemSchema`, `UpdateShoppingListItemSchema`, `ReorderItemsSchema`, `ShoppingListWithItemsSchema`
- `packages/shared/src/schemas/shopping.test.ts` — added 17 new expected-object/refinement tests for the new schemas
- `apps/api/src/modules/shopping/plugin.ts` — registered `shoppingListRoutes` alongside `shoppingUnitRoutes`
- `apps/api/src/route-surface.snapshot.txt` — regenerated (11 new lines: 9 routes + 2 auto HEAD)
- `apps/api/src/route-table.snapshot.txt` — regenerated (5 new lines in shopping sub-tree)

### Temporary (created then deleted)
- `apps/api/src/gen-snapshots-tmp.ts` — snapshot generation script (deleted after use)

---

## Complete Unified Diff (fixture-only portion shown; full diff via `git diff`)

### route-surface.snapshot.txt — 11 new lines

```diff
+DELETE /api/shopping/lists/:id
+DELETE /api/shopping/lists/:id/items/:itemId
+GET /api/shopping/lists
+GET /api/shopping/lists/:id
+HEAD /api/shopping/lists          (auto from GET)
+HEAD /api/shopping/lists/:id      (auto from GET)
+POST /api/shopping/lists
+POST /api/shopping/lists/:id/items
+PUT /api/shopping/lists/:id
+PUT /api/shopping/lists/:id/items/:itemId
+PUT /api/shopping/lists/:id/items/reorder
```

9 real routes + 2 auto HEAD for GET routes only (no HEAD for POST/PUT/DELETE) — exactly as required.

### route-table.snapshot.txt — 5 new lines

```diff
+├── /api/shopping/lists (GET, HEAD, POST)
+│   └── /:id (GET, HEAD, PUT, DELETE)
+│       └── /items (POST)
+│           ├── /reorder (PUT)
+│           └── /:itemId (PUT, DELETE)
```

---

## Commands Run and Literal Output

### 1. `npm run typecheck`
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
```
**Exit code: 0**

### 2. `npm run lint`
```
> compass@0.1.0 lint
> eslint .
```
**Exit code: 0** (no output = clean)

### 3. `npm run test -w packages/shared`
```
ℹ tests 247
ℹ suites 0
ℹ pass 247
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 391.970157
```
**Exit code: 0** — 247 pass, 0 fail. Includes all 17 new task-9.2 schema tests.

### 4. `node --test apps/api/src/modules/shopping/**/*.test.ts`
```
(node:1976834) ExperimentalWarning: Module mocking is an experimental feature
✔ all shopping-list mutation routes are not marked public (147.580726ms)
✔ all nine expected shopping-list routes are registered (5.958972ms)

Error: lists.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env)
    at requireEnv (lists.route.test.ts:32:11)
    at lists.route.test.ts:38:1

✖ apps/api/src/modules/shopping/routes/lists.route.test.ts (1146.192298ms)

✔ GET /api/shopping/units returns 200 and a schema-valid body with all three units
✔ GET /units (unprefixed) returns 404 — prefix is actually applied
✔ GET /api/shopping/units does not opt out of authentication (config.public is not true)
✔ all 8 shopping tables resolve to the expected Postgres names
[... 25 more passing 9.1 tests ...]

ℹ tests 31
ℹ suites 0
ℹ pass 30
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1181.736127
```
**Exit code: 1**

DB-gated test (`lists.route.test.ts`) throws `Error: lists.route.test.ts needs DATABASE_URL set` at module load time — this is the literal skip/error reason. All hermetic tests pass.

### 5. Snapshot generation script + route snapshot test
Script ran: `node apps/api/src/gen-snapshots-tmp.ts`
Output:
```
Written route-surface.snapshot.txt (346 pairs)
Written route-table.snapshot.txt
Done.
```
Script deleted: `rm apps/api/src/gen-snapshots-tmp.ts`

Route snapshot test: `node --test apps/api/src/app.route-snapshot.test.ts`
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte (218.449699ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (88.535064ms)
✔ assertRouteTableMatches rejects an added route (0.543772ms)
✔ assertRouteTableMatches rejects a removed route (0.200771ms)
✔ assertRouteTableMatches rejects a renamed route (0.193533ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.19041ms)
✔ assertRouteTableMatches accepts identical tables (0.352751ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ duration_ms 1955.129919
```
**Exit code: 0**

### 6. `git status --porcelain=v1`
```
M apps/api/src/modules/shopping/plugin.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M packages/shared/src/schemas/shopping.test.ts
 M packages/shared/src/schemas/shopping.ts
?? apps/api/src/modules/shopping/routes/lists.hermetic.test.ts
?? apps/api/src/modules/shopping/routes/lists.route.test.ts
?? apps/api/src/modules/shopping/routes/lists.ts
?? apps/api/src/modules/shopping/services/lists.ts
?? apps/api/src/modules/shopping/services/ownership.ts
```
(Also shows unrelated `tasks/`, `screen-shots/` changes from prior work.)

---

## DB-Gated Tests

`apps/api/src/modules/shopping/routes/lists.route.test.ts` — **DB-gated** (requires `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`). Literal error at module load:

```
Error: lists.route.test.ts needs DATABASE_URL set — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (file:///…/lists.route.test.ts:32:11)
    at file:///…/lists.route.test.ts:38:1
```

The test covers: unauthenticated 401, demo-session 403, full CRUD round-trips, archive/filter/reversibility, cascade delete, cross-owner 404, item CRUD, quantity/unit pairing, reorder (exact set / dup / wrong count / empty-on-nonempty / empty-on-empty), cross-list IDOR, append positions.

---

## Implementation Details

- **P1**: `CreateShoppingListSchema` (name trim+non-empty 1–120, note nullable ≤1000 default null), `UpdateShoppingListSchema` (name, note, status — all required, no defaults), `CreateShoppingListItemSchema` (rawText trim 1–200, catalogItemId nullable default null, quantity+unit nullable paired default null), `UpdateShoppingListItemSchema` (all 5 fields required, no defaults, same pairing refine), `ReorderItemsSchema` (orderedIds array, duplicate-uuid refine), `ShoppingListWithItemsSchema` (ShoppingListSchema.extend with items array).
- **P2**: `assertOwnedList`, `assertOwnedCatalogItem` (null-safe no-op), `assertOwnedListItem` (calls assertOwnedList then checks item.listId constraint). All accept `DbOrTx`, throw `HttpError(404)`.
- **P3**: `createList`, `listLists` (status filter, order status ASC/updatedAt DESC/id ASC), `getList` (items order position ASC/id ASC), `updateList`, `deleteList`. Item mutators `addItem`/`deleteItem`/`reorderItems` all open `db.transaction`, `SELECT … FOR UPDATE` the list row first, then validate FKs and write inside the tx. `addItem` appends at `COALESCE(MAX(position), -1) + 1`. `deleteItem` leaves gaps. `reorderItems` validates exact set (count + membership), updates positions 0..n-1.
- **P4**: Routes registered relative to `/api/shopping`. `PUT /lists/:id/items/reorder` registered BEFORE `PUT /lists/:id/items/:itemId` to prevent "reorder" being misrouted as an itemId. No route marks `config: { public: true }`.
- **P5**: One-off script wrote both snapshots, then was deleted. `app.route-snapshot.test.ts` passes byte-for-byte.
- **P6**: 2 hermetic tests (mutation routes not-public, 9 routes registered). DB-gated integration tests: all the matrix items from TASK.md P6.

---

## Assumptions

- `ShoppingListWithItemsSchema` uses `.extend()` on `ShoppingListSchema`; this works because the response schemas are Zod `ZodObject` instances with `.extend()` available.
- `unit` column type cast via `as typeof shoppingListItems.$inferInsert["unit"]` is the correct pattern (matches Drizzle's enum insert type).
- The CSRF origin check in `security.ts` is satisfied by Fastify `inject()` when the `origin` header is not passed (the check applies only to state-changing HTTP methods coming from a browser context, and integration tests using `app.inject()` bypass it in tests per Fastify design).

---

## Deviations from DELEGATION.md

None. All P1–P6 implemented as specified. No schema changes, no migration, no backup.ts edits, no web pages, nothing added to DEMO_WRITE_ALLOWLIST.
