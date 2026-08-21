## Round-2 verdict

Three original blockers are fully resolved. BLOCKING 3’s core design is correct, but the revised plan retains a contradictory PATCH-style test expectation. I also found one new concurrency blocker involving item deletion during reorder.

### BLOCKING 1 — Household acceptance criteria: RESOLVED

The board AC now explicitly requires owner scoping through `user_id` ([tasks/09.02-lists-crud.md:14](/home/udai/common/compass/tasks/09.02-lists-crud.md:14)). The scope note documents the former household wording, explains why sharing is unavailable, and explicitly defers household visibility ([tasks/09.02-lists-crud.md:20](/home/udai/common/compass/tasks/09.02-lists-crud.md:20)).

The revised plan consistently uses owner scoping in its design, service contract, and AC1 ([TASK.md:42](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:42), [TASK.md:96](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:96), [TASK.md:133](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:133)).

There is no remaining board AC that requires household visibility. This is internally consistent and can be truthfully completed.

### BLOCKING 2 — Add/reorder concurrency: RESOLVED for adds and reorders

The repository uses `drizzle-orm ^0.45.2` ([apps/api/package.json:26](/home/udai/common/compass/apps/api/package.json:26)). Its selected PostgreSQL query builder supports `.for("update")`, and the repo already compiles and uses precisely this pattern after `.select().from().where()`, for example in [transfers.ts:122](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:122) through [transfers.ts:143](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:143).

Locking the same owning `shopping_lists` row at the start of both operations genuinely serializes:

- add versus add;
- add versus reorder;
- reorder versus reorder.

The second transaction cannot inspect item positions or IDs until the first transaction commits. It therefore sees the first transaction’s completed item state before computing `max(position)` or validating the reorder set. The items do not need individual row locks for those three pairings, provided every add/reorder obtains the parent lock before reading any items and holds it through commit, as required by [TASK.md:54](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:54) and [TASK.md:100](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:100).

`DbOrTx` is already the repository’s established transaction-compatible type ([db/index.ts:5](/home/udai/common/compass/apps/api/src/db/index.ts:5), [db/index.ts:12](/home/udai/common/compass/apps/api/src/db/index.ts:12)), so changing the guards to accept it is correct.

No migration is needed. The existing table has:

- no `(list_id, position)` unique constraint;
- only the list index and nonnegative/pairing checks ([shopping/schema.ts:148](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:148), [shopping/schema.ts:166](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:166));
- an existing cascading list FK ([shopping/schema.ts:152](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:152)).

The proposed solution changes transaction behavior only.

### BLOCKING 3 — Full-object PUT pairing: CORE DESIGN RESOLVED, PLAN CONTRADICTION REMAINS BLOCKING

The switch to full-object PUT removes the quantity/unit tri-state ambiguity. If all update keys are required after parsing, the existing nullable refinement is correct:

```ts
(v.quantityBase === null) === (v.unit === null)
```

That is the actual response-schema rule at [shopping.ts:99](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:99) through [shopping.ts:113](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:113).

The resulting states are unambiguous:

- value plus unit: set/replace quantity;
- both null: clear quantity;
- exactly one null: reject;
- `catalogItemId: null`: unlink the catalog item.

Mark-bought also works as a PUT: the future UI must submit the current complete item with `status` changed to `"bought"` or `"dropped"`. That matches the plan’s declared contract ([TASK.md:47](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:47)). It is a valid full-replacement API, although the UI must not send only `{ status: "bought" }`.

However, P6 still requires “omitted preserve” for `catalogItemId` ([TASK.md:123](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:123)). That is PATCH semantics and contradicts the full-object item schema declared at [TASK.md:89](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:89). The design section also mentions “sensible defaults” ([TASK.md:76](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:76)), which could allow omitted properties even though the operation is described as full replacement.

Required correction:

- Update schemas must require every logical field in the request input, including nullable fields.
- Do not add Zod defaults that make fields omittable on PUT.
- Replace the “omitted preserve” update test with “omitted field rejected.”
- Preserve-on-omission applies only if the endpoint returns to PATCH semantics.

Until that contradiction is removed, BLOCKING 3 is not fully closed.

### BLOCKING 4 — Snapshot regeneration: RESOLVED

The exact fixture paths are:

- [apps/api/src/route-surface.snapshot.txt](/home/udai/common/compass/apps/api/src/route-surface.snapshot.txt)
- [apps/api/src/route-table.snapshot.txt](/home/udai/common/compass/apps/api/src/route-table.snapshot.txt)

The one-off generator must reproduce two separate app constructions from [app.route-snapshot.test.ts](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts):

1. Canonical surface:

   - Create `Fastify({ logger: false })`.
   - Install `validatorCompiler` and `serializerCompiler` ([lines 80–84](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:80)).
   - Register an `onRoute` hook before route registration.
   - Flatten string-or-array methods and uppercase them ([lines 75–89](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:75)).
   - Call `registerRoutes(app)`, then `app.ready()` ([lines 92–94](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:92)).
   - Check duplicate `${method} ${url}` keys ([lines 96–105](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:96)).
   - Render exactly:
     `pairs.map(...).sort().join("\n") + "\n"`
     ([line 107](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:107)).

2. Raw route tree:

   - Construct another identically configured Fastify instance.
   - Call `registerRoutes(app)` and `app.ready()`.
   - Emit `app.printRoutes({ commonPrefix: false })` byte-for-byte ([lines 120–129](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:120)).

Fastify’s automatically exposed `HEAD` routes are seen by this mechanism only for GET routes. The current fixtures demonstrate that `/api/shopping/units` produces `GET` and `HEAD` surface entries and `(GET, HEAD)` in the raw tree ([route-surface.snapshot.txt:117](/home/udai/common/compass/apps/api/src/route-surface.snapshot.txt:117), [route-surface.snapshot.txt:218](/home/udai/common/compass/apps/api/src/route-surface.snapshot.txt:218), [route-table.snapshot.txt:121](/home/udai/common/compass/apps/api/src/route-table.snapshot.txt:121)).

The planned nine declared routes should therefore add eleven canonical pairs: nine declared method/path pairs plus HEAD for the two GET routes. Reusing these exact mechanisms, deleting the temporary generator, and inspecting both diffs will produce the correct minimal intentional diff.

## NEW BLOCKING — Reorder can race item deletion

The parent-row protocol covers only `addItem` and `reorderItems` ([TASK.md:54](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:54), [TASK.md:104](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:104)). `deleteItem` is not required to acquire that lock.

Consequently:

1. Reorder locks the list and reads the exact item set.
2. A concurrent delete removes one child item; deleting a child does not require locking its parent row.
3. Reorder updates the rows it read and commits successfully.
4. The resulting list can have a gap and no longer contain the exact set that reorder validated.

That conflicts with AC5’s unconditional contiguous-position result ([TASK.md:142](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:142)).

The cleanest fix is to require every item-set-changing operation—currently add and delete, plus any future move—to lock the owning list row before touching children. Then add a concurrent delete/reorder integration case. Alternatively, reorder would need to lock all selected item rows and verify affected-row counts, but using the parent lock consistently is simpler.

No multi-parent deadlock ordering issue exists in the current design because each operation locks only one list. Catalog ownership reads do not introduce a competing row-lock order.

## Test matrix

The expanded P6 matrix is otherwise broad and testable. It covers CRUD, ownership/IDOR, validation, catalog ownership, cascade, ordering, archives, failed reorder atomicity, demo protection, authentication, and concurrent add/reorder behavior ([TASK.md:119](/home/udai/common/compass/tasks/064-shopping-lists-crud/TASK.md:119)).

It needs these corrections:

- Change update “catalog omitted preserves” to “omitted required PUT field rejects.”
- Explicitly test that a mark-bought PUT carrying the complete existing item changes only the requested desired state.
- Add concurrent delete/reorder serialization.
- For the concurrency tests, use separate database connections/transactions and synchronization points so the test proves blocking/serialization rather than merely launching two promises.

## Final assessment

- BLOCKING 1: resolved.
- BLOCKING 2: resolved for add/add, add/reorder, and reorder/reorder.
- BLOCKING 3: design is technically correct, but remains blocked by contradictory omission/default semantics.
- BLOCKING 4: resolved.
- New blocking issue: delete/reorder is outside the parent-lock protocol.

The plan is close, but not implementation-ready until the PUT omission contradiction and delete/reorder race are corrected.