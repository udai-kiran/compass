## Verdict

BLOCKING. The production implementation largely matches P1–P5 and closes both prior-review code blockers. However, P6/AC6/AC9 are substantially incomplete: the required integration/security/concurrency matrix is missing, and the DB-gated test fails at module load instead of reporting a skip when configuration is absent.

## BLOCKING findings

### 1. Most of the binding integration matrix is not implemented

The integration file ends at line 655 after the basic append-position test ([lists.route.test.ts:620](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:620)). It has no tests for:

- Catalog ownership on add or update:
  - valid owned ID links;
  - another owner’s ID returns 404 with no write;
  - nonexistent ID returns 404 with no write;
  - `catalogItemId:null` unlinks.
- Update quantity/unit one-sided rejection. The test only checks one-sided create, valid create, and both-null update ([lists.route.test.ts:412](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:412)).
- Failed reorder preserving every original position.
- Equal-cardinality foreign/missing reorder IDs. The only foreign ID is sent with three IDs for a two-item list, so it exercises the count check, not membership validation ([lists.route.test.ts:524](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:524)).
- Contiguous `0..n-1` positions after reorder; it checks returned ID order but not numeric positions ([lists.route.test.ts:503](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:503)).
- Concurrent add/reorder serialization using separate connections and synchronization points.
- Concurrent delete/reorder serialization using separate connections and synchronization points.
- Demo rejection for every mutation. Only `POST /lists` is tested ([lists.route.test.ts:99](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:99)).
- Deterministic list ordering by status, updated time, and ID.
- Deterministic item ordering by position and ID.
- Deletion leaving position gaps.
- Default unfiltered listing containing both active and archived lists.
- Archived-list readability and general mutability. Unarchive is covered, but not the broader contract.
- Nonexistent list/item behavior and explicit no-write assertions for failed ownership operations.
- Cross-owner update/delete/add/reorder attempts. Only cross-owner GET is covered ([lists.route.test.ts:309](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:309)).
- Direct proof that cascade removed the child row. The cascade test only proves the deleted parent now returns 404 ([lists.route.test.ts:265](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:265)); that result would be identical if an orphan remained.
- `updatedAt` behavior, despite P3 declaring it part of the service contract.

These are explicitly required by P6 and several are security/concurrency regressions demanded by review-1/review-2. Comments in production code claiming serialization do not replace the required real-database proof.

### 2. The “DB-gated” test is not actually skippable

The file throws during module initialization whenever any required variable is absent:

- `requireEnv` throws at [lists.route.test.ts:29](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:29).
- It is invoked unconditionally at [lists.route.test.ts:38](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.route.test.ts:38).

This contradicts TASK.md T4/AC9, which requires a literal skip/error reason locally. Running the shopping test glob without DB/Redis configuration will fail, not report a skipped integration suite.

## Non-blocking test weaknesses

- P6 requires expected-object `deepEqual` tests for every new shared schema. The tests mostly use individual `safeParse`/`equal` assertions. For example, create-list output is checked field-by-field ([shopping.test.ts:342](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:342)); update schemas only check success/failure ([shopping.test.ts:367](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:367), [shopping.test.ts:418](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:418)). There is no complete expected-object round trip for every schema.
- The required hermetic reorder index-mapping test and ownership-guard 404/bite test are absent. The hermetic file tests only route registration/public metadata ([lists.hermetic.test.ts:53](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.hermetic.test.ts:53)).
- The hermetic route test does effectively establish `public !== true` for registered mutation routes: it records any mutation whose public flag is exactly true ([lists.hermetic.test.ts:60](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.hermetic.test.ts:60)), while the second test establishes all seven mutations, two GETs, and both HEADs exist ([lists.hermetic.test.ts:86](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.hermetic.test.ts:86)). It does not check every route’s schemas or response status as P6 requested.

## Production-code review

### Row-lock concurrency: implemented correctly

All three item-set/position-changing service operations use the required protocol:

- `addItem` opens `db.transaction`, then locks the owner-scoped parent row before catalog validation, position reads, or writes ([lists.ts:161](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:161)).
- `deleteItem` opens a transaction, locks the parent first, then calls `assertOwnedListItem(tx, …)` and deletes ([lists.ts:249](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:249)).
- `reorderItems` opens a transaction, locks the parent first, then reads and validates the current item set ([lists.ts:288](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:288)).

The locks include both list ID and user ID ([lists.ts:166](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:166), [lists.ts:254](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:254), [lists.ts:293](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:293)).

`updateList` and `updateItem` do not change membership or position and therefore correctly omit the parent ordering lock. I found no list/item CRUD service path that adds, deletes, or repositions an item without the parent lock. Whole-list deletion cascades children but is outside the surviving-list ordering protocol.

Thus review-1 BLOCKING 2 and review-2’s delete/reorder blocker are fixed in real code, but their required concurrency proofs are missing.

### Strict PUT and quantity pairing: implemented correctly

- `UpdateShoppingListSchema` requires `name`, nullable `note`, and `status`, with no defaults ([shopping.ts:188](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:188)).
- `UpdateShoppingListItemSchema` requires all five fields, including all nullable fields, with no defaults ([shopping.ts:215](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:215)).
- Create pairing is enforced at [shopping.ts:205](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:205).
- Update pairing is enforced at [shopping.ts:221](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:221).
- `catalogItemId:null` writes SQL null, and both-null clears quantity/unit ([lists.ts:223](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:223)).

The shared tests bite on omitted PUT fields, one-sided quantity/unit, and duplicate reorder IDs ([shopping.test.ts:367](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:367), [shopping.test.ts:400](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:400), [shopping.test.ts:418](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:418), [shopping.test.ts:441](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:441), [shopping.test.ts:472](/home/udai/common/compass/packages/shared/src/schemas/shopping.test.ts:472)).

Review-2 BLOCKING 3 is fixed.

### Ownership/IDOR: implemented correctly

- `assertOwnedListItem` first proves owner-scoped list ownership, then constrains both item ID and list ID ([ownership.ts:61](/home/udai/common/compass/apps/api/src/modules/shopping/services/ownership.ts:61)).
- Both update and delete call that guard ([lists.ts:218](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:218), [lists.ts:259](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:259)).
- Add validates any non-null catalog ID inside its transaction ([lists.ts:170](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:170)).
- Update validates any non-null catalog ID before writing ([lists.ts:219](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:219)).
- Catalog ownership is constrained by catalog ID and user ID, with identical 404 behavior for absent/foreign rows ([ownership.ts:42](/home/udai/common/compass/apps/api/src/modules/shopping/services/ownership.ts:42)).
- List queries and mutations are directly owner-scoped. Item queries are scoped through an already owner-validated/locked parent list.

The real predicates prevent cross-list and cross-owner writes. The missing catalog/no-write tests remain a blocking verification gap.

### Reorder correctness: implemented correctly

Under the parent lock, reorder:

- reads the current item IDs ([lists.ts:297](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:297));
- validates cardinality ([lists.ts:306](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:306));
- validates membership ([lists.ts:313](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:313));
- writes positions `0..n-1` ([lists.ts:319](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:319));
- performs validation and writes in one transaction, so exceptions roll back all changes.

Schema-level duplicate rejection is present at [shopping.ts:232](/home/udai/common/compass/packages/shared/src/schemas/shopping.ts:232). Empty input succeeds only when the current set is empty through the cardinality check.

### Deterministic ordering: implemented correctly

- Lists: status ascending, updated time descending, ID ascending ([lists.ts:96](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:96)).
- Items: position ascending, ID ascending ([lists.ts:111](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:111)).
- Add appends using `COALESCE(MAX(position), -1) + 1` ([lists.ts:173](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:173)).
- Delete performs no compaction ([lists.ts:261](/home/udai/common/compass/apps/api/src/modules/shopping/services/lists.ts:261)).

### Routes and auth: implemented correctly

There are exactly nine declared relative routes in [lists.ts](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.ts:48), with PUT for both updates and reorder. The static reorder route is registered before `:itemId` ([lists.ts:128](/home/udai/common/compass/apps/api/src/modules/shopping/routes/lists.ts:128)). No route sets `config.public`.

The plugin registers the list routes under the existing shopping module ([plugin.ts:16](/home/udai/common/compass/apps/api/src/modules/shopping/plugin.ts:16)). Demo protection therefore relies correctly on the global auth hook, but the “every mutation” behavior is presently only asserted in comments and the plan—not tested.

### Snapshot fixtures: correct minimal delta

The committed diff is exactly:

- nine declared routes;
- automatic HEAD for the two GET routes;
- no other canonical surface changes.

The raw route tree contains the matching hierarchy and method sets. I ran `app.route-snapshot.test.ts`; both byte-for-byte fixture checks passed.

### No migration/schema/backup expansion

- `shopping_list_items` still has only its ordinary list index and checks; no `(list_id, position)` unique constraint exists ([schema.ts:148](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:148)).
- The existing list FK still supplies `onDelete:"cascade"` ([schema.ts:152](/home/udai/common/compass/apps/api/src/modules/shopping/schema.ts:152)).
- `git diff` shows no changes under `apps/api/drizzle/`, `shopping/schema.ts`, or `backup.ts`.

## Executed verification

- Shared shopping schema tests: 35 passed.
- Shopping-list hermetic route tests: 2 passed.
- Route snapshot tests: 7 passed.
- DB integration suite: not executable in this environment without its three services/variables; critically, it would fail rather than skip because of the unconditional module-level throws.

## P/AC disposition

- P1: implemented; expected-object testing convention incomplete.
- P2: implemented.
- P3: implemented.
- P4: implemented.
- P5: implemented and fixture-consistent.
- P6: BLOCKING incomplete.

- AC1–AC5: production behavior is implemented; several required ownership/reorder/concurrency proofs are missing.
- AC6: BLOCKING incomplete—only one demo mutation is tested.
- AC7: satisfied.
- AC8: production ordering/filter/cascade behavior is present, but deterministic ordering, default both-status listing, delete gaps, and direct cascade removal are weak or untested.
- AC9: BLOCKING incomplete—the integration gate does not skip cleanly, and its required matrix is absent.