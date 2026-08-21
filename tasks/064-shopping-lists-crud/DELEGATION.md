# Sonnet Worker Delegation — Task 9.2 (Shopping lists CRUD + API)

## Task
9.2 — Shopping lists CRUD + API. Approved plan: `tasks/064-shopping-lists-crud/TASK.md` (read it in
full first — the Design decisions and Plan sections are binding). Board task: `tasks/09.02-lists-crud.md`.

## Iteration 1

## Approved Plan (summary — TASK.md is authoritative)
- P1 shared Zod contracts, P2 shopping ownership guards, P3 lists service (with row-lock ordering),
  P4 routes + plugin registration, P5 regenerate BOTH route-snapshot fixtures, P6 full test matrix.

## Files and Symbols
- CREATE `packages/shared/src/schemas/shopping.ts` additions:
  `CreateShoppingListSchema`, `UpdateShoppingListSchema`, `CreateShoppingListItemSchema`,
  `UpdateShoppingListItemSchema`, `ReorderItemsSchema`, `ShoppingListWithItemsSchema` (+ inferred
  types). Re-export from `packages/shared/src/index.ts` if that is the barrel convention (check how
  existing shopping schemas are exported).
- CREATE `apps/api/src/modules/shopping/services/ownership.ts`:
  `assertOwnedList(db: DbOrTx, userId, listId)`,
  `assertOwnedCatalogItem(db: DbOrTx, userId, catalogItemId: string|null|undefined)`,
  `assertOwnedListItem(db: DbOrTx, userId, listId, itemId)`. Mirror `apps/api/src/lib/ownership.ts`
  style (null-safe where a null FK is legal; `throw new HttpError(404, …)`). `assertOwnedListItem`
  must constrain BOTH `item.id` AND `item.listId`, and that the list belongs to `userId`.
- CREATE `apps/api/src/modules/shopping/services/lists.ts`: functions per P3, taking `(db: Db, userId,
  …)`. Model shape on `apps/api/src/modules/protection/services/insurance.ts` (row→contract mapper,
  `ownedX` helper, `HttpError`). Use `db.transaction(async (tx) => …)` for `addItem`/`deleteItem`/
  `reorderItems`; inside, first lock the list row with `.select().from(shoppingLists).where(and(eq(id),
  eq(userId))).for("update")` (pattern: `apps/api/src/modules/ledger/services/transfers.ts:122`), then
  read/validate/write. Pass `tx` to the ownership guards.
- CREATE `apps/api/src/modules/shopping/routes/lists.ts`: routes with paths RELATIVE to the
  `/api/shopping` prefix (see `routes/units.ts` and `plugin.ts`). `app.withTypeProvider<ZodTypeProvider>()`,
  Zod `body`/`params`/`response` schemas, `req.session!.userId`. No route sets `config: { public: true }`.
- EDIT `apps/api/src/modules/shopping/plugin.ts`: `await app.register(shoppingListRoutes);` alongside units.
- REGENERATE `apps/api/src/route-surface.snapshot.txt` and `apps/api/src/route-table.snapshot.txt` —
  see Commands step 5. Do NOT hand-edit fixtures.
- TESTS: colocated `*.test.ts` per P6 (shared schema tests in `packages/shared`, hermetic + integration
  in `apps/api/src/modules/shopping/`).

## Required Changes (binding specifics)
1. **Routes** (all relative to `/api/shopping`):
   `GET /lists`, `POST /lists`, `GET /lists/:id`, `PUT /lists/:id`, `DELETE /lists/:id`,
   `POST /lists/:id/items`, `PUT /lists/:id/items/:itemId`, `DELETE /lists/:id/items/:itemId`,
   `PUT /lists/:id/items/reorder`. Use `PUT` (full replace) for updates, NOT `PATCH`.
2. **Update schemas are STRICT full-object PUT**: every logical field REQUIRED including nullable ones
   (`note`, `catalogItemId`, `quantityBase`, `unit`); NO `.default()` on update fields. An omitted
   field must fail validation (400). Create schemas may default their optional fields.
3. **Quantity/unit pairing**: reuse the both-or-neither `.refine` from the existing entity schemas
   (`(v.quantityBase === null) === (v.unit === null)`) on create AND update item schemas.
4. **Ownership**: every client-supplied FK validated before/at write, inside the tx where relevant.
   Cross-owner / non-existent list, item, or catalog id → indistinguishable `404`, no write.
5. **Ordering**: `listLists` orders `status ASC, updatedAt DESC, id ASC`; items order `position ASC,
   id ASC`. `GET /lists` returns both active+archived by default; `?status=active|archived` narrows.
   Archived lists remain readable and mutable; `status:"active"` un-archives.
6. **Reorder**: under the list lock, require `orderedIds` to be EXACTLY the list's current item ids
   (same count, no duplicates — reject dups in schema too, no foreign/missing ids) else 400/404 with
   NO write; set positions to array index 0..n-1. `{orderedIds:[]}` valid only when the list is empty.
7. **Field limits**: list `name` 1–120 trimmed non-empty; `note` nullable, ≤1000; item `rawText`
   1–200 trimmed non-empty.
8. `updatedAt` bumped on every list/item write. `addItem` appends at `max(position)+1` (0 if empty).
   `deleteItem` leaves gaps (no compaction) — only reorder makes positions contiguous.

## Must NOT Change
- No schema change and NO new migration (tables/enums/checks/cascade already exist from 9.1).
- No `(list_id, position)` unique constraint — serialize via the parent row lock only.
- Do not touch `services/pantry.ts`, `services/units.ts`, or the 9.1 SHARING SEAM.
- Do not add to `DEMO_WRITE_ALLOWLIST` or mark any route `public`.
- Do not add web pages/query hooks (that is task 12.1). Shared contracts only.
- Do not edit `backup.ts` (coverage already complete).
- Do not stage/commit anything; never `git add`. Leave changes in the working tree.

## Acceptance Criteria
See TASK.md AC1–AC9. All must be demonstrably met.

## Commands (run from repo root; report literal output + exit codes)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w packages/shared`
4. `node --test apps/api/src/modules/shopping/**/*.test.ts`  (glob form — bare dir form errors)
5. Route snapshots: write a TEMPORARY one-off Node script that builds the app EXACTLY as
   `apps/api/src/app.route-snapshot.test.ts` does (read that test — two identically-configured Fastify
   instances: (a) canonical surface via the `onRoute` hook, flatten+uppercase methods, `registerRoutes`,
   `app.ready()`, dedup check, then `pairs.map(...).sort().join("\n") + "\n"` → write
   `apps/api/src/route-surface.snapshot.txt`; (b) `app.printRoutes({ commonPrefix: false })` byte-for-byte
   → write `apps/api/src/route-table.snapshot.txt`). Run it, then DELETE the temporary script. Then run
   `node --test apps/api/src/app.route-snapshot.test.ts` and confirm it passes.
6. Report `git status --porcelain=v1` and a full `git diff` of the working tree (including the two
   regenerated fixtures) so the snapshot delta can be inspected.

## Required Evidence
- Files changed (created/modified/deleted) and full unified diff.
- The literal fixture diff (both snapshot files) — I must see it is exactly the 9 new routes + auto
  HEAD for the new GET routes only, and nothing else.
- Every command above with its literal output, pass/fail counts, and exit code.
- Which tests are DB-gated (skipped locally) with their literal skip/error reason vs which ran.
- Any plan deviation or blocker, called out explicitly.

---

## Iteration 2 — expand the test matrix (TESTS ONLY; do NOT touch production code)

Codex review-3 confirmed the production code is correct but found the test matrix (P6/AC6/AC8/AC9)
incomplete. This iteration adds ONLY tests. Do NOT modify any non-test file
(`services/*.ts`, `routes/lists.ts`, `plugin.ts`, `packages/shared/src/schemas/shopping.ts`, the
snapshot fixtures). If you believe a production-code change is needed, STOP and report instead.

### Files to extend
- `apps/api/src/modules/shopping/routes/lists.route.test.ts` (DB-gated integration — runs in CI).
- `apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` (or a new
  `apps/api/src/modules/shopping/services/ownership.hermetic.test.ts` if cleaner) — locally runnable.
- `packages/shared/src/schemas/shopping.test.ts` — locally runnable.

### Integration cases to ADD (lists.route.test.ts) — reuse the existing harness (buildTestApp,
createTestUser, createSession, sessionCookie, app.inject). Each must assert both status AND, where
relevant, that NO write happened (re-query and check state unchanged):
1. Catalog ownership on ADD and on UPDATE (item), four cases each: (a) valid owned catalogItemId
   links; (b) another user's catalogItemId → 404 and item NOT created/changed; (c) nonexistent
   catalogItemId → 404 no write; (d) `catalogItemId:null` unlinks an existing link.
2. Item UPDATE one-sided quantity/unit (e.g. quantityBase set, unit null) → 400, no write.
3. Reorder: (a) after success, assert the ACTUAL numeric positions are 0..n-1 (fetch and check
   `position` values, not just id order); (b) equal-cardinality reorder where one id is FOREIGN to a
   2-item list (send exactly 2 ids, one belonging to another list/nonexistent) → 404 and positions
   UNCHANGED; (c) a FAILED reorder leaves every original position unchanged (capture positions before,
   assert equal after); (d) `{orderedIds:[]}` on a non-empty list → 400/appropriate error, no write,
   and on an EMPTY list → 200.
4. Concurrency, proving the parent row lock SERIALIZES (not just two racing promises): use a SECOND
   raw connection from `app.pg` (a dedicated pool client). In connection A run `BEGIN; SELECT id FROM
   shopping_lists WHERE id=$1 FOR UPDATE;` to hold the lock. Then invoke the service/route path that
   also needs the lock (an add and, separately, a reorder) and assert it is still PENDING after a
   short delay (e.g. it hasn't resolved), then `COMMIT` connection A and assert the pending operation
   now completes correctly. Do this for BOTH add-vs-lock and reorder-vs-lock, and a delete-vs-reorder
   variant. If a robust deterministic version is infeasible with app.inject, drive the service
   functions (addItem/reorderItems/deleteItem) directly against `app.db` for the blocked side. Use
   real synchronization (await the FOR UPDATE, use a bounded wait), not arbitrary long sleeps.
5. Demo-403 on EVERY mutation route, not just POST /lists: POST/PUT/DELETE /lists, POST/PUT/DELETE
   items, and PUT reorder — each with a demo session → 403.
6. Deterministic ordering: create lists with controlled status/updatedAt and assert
   `listLists` order is status ASC, updatedAt DESC, id ASC; create items with a duplicate `position`
   (via direct insert) and assert item order is position ASC, id ASC.
7. Delete leaves gaps: add 3 items (positions 0,1,2), delete the middle, assert remaining positions
   are still 0 and 2 (NOT compacted).
8. Default listing returns BOTH active and archived; `?status=active` and `?status=archived` narrow.
9. Archived list is readable and mutable; setting `status:"active"` un-archives.
10. Cross-owner UPDATE, DELETE, ADD-item, and REORDER (user B targeting user A's list/item) → 404,
    no write (re-query as user A to confirm unchanged).
11. Cascade: after DELETE /lists/:id, directly query `shoppingListItems` by the old listId and assert
    ZERO rows remain (prove children removed, not just parent 404).
12. `updatedAt` is bumped: capture list.updatedAt, perform an item add/update/delete and a list PUT,
    assert updatedAt increased.
13. raw-text-only item (rawText only, no catalogItemId/quantity/unit) persists via POST items → 200.

### Hermetic cases to ADD (run locally, no DB) — these MUST pass locally:
- Ownership-guard bite: with a fake `db` whose `query.<table>.findFirst` returns undefined, assert
  `assertOwnedList`, `assertOwnedCatalogItem` (non-null), and `assertOwnedListItem` each throw
  `HttpError(404)`; and that `assertOwnedCatalogItem(null)`/`(undefined)` is a no-op (no throw, no
  query). Build the fake db to satisfy `DbOrTx` minimally.
- Extend the route-registration test to assert each of the 9 routes has the EXPECTED body/params/
  querystring/response schema objects attached (schema presence per route), per P6.

### Shared cases to ADD (packages/shared/src/schemas/shopping.test.ts) — run locally:
- One expected-object `deepEqual` ROUND-TRIP per new schema: feed a complete valid input, `deepEqual`
  the parsed output against the expected object (create list, update list, create item, update item,
  reorder, list-with-items), following the repo's existing deepEqual convention.

### Commands (report literal output + exit codes)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w packages/shared`  (all must pass locally, incl. the new deepEqual tests)
4. `node --test apps/api/src/modules/shopping/routes/lists.hermetic.test.ts` — NOTE this needs the
   module-mocks flag; run it the way the workspace does: `npm run test -w apps/api` is the canonical
   path but is DB-gated overall. To run JUST the hermetic file locally use:
   `node --test --experimental-test-module-mocks apps/api/src/modules/shopping/routes/lists.hermetic.test.ts`
   (and the ownership hermetic file if you add one) — must pass.
5. Attempt the DB-gated integration suite: check if `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` are
   available (inspect `apps/api/.env` and the environment). If a DB+Redis ARE reachable, run
   `npm run test -w apps/api` (or `node --test --experimental-test-module-mocks
   apps/api/src/modules/shopping/routes/lists.route.test.ts` with the env exported) and report the
   literal pass/fail counts. If NOT reachable, report that explicitly with the literal error and state
   that the new integration cases are CI-only (CI provides these — see .github/workflows/ci.yml).
6. `git status --porcelain=v1` and full `git diff` — must show ONLY test-file changes.

### Required Evidence (iteration 2)
- Full diff of the three test files.
- Literal output + exit codes for every command; local pass/fail counts for hermetic + shared.
- Whether the DB-gated integration suite could run locally; if yes, its literal counts; if no, the
  literal reason and confirmation the new cases are authored for CI.
- Confirmation NO production (non-test) file was modified (git diff proves it).
- Any case you could not implement robustly (especially the concurrency serialization proof), with
  the reason — do not fake a passing test.

---

## Iteration 3 — harden 5 test assertions (TESTS ONLY; do NOT touch production code)

Codex review-4 found 5 valid test weaknesses. Fix ONLY these, in the test files. Do NOT modify any
production/non-test file. Do NOT weaken or delete existing passing assertions; strengthen/add only.

1. In `apps/api/src/modules/shopping/routes/lists.route.test.ts`, the "item UPDATE one-sided
   quantity/unit → 400" test (~line 835) only checks `quantityBase:500, unit:null`. ADD the MIRROR
   case in the same or a sibling test: `quantityBase:null, unit:"g"` (a valid NormalizedUnit) → 400,
   and re-query to assert the item is unchanged.
2. In the reorder equal-cardinality test (~line 935, "one foreign id"), it currently uses
   `randomUUID()` (a NONEXISTENT id). ADD a variant that uses a REAL item id belonging to ANOTHER
   list owned by the same user: create a second list with its own item, then reorder list-1 sending
   `[realItemFromList1, realItemFromList2]` (equal cardinality to list 1's item count) → expect 404
   and assert list 1's positions are unchanged. Keep the existing nonexistent-id case too.
3. In the cross-owner test (~line 1440), the post-attack snapshot only compares name/status/item
   count. STRENGTHEN it: after B's failed reorder and failed item-update, assert list 1's items are
   fully unchanged — same id ORDER, same positions, same rawText, same status for every item (compare
   the full items array, not just length). This proves B's reorder/update truly performed no write.
4. In the list-order test (~line 1170), there is no pair of same-status rows with EQUAL updatedAt, so
   the `id ASC` tie-break is unproven. ADD two active lists inserted with the SAME updatedAt value and
   assert they appear in ascending id order relative to each other in the default GET /lists response.
5. In the updatedAt test (~line 1579), every assertion uses `>=`, which a no-op implementation would
   pass. Change these to STRICT `>` (t1 > t0, t2 > t1, t3 > t2, t4 > t3) so the test proves the bump.
   Keep the existing inter-step sleeps so the strict comparison is reliable. If any strict comparison
   does not hold when you run it locally you MUST NOT loosen it back — instead STOP and report,
   because that would mean the production bump is not happening (a real bug to escalate to me).

Do NOT attempt to change the concurrency test (review-4 #3) — that is a deliberate kept decision.

### Commands (report literal output + exit codes)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w packages/shared`
4. `node --test --experimental-test-module-mocks apps/api/src/modules/shopping/routes/lists.hermetic.test.ts`
5. Note the integration file (`lists.route.test.ts`) is DB-gated and CI-only; you cannot run it
   locally without DATABASE_URL — report that. The new cases you add there run in CI.
6. `git status --porcelain=v1` and `git diff --stat` — confirm ONLY test files changed vs before iter 3.

### Required Evidence (iteration 3)
- The exact diffs of the changed test file(s).
- Every command's literal output + counts + exit codes (locally-runnable ones must stay green).
- Confirmation NO production/non-test file changed.
- Whether the strict `>` updatedAt change could be validated (it is in the DB-gated file, so likely
  CI-only) — state that explicitly; do NOT loosen it.
