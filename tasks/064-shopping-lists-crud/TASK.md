# Task 9.2 — Shopping lists CRUD + API

Board task: [`tasks/09.02-lists-crud.md`](../09.02-lists-crud.md) · release 2.3.0 · depends 9.1 (`done`, merged PR #198).

## Status
CODE COMPLETE & REVIEWED — DB-gated integration suite pending CI execution on push (not yet run;
push not authorized). Locally-runnable gates green and seen. NOT marked fully COMPLETE because the
integration tests execute only in CI and their output has not been observed.

### Final disposition (2026-08-21)
- Production code: implemented; independently verified (verification-1) + Codex review-3 = correct on
  every axis (locks, strict PUT, IDOR, reorder, ordering, snapshots, no migration/backup/unique-constraint).
- Iteration 2 + 3 tests: shared 259/259, hermetic 9/9, route-snapshot 7/7, typecheck 0, lint 0 —
  all SEEN green locally (verification-1/-2). 29 integration test blocks authored covering the full
  P6/AC matrix; review-4's 5 valid weaknesses (mirror qty/unit, real foreign-list reorder id, full
  cross-owner no-write array, id-ASC tie-break, strict `>` updatedAt) fixed in iteration 3 and
  coordinator-verified by reading the diffs.
- Integration suite (lists.route.test.ts): authored + statically reviewed; DB-gated → executes only
  in CI (Postgres+Redis provided by .github/workflows/ci.yml). Its output has NOT been observed, so
  per the "never claim tests pass without seeing output" rule this task is not declared fully COMPLETE
  until a push runs CI green. A push/PR was not authorized (user paused before the release step).
- Kept decision: review-4 #3 (op-vs-op race) — the single shared parent FOR UPDATE lock is proven to
  block each of add/reorder/delete; op-vs-op serialization follows transitively. Rejected: review-3/4
  DB-gating "throw vs skip" (CI runs these; matches convention).

## Superseded status line
IMPLEMENTING (iteration 2: expand tests). Production code verified correct by Codex review-3 +
independent verification-1 (clean diff, green local baseline); test matrix incomplete — fixing now.

## Review log (digested — do not re-read review files)
- review-1 (plan): 4 blocking — household AC, reorder concurrency, PUT tri-state, snapshot script. Resolved in-plan.
- review-2 (plan re-review): 2 residual blocking — PUT must be strict-no-omit; deleteItem must take parent lock. Resolved in-plan.
- review-3 (code): **Production code correct on every axis** — row locks on add/delete/reorder,
  strict PUT (no defaults), IDOR guards (both item.id+listId), catalog-ownership on add+update,
  reorder exact-set under lock, deterministic ordering, 9 routes/no public, snapshot delta exact,
  no migration/backup/unique-constraint. Both prior-review code blockers confirmed fixed.
  - review-3 BLOCKING 1 (test matrix incomplete) — **ACCEPTED, fix in iteration 2.** Integration file
    stops at basic append; missing: catalog-ownership 4 cases (add+update), update one-sided
    quantity/unit reject, failed-reorder-preserves-positions, equal-cardinality foreign/missing
    reorder id, numeric 0..n-1 positions after reorder, concurrent add/reorder & delete/reorder
    (separate connections + sync points), demo-403 on EVERY mutation (only POST /lists tested),
    deterministic list+item ordering, delete leaves gaps, default listing both statuses, archived
    readable+mutable, cross-owner update/delete/add/reorder (only GET tested), direct cascade child
    removal, updatedAt bump. Plus non-blocking: shared expected-object deepEqual round-trips,
    hermetic reorder index-mapping + ownership-guard bite tests, per-route schema assertions.
  - review-3 BLOCKING 2 (DB-gated test throws vs skips) — **REJECTED.** CI (.github/workflows/ci.yml
    L12-51) provides Postgres+Redis+SESSION_SECRET and runs `npm test`, so these tests EXECUTE in CI;
    the requireEnv-throw is the established convention (protection.route.test.ts) and AC9's "literal
    error reason locally" is satisfied by the throw text. Not a defect.
- iteration 2 (tests only): shared 259/259, hermetic 9/9 pass locally; 13 integration cases authored (CI-run).
- review-4 (expanded tests): shared round-trips + hermetic bites confirmed REAL; most matrix closed.
  Disposition of its 7 findings:
  - #1 one-sided qty/unit update tests only one direction — **FIX (iter 3).**
  - #2 reorder "foreign id" test uses nonexistent uuid not a true other-list item — **FIX (iter 3).**
  - #3 no op-vs-op (add/reorder, delete/reorder) race — **NON-BLOCKING, kept.** Each of add/reorder/
    delete is proven to block on the shared parent FOR UPDATE lock; op-vs-op serialization follows
    transitively (single lock). A flaky racing test is worse (review-1 warned against bare promise
    races). Documented decision.
  - #4 cross-owner reorder/update-item "no write" only checks count — **FIX (iter 3):** assert item
    order/rawText/status unchanged too.
  - #5 list-order test has no equal-updatedAt pair to prove id-ASC tie-break — **FIX (iter 3).**
  - #6 updatedAt uses >= (vacuous) — **FIX (iter 3):** use > to prove the bump.
  - #7 DB-gating throw + provenance — **REJECTED** (same as review-3 B2; provenance is Codex's git
    view of untracked files, confirmed clean by independent verification).

## Objective
A working, tested REST surface for shopping **lists** and their **items** under the existing
`/api/shopping` prefix: create / list / get / rename / archive / delete a list, and add / edit /
remove / reorder / mark-bought its items. No AI, no canonicalization — plain CRUD proven before any
model touches the domain (9.3+). Tables already exist from 9.1; **no migration and no schema change**.

## Root Cause
Not applicable — net-new feature on the 9.1 schema.

## Scope
- **New** `apps/api/src/modules/shopping/services/lists.ts` — list + item CRUD services taking
  `(db: Db, userId, …)`, filtering by owner `user_id`, returning shared-contract shapes.
- **New** `apps/api/src/modules/shopping/services/ownership.ts` — shopping-local ownership guards
  (`assertOwnedList`, `assertOwnedCatalogItem`) mirroring `lib/ownership.ts` (null-safe, `HttpError(404)`).
  A shopping-local guard avoids coupling `lib/ownership.ts` to the shopping schema; the 9.1 schema
  header explicitly permits "a new shopping equivalent".
- **New** `apps/api/src/modules/shopping/routes/lists.ts` — routes registered relative to the
  `/api/shopping` prefix (`/lists`, `/lists/:id`, `/lists/:id/items`, `/lists/:id/items/:itemId`,
  `/lists/:id/items/reorder`). `app.withTypeProvider<ZodTypeProvider>()`, Zod body/params/response
  from `@compass/shared`, `req.session!.userId`.
- **Edit** `apps/api/src/modules/shopping/plugin.ts` — register `shoppingListRoutes` alongside units.
- **Edit** `packages/shared/src/schemas/shopping.ts` — add `Create/Update` request schemas + a
  list-with-items response schema (see Plan). Consumed by the API today; web pages are 12.1.
- **Regenerate** the route-table snapshot (`app.route-snapshot.test.ts` fixture) **by script only**,
  exactly as 9.1 did — the diff must be exactly the new shopping routes (+ Fastify auto `HEAD`).
- **Tests**: service/route integration tests (CI-gated behind `DATABASE_URL`) + hermetic tests for
  pure logic (Zod validation, reorder mapping, ownership-guard 404) + shared-schema expected-object
  tests + a route-config test asserting every new mutation route is authenticated and NOT in the
  demo write allowlist / NOT `public`.

## Dependencies
- 9.1 (done). No other task blocks this.

## Design decisions (revised after review-1)
- **Owner-scoped via `user_id`, NOT `withSharing()`.** [review-1 BLOCKING 1 — resolved] Board AC1
  said "household-scoped"; the board file (`09.02-lists-crud.md`) has been **explicitly amended** to
  owner-scoped with the deferral recorded. Codex confirmed owner-only is the only safe implementation
  now (`shopping_list` is not a sharing resource type; the grant route does not verify resource
  ownership; `withSharing()` is dead code). Deferred to the repo-wide sharing rollout.
- **Updates are PUT-style full-object replaces**, exactly like `insurance.ts`. [review-1 BLOCKING 3 —
  resolved] This removes all partial-update tri-state ambiguity: the client sends the full desired
  state. `UpdateShoppingListSchema = { name, note, status }`; `UpdateShoppingListItemSchema =
  { rawText, catalogItemId, quantityBase, unit, status }`. Quantity/unit pairing is then the same
  both-or-neither nullable `.refine` as the response schema. Unlink a catalog item by sending
  `catalogItemId: null`; clear quantity by sending both `quantityBase` and `unit` as `null`.
  "Mark bought/dropped" is a PUT with `status` changed. Routes use `PUT` (not `PATCH`).
- **Concurrency-safe ordering via row lock.** [review-1 BLOCKING 2 + review-2 NEW BLOCKING —
  resolved] EVERY item-set-changing operation — `addItem`, `deleteItem`, AND `reorderItems` — first
  `SELECT … FOR UPDATE` the owning `shopping_lists` row (Drizzle `.for("update")`, as used at
  `modules/ledger/services/transfers.ts:122`) inside a transaction, then reads/validates/writes items
  in that same tx. Locking the parent on delete too is required so a concurrent delete cannot break
  reorder's exact-set guarantee (review-2). This serializes all add/delete/reorder pairings WITHOUT a
  `(list_id, position)` unique constraint — so **no migration** is needed (Codex #13). Ownership
  guards accept `DbOrTx` so they run inside the tx.
- **Items can exist as raw free-text** (board AC2): `rawText` required (min 1, trimmed non-empty);
  `catalogItemId`, `quantityBase`, `unit` all nullable. Quantity/unit paired both-or-neither.
- **Every client-supplied FK is ownership-checked** (9.1 schema-header prerequisite). Item write/
  delete constrains BOTH `item.id` AND `item.listId` (owner-scoped list) to block cross-list IDOR
  [review-1 #6]; body `catalogItemId` (when non-null) is validated via `assertOwnedCatalogItem`
  [review-1 #7]. Cross-owner and non-existent list/item/catalog ids all return an indistinguishable
  `404`, never a leak.
- **Reorder** = `PUT /lists/:id/items/reorder` with `{ orderedIds: uuid[] }`. Under the list lock:
  the set must be EXACTLY the list's current item ids (same cardinality, no duplicates, no foreign/
  missing ids) else `400`/`404` with no write; positions set to array index `0..n-1`. Empty
  `orderedIds` succeeds only when the list has no items. Duplicate uuids rejected. On failure every
  original position is unchanged (single tx). [review-1 #10]
- **Ordering & archive semantics** [review-1 #9]: default `GET /lists` returns BOTH active and
  archived, ordered `status ASC, updatedAt DESC, id ASC`; optional `?status=` narrows. Archived lists
  stay readable and mutable; archive is reversible via `status:"active"`. Items always ordered
  `position ASC, id ASC` (id tie-break because duplicate positions are physically possible).
  Deleting an item leaves position gaps (not compacted); only reorder makes positions contiguous.
- **Field limits** [review-1 #11]: list `name` 1–120 (trimmed non-empty), `note` nullable ≤1000,
  item `rawText` 1–200 (trimmed non-empty). No pagination (consistent with peer small domains;
  deliberate). **PUT update schemas require EVERY logical field explicitly — including nullable ones
  (`note`, `catalogItemId`, `quantityBase`, `unit`) — with NO Zod defaults that make a field
  omittable** [review-2 BLOCKING 3 residual]. Omitting a field on a PUT is a 400, never a
  preserve-on-omission. (Create schemas MAY default their optional fields; only updates are strict.)
- **Demo safety is automatic** (`plugins/auth.ts` single chokepoint rejects mutating methods for demo
  sessions). 9.2 adds nothing to `DEMO_WRITE_ALLOWLIST` and marks no route `public`. Because the
  allowlist is private to `auth.ts` [review-1 #5], demo rejection is proven by INTEGRATION tests that
  inject each mutation request through the REAL auth hook with a demo session (not by a route-config
  probe); route-config tests still assert `config.public !== true` and unauthenticated → 401.
- **No web pages** (that is 12.1 🎨); web query hooks deferred [review-1 #14]. Shared contracts now.

## Plan
- P1: Add shared contracts to `packages/shared/src/schemas/shopping.ts`:
  `CreateShoppingListSchema` (name 1–120, note nullable ≤1000),
  `UpdateShoppingListSchema` (full: name, note, status),
  `CreateShoppingListItemSchema` (rawText 1–200, catalogItemId nullable, quantityBase/unit nullable
  paired), `UpdateShoppingListItemSchema` (full: rawText, catalogItemId, quantityBase, unit, status —
  PUT-style, same both-or-neither `.refine`), `ReorderItemsSchema` ({ orderedIds: uuid[] }, reject
  duplicates), and `ShoppingListWithItemsSchema` (`ShoppingListSchema` + `items: ShoppingListItem[]`).
  Trim + non-empty on name/rawText. Export types via `z.input`/`z.infer`. Add expected-object tests
  per the `deepEqual` convention (create, update, item create/update, reorder, list-with-items).
- P2: Add `services/ownership.ts` — `assertOwnedList(db: DbOrTx, userId, listId)`,
  `assertOwnedCatalogItem(db: DbOrTx, userId, catalogItemId|null|undefined)`, and
  `assertOwnedListItem(db: DbOrTx, userId, listId, itemId)` (constrains BOTH item.id and item.listId,
  and that the list is owner-scoped). Null-safe where a null FK is legal; `HttpError(404)` otherwise.
- P3: Add `services/lists.ts` taking `(db: Db, userId, …)`:
  `createList`, `listLists` (optional `status` filter; order `status ASC, updatedAt DESC, id ASC`),
  `getList` (owner-checked; items `position ASC, id ASC`), `updateList` (PUT full replace),
  `deleteList` (relies on DB cascade), `addItem`, `updateItem` (PUT full replace), `deleteItem`,
  `reorderItems`. `addItem`, `deleteItem` AND `reorderItems` run in a tx that first
  `SELECT … FOR UPDATE` the owning list row (`.for("update")`), then read/validate/write items in
  that same tx. `addItem` appends at `max(position)+1` (0 for first). Every client FK validated via
  P2 guards INSIDE the tx. `updatedAt` bumped on every write. All queries owner-scoped.
- P4: Add `routes/lists.ts` (relative paths: `GET/POST /lists`, `GET/PUT/DELETE /lists/:id`,
  `POST /lists/:id/items`, `PUT/DELETE /lists/:id/items/:itemId`, `PUT /lists/:id/items/reorder`) with
  `withTypeProvider<ZodTypeProvider>()`, Zod body/params/response, `req.session!.userId`. Register in
  `plugin.ts`. No route is `public`.
- P5: Regenerate BOTH snapshot fixtures — `apps/api/src/route-surface.snapshot.txt` and
  `route-table.snapshot.txt` (paths to be confirmed by the impl worker from
  `app.route-snapshot.test.ts`). There is NO repo regeneration script [review-1 BLOCKING 4]: the
  worker writes a one-off hermetic Node script that builds the app the SAME way the snapshot test
  does and reuses its exact route-enumeration logic to emit both fixtures, runs it, then DELETES the
  script. The worker must inspect the fixture diff and confirm it is exactly the newly-declared
  method/path rows plus an automatic `HEAD` for each new GET route ONLY (no HEAD for POST/PUT/DELETE).
- P6: Tests (matrix from review-1 #12):
  - Shared: expected-object `deepEqual` tests for every new schema; pairing/limit refinements bite.
  - Hermetic (no DB): reorder index-mapping pure logic; route-config asserts every mutation route
    `config.public !== true`; each route's method/relative-path/schemas present.
  - CI-gated integration (real DB, real auth hook): full CRUD round-trips; raw-text-only item
    persists; quantity/unit create+replace+clear+one-sided-reject for create AND update; **PUT with
    an omitted required field → 400** (no preserve-on-omission); mark-bought PUT carrying the full
    existing item changes only `status`; catalog ownership (other user → 404 no write / nonexistent →
    404 / `null` unlink / a supplied valid id links); cross-list `itemId` update+delete → 404; list
    delete cascades to items; archive/filter/default listing + reversibility; deterministic list &
    item ordering; append positions; reorder exact-set, duplicate-id reject, foreign/missing-id
    reject, empty-reorder-only-when-empty, and FAILED reorder leaves all original positions unchanged;
    concurrent add/reorder AND concurrent delete/reorder serialized by the parent row lock (use
    separate DB connections/transactions with synchronization points to prove blocking, not just two
    launched promises); demo session rejected on every mutation via injected request through the real
    auth hook; unauthenticated → 401.

## Acceptance Criteria
- AC1: Full CRUD for lists and items works end to end, owner-scoped by `user_id` (board AC amended;
  household visibility deferred with 9.1's rationale).
- AC2: An item with only `rawText` (no `catalogItemId`, no quantity/unit) is valid and persists.
- AC3: Every client-supplied FK is ownership-checked: list `:id`, item `:itemId` (constrained by BOTH
  id AND listId → no cross-list IDOR), and body `catalogItemId` (when non-null). Cross-owner / non-
  existent ids return an indistinguishable 404 and perform no write.
- AC4: Quantity/unit pairing enforced both-or-neither at the Zod boundary (create AND PUT update) and
  preserved by the DB CHECK; clear via both-null, unlink catalog via `catalogItemId:null`. PUT update
  schemas require every field; an omitted field is a 400 (no preserve-on-omission).
- AC5: Reorder, under the owning-list row lock, sets contiguous positions `0..n-1` from `orderedIds`
  only when the set is EXACTLY the list's item ids (no dup/foreign/missing); otherwise no write and
  every original position is unchanged. Empty `orderedIds` succeeds only for an empty list. `addItem`,
  `deleteItem` and `reorderItems` all take the parent list lock, so a concurrent delete cannot break
  reorder's exact-set/contiguous result.
- AC6: Demo session is rejected on every shopping mutation, proven by injected requests through the
  real auth hook; no new route is `public` (route-config test) and none added to the demo allowlist;
  unauthenticated → 401.
- AC7: BOTH route-snapshot fixtures regenerated by reusing the snapshot test's own enumeration (no
  hand edit; one-off script deleted after); diff is exactly the new routes + auto `HEAD` for new GET
  routes only.
- AC8: List delete cascades to its items; default listing + `?status` filter + archive reversibility
  behave as specified; list order `status,updatedAt DESC,id`, item order `position,id` are deterministic.
- AC9: `npm run typecheck`, `npm run lint` exit 0; new hermetic + shared tests pass; DB-gated
  integration tests pass under CI — locally reported as skipped with their literal reason.

## Verification
- T1: `npm run typecheck` → exit 0, zero `error TS`.
- T2: `npm run lint` → exit 0.
- T3: `node --test packages/shared/…` shopping schema tests → all pass; full `packages/shared` green.
- T4: `node --test apps/api/src/modules/shopping/**/*.test.ts` → hermetic tests pass; DB-gated ones
  report their literal skip/error reason.
- T5: Route-snapshot test passes with the regenerated fixture; the fixture diff is inspected and is
  exactly the new routes.
- T6: A "does the test bite" drill for the ownership guard and the reorder-rejection path.

## Non-Goals
- Catalog canonicalization / unit-price math (9.3), AI capture (9.4/9.5), web pages (12.1).
- Turning on `withSharing()` — deferred with 9.1's documented rationale.
- Any schema/migration change — tables and backup coverage already exist from 9.1.
