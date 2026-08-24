**Findings**

1. **Missing integration with “shopping list items marked bought”**
   The objective says purchases are learned from list items marked `bought`, but the plan only adds manual pantry/habit routes. Existing list item status changes happen in `updateItem()` by setting `status` and `updatedAt` on `shoppingListItems` ([lists.ts](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:221)). There is no planned hook there to replenish pantry or trigger learning when an item transitions to `bought`. Without that, AC1/AC2 only work if someone separately calls `/pantry/:catalogItemId/replenish`, not from the existing shopping flow.

2. **`updatedAt` is not a reliable purchase timestamp**
   The plan uses `shopping_list_items.updatedAt as boughtAt` ([TASK.md](/work/personal/compass/tasks/077-consumption-rate-pantry/TASK.md:56)). In the real code, `updatedAt` changes on any item update and list reorder, not only when status becomes `bought`. A bought item edited or reordered later will appear purchased later. There is no `boughtAt` column today, so the task needs to either accept and document this limitation with characterization tests, add a migration, or store purchase events elsewhere.

3. **Cross-owner catalog IDs are a serious write risk**
   `pantry_items.catalog_item_id` and `habit_profiles.catalog_item_id` are normal FKs, but they do not prove ownership ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:240), [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:295)). Existing shopping writes call `assertOwnedCatalogItem()` before accepting a `catalogItemId` ([ownership.ts](/work/personal/compass/apps/api/src/modules/shopping/services/ownership.ts:42)). The plan must explicitly require that every pantry/habit write and recompute route asserts the catalog item belongs to `req.session!.userId`; otherwise a user can create pantry/profile rows pointing at another user’s catalog item.

4. **The sharing assumption is inconsistent with current code**
   AC5 says “owner-only scoping maintained (existing SHARING SEAM pattern)” ([TASK.md](/work/personal/compass/tasks/077-consumption-rate-pantry/TASK.md:108)). The real `pantry.ts` says owner-only is deliberate and the seam is exactly replacing `eq(table.userId, userId)` later, not using `withSharing()` now ([pantry.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry.ts:4)). New reads/writes should stay owner-only and tests should pin that, including joins on both `userId` and `catalogItemId`.

5. **Quantity/unit nullability is under-specified**
   `shopping_list_items.quantityBase` and `unit` are nullable but paired ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:180)). Pantry and habit quantities are also nullable and paired ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:146), [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:172)). The plan needs to state what happens for bought catalog items with no item quantity/unit, and for catalog items with no default pack quantity/unit. If neither the bought line nor catalog default has quantity+unit, no rate can be computed; the service should return null/no confident profile rather than guessing.

6. **“Filter to same unit” has no target unit**
   `computeConsumptionRate()` says “Filter to same unit” and a test says mixed units use only same-unit purchases, but it does not say which unit wins. It should group by unit and choose a deterministic unit, or use the catalog/habit unit as the target. Ties, null units, and fewer than two purchases after filtering need explicit behavior.

7. **Float arithmetic would violate AC6**
   The plan uses `quantityBase / dailyRate`, `dailyRate × days`, and “median interval in days” ([TASK.md](/work/personal/compass/tasks/077-consumption-rate-pantry/TASK.md:62), [TASK.md](/work/personal/compass/tasks/077-consumption-rate-pantry/TASK.md:69)). That is likely to introduce floats. This repo requires integer quantities; use integer milliseconds and rational arithmetic, e.g. `floor(consumptionBasePerMonth * elapsedMs / (30 * MS_PER_DAY))`, and define rounding direction.

8. **Replenishment depletion estimate uses the wrong quantity**
   The plan says upsert by adding to existing quantity, then compute depletion from `quantityBase` ([TASK.md](/work/personal/compass/tasks/077-consumption-rate-pantry/TASK.md:60)). Expected depletion should be based on the new total stock after decaying stale stock to now and adding the purchase, not just the incoming purchase quantity.

9. **Manual correction is not truly persistent feedback if recompute overwrites it**
   The plan adjusts `habit_profiles.consumptionBasePerMonth`, but `learnConsumptionRate()` later recomputes from bought list items and can overwrite the correction. There is no correction-events table or existing note column. If corrections must “feed back” persistently, the plan needs a durable representation or a rule that recompute incorporates the adjusted prior.

10. **`CorrectPantrySchema.note` has nowhere to go**
    The planned `{ quantityBase, unit, note? }` request cannot persist `note` in existing `pantry_items` or `habit_profiles`; neither table has a note column ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:233), [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:288)). Either drop `note` or add a migration/event table and tests.

11. **Unit mismatch rules are missing**
    Replenish/correct can receive a unit that differs from an existing pantry item, habit profile, or catalog item. Since only normalized base units exist (`g`, `ml`, `piece`) and no conversion between kinds is valid, the service should reject mismatched units with 400 or define a safe migration path. Silent overwrite would corrupt stock/rate semantics.

12. **Outlier algorithm needs sharper edge cases**
    “Purchase quantity > 3× median quantity” is not enough. Define what happens when the outlier removal leaves fewer than two purchases, when the first/last purchase is the outlier, when median quantity is zero, and whether intervals are recomputed after excluding outliers.

13. **Tests are too narrow for the risk**
    The planned tests are mostly pure unit tests. Missing required coverage:
    - DB integration tests for `learnConsumptionRate()` joining `shopping_list_items` through `shopping_lists.user_id`.
    - Cross-owner route/service tests for pantry replenish, correct, decay, and habit recompute.
    - Upsert behavior tests for existing rows, null-rate profiles, unit mismatch, and concurrent/atomic increment.
    - Shared Zod tests for every new request/response schema.
    - Route snapshot updates plus route tests for auth/demo mutation behavior.
    - A test proving bought list items with null quantity/unit do not produce bogus rates.

14. **Route response shape may be insufficient for display**
    `PantryItemWithHabitSchema` combines pantry and habit only. Existing entity schemas omit `userId` by convention ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:15)), but a pantry display likely also needs catalog fields such as `canonicalName`/`brand`. If the route is meant for UI display, include a catalog projection or explicitly leave display enrichment to another endpoint.

**Convention Notes**

ESM `.ts` import convention is already used in `plugin.ts` ([plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:2)); new route/service imports should match it. The route paths should remain relative to `/api/shopping`, as the current plugin documents ([plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:19)). No money fields are added here, but all quantity math must follow the same integer-only discipline as paise.