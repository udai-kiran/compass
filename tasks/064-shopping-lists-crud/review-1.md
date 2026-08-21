## Plan review

### BLOCKING

1. **Owner-only scope does not satisfy the board AC without an explicit product decision.**

The technical justification is sound: `shopping_list` is not a supported sharing resource type ([household/schema.ts](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:71)), so no grant can be created for a list; the grant route also does not verify resource ownership ([sharing.ts](/home/udai/common/compass/apps/api/src/modules/household/routes/sharing.ts:28)); and `withSharing()` therefore cannot safely provide household list access.

However, the plan’s claim that only pantry/habit were intended as household-scoped is contradicted by the task’s literal “Full CRUD … household-scoped” AC ([09.02-lists-crud.md](/home/udai/common/compass/tasks/09.02-lists-crud.md:14)). Shopping lists are also inherently plausible household resources. A plain `user_id` does not itself prove owner-only product intent; other shareable resources use the same physical ownership model.

Owner-only is the only safe implementation now, but the board AC must be amended or explicitly accepted as deferred. Otherwise the implementation cannot truthfully claim AC1.

2. **Reorder/add concurrency is underspecified; “one transaction” alone does not prove atomic ordering.**

The table has only a non-negative position check and no `(list_id, position)` uniqueness constraint ([shopping/schema.ts](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:148)). Under normal read-committed transactions:

- Two concurrent adds can both compute the same append position.
- An add can occur between reorder’s set validation and updates.
- Concurrent reorders can interleave updates.

The plan must prescribe serialization, preferably locking the owning `shopping_lists` row inside both `addItem` and `reorderItems`, then validating/computing positions and writing using the same transaction. Ownership guards used inside that transaction should accept `DbOrTx`, as the existing guard convention does ([ownership.ts](/home/udai/common/compass/apps/api/src/lib/ownership.ts:17)). Without this, AC5’s exact-set/atomic claim is not established.

3. **The proposed update quantity/unit schema is not sufficiently defined and the “same refine” can be wrong for partial updates.**

Existing response schemas compare nullable values ([shopping.ts](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:99)). An update schema has three states per field: omitted, explicitly null, and set. Simply making both fields optional and reusing the nullable equality refine can accidentally accept a one-sided update, depending on how the check is written, and can also make clearing impossible.

The plan must define:

- Neither key supplied: leave both unchanged.
- Both supplied as `null`: clear both.
- Both supplied as valid values: replace both.
- Exactly one key supplied: reject.

Likewise, `catalogItemId` must be `uuid().nullable().optional()` so an item can be unlinked; ownership checking applies only to a supplied non-null value. Integration tests must cover all four quantity/unit cases for both create and update, including updating an already populated row.

4. **The snapshot regeneration step assumes a script that does not exist.**

`app.route-snapshot.test.ts` only reads and compares the two fixtures ([app.route-snapshot.test.ts](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:107), [app.route-snapshot.test.ts](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:128)). There is no repository regeneration script. Historical tasks used temporary hermetic scripts.

P5 must state the actual reproducible command/mechanism and regenerate both fixtures because this task intentionally adds routes:

- `route-surface.snapshot.txt`
- `route-table.snapshot.txt`

The expected surface delta must include each declared method/path and automatic `HEAD` only for GET routes—not a generic “+ Fastify auto HEAD.”

### Non-blocking findings

5. **Prefix and automatic demo protection assumptions are correct.**

The module is registered with `{ prefix: "/api/shopping" }` ([app.ts](/home/udai/common/compass/apps/api/src/app.ts:153)); relative `/lists` routes are therefore correct. Existing shopping tests already prove this behavior ([units.route.test.ts](/home/udai/common/compass/apps/api/src/modules/shopping/routes/units.route.test.ts:17)).

The auth hook rejects every demo `POST`, `PUT`, `PATCH`, or `DELETE` except exact allowlisted route URLs ([auth.ts](/home/udai/common/compass/apps/api/src/plugins/auth.ts:16), [auth.ts](/home/udai/common/compass/apps/api/src/plugins/auth.ts:64)). New mutation routes are automatically protected if they do not set `public`.

But a route-options test cannot directly prove “not in demo allowlist”: the allowlist is private to `auth.ts` and is not route configuration. Retain route-config checks for `public !== true`, and prove demo behavior through injected requests with the real auth hook and a fake/session-backed Redis setup, or an equivalent auth integration test for every mutation method/path.

6. **A shopping-local ownership file is reasonable, but guard and mutation scopes need precision.**

The schema explicitly permits a shopping equivalent ([shopping/schema.ts](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:20)), so avoiding central-schema coupling is acceptable.

The plan should require:

- Guards accept `DbOrTx`, not only `Db`.
- Every item update/delete constrains both `item.id` and `item.listId`; checking only the parent list and then mutating by `itemId` would permit cross-list IDOR within the same or another owner’s data.
- The list ownership check and item mutation happen in the same transaction where ordering is affected.
- Cross-owner and nonexistent list, item, and catalog IDs all return indistinguishable 404 responses.

The proposed 404 behavior follows the existing ownership convention ([ownership.ts](/home/udai/common/compass/apps/api/src/lib/ownership.ts:23)) and does not leak existence.

7. **Catalog ownership validation is necessary and correctly identified.**

`shopping_list_items.catalog_item_id` is an unenforced cross-owner FK ([shopping/schema.ts](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:20)). Both create and update must validate any supplied non-null `catalogItemId` before writing. Tests should include:

- Other user’s catalog item → 404 and no write.
- Nonexistent catalog item → same 404.
- `null` → successfully unlink.
- Omitted on update → preserve current link.

8. **Cascade behavior exists, but the test plan should explicitly prove it.**

List deletion cascades through `shopping_list_items.list_id` ([shopping/schema.ts](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:152)). No service-side child deletion is needed. Add an integration assertion that deleting a list removes its items; otherwise “deleteList (cascade)” is only assumed rather than verified.

9. **Archive and listing semantics need a concrete contract.**

The plan says an optional status filter but does not say what an unfiltered list call returns or how archived lists behave. Define:

- Whether default listing returns only active lists or both statuses.
- Whether archived lists remain readable and mutable.
- Whether archive is reversible by setting `status: "active"`.
- Deterministic list ordering.

The database supplies no implicit ordering guarantee. A stable order such as status then `updatedAt DESC`, with an ID tie-breaker, should be specified and tested. Items similarly need an ID tie-breaker after `position`, because duplicate positions are possible in existing data.

Pagination is not required by the board task and omitting it is consistent with many existing small-domain endpoints, but the omission should be deliberate. At minimum ensure deterministic ordering.

10. **Position behavior after deletion should be decided.**

Appending at `max(position) + 1` is reasonable, but deleting an item leaves gaps unless positions are compacted. The AC only demands contiguous positions after reorder, not after every deletion, so either behavior is acceptable. State it explicitly and test the selected behavior.

Also define empty-list reorder: `{ orderedIds: [] }` should succeed only when the list is empty. Duplicate UUIDs must be rejected by schema or exact-set validation.

11. **Request contracts need stricter field limits and empty-update handling.**

Existing entities only guarantee non-empty strings, while the insurance request exemplar adds explicit maximums and defaults ([insurance.ts](/home/udai/common/compass/packages/shared/src/schemas/insurance.ts:108)). The plan should choose reasonable limits for list name, note, and raw text, reject empty names/raw text, and decide whether whitespace-only strings are allowed.

`UpdateShoppingListSchema` and `UpdateShoppingListItemSchema` should reject `{}` unless a no-op update is intentionally supported. The response schema should also specify whether list collection responses contain bare lists or lists with all items; only `ShoppingListWithItemsSchema` is currently mentioned.

12. **The test plan needs more route-level and database assertions.**

Hermetic schema tests, shared expected-object tests, integration CRUD, ownership 404, and demo rejection are a good base, but the plan should explicitly cover:

- Every route’s method, relative path, request schema, response schema, and expected status code.
- Unauthenticated rejection, not only `public` metadata.
- Cross-list `itemId` update/delete rejection.
- Catalog ownership on both create and update.
- Quantity/unit create, replace, clear, omit, and one-sided rejection.
- Raw-text-only item persistence.
- Append positions, concurrent add/reorder serialization, duplicate reorder IDs, missing IDs, foreign IDs, and empty reorder.
- Delete cascade.
- Archive/filter/default-list behavior.
- Deterministic list and item ordering.
- Failed reorder leaves every original position unchanged.
- `updatedAt` changes on list/item writes if that is an asserted service behavior.

A fake-DB ownership test alone does not prove the actual Drizzle predicate includes both ID and owner. The cross-owner database integration cases are essential.

13. **No migration and no backup edit are correct—subject to the concurrency solution not adding a uniqueness constraint.**

The required tables, enums, checks, FK cascade, and status columns already exist. Backup coverage is complete: `shopping_lists` is owner-scoped in `USER_TABLES` ([backup.ts](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:71)), and `shopping_list_items` is linked through `list_id` in `LINKED_TABLES` ([backup.ts](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:81)). No backup change is needed.

If the implementation chooses a database uniqueness constraint for positions instead of row-lock serialization, that would invalidate the “no migration” decision. Locking avoids that expansion.

14. **Deferring web query hooks is correct.**

The board task is explicitly API/service CRUD, and the plan identifies web pages as task 12.1. Shared contracts are sufficient preparation; adding web hooks now would be unnecessary scope.

### Verdict

The overall module shape, prefix usage, local ownership guards, demo chokepoint, FK threat model, no-migration decision, backup coverage, and web deferral are sound. The plan is not implementation-ready until it resolves the household-AC deviation, specifies concurrency-safe ordering, defines partial update pairing/null semantics, and replaces the nonexistent snapshot-script assumption with a real regeneration procedure.