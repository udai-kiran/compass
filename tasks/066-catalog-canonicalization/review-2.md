**Review Result**

No remaining blocking issues from the 4 prior findings. The revised plan is ready to implement.

**Prior Blockers**

B1 resolved. The plan now locks `shopping_lists` first, then `shopping_list_items FOR UPDATE`, and reads/matches `rawText` only after the item lock at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:87). That is sufficient to serialize against `updateItem`: `updateItem` does not take a parent-list lock, but its `UPDATE shopping_list_items ... WHERE id/list_id` at [lists.ts](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:222) will take the same item row lock and block while canonicalize holds `FOR UPDATE`. Since `updateItem` is not wrapped in one transaction across item+list updates, I do not see a deadlock introduced by the list-first canonicalize order.

B2 resolved. The revised `convertToBaseQuantity(quantity: string, displayUnit)` design uses decimal-string parsing, unit-specific decimal-place limits, and integer arithmetic with no float/epsilon tolerance at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:71). That removes the prior rounding-to-zero and near-integer snapping hazard.

B3 resolved. The successful canonicalize path now explicitly bumps both the item and parent list `updatedAt` at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:91), matching `updateItem`, which bumps the item at [lists.ts](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:222) and the list at [lists.ts](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:235). Ambiguous/none correctly does no write and no bump.

B4 resolved. Duplicate `canonicalName` is now planned as INSERT/UPDATE error translation through `pgError` for SQLSTATE `23505`, with no racy pre-check, at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:95). The backing unique index exists at [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:101), and `pgError(err): { code: string; constraint?: string } | null` exists at [errors.ts](/work/personal/compass/apps/api/src/lib/errors.ts:33).

**Non-Blocking Items**

Addressed.

`assertOwnedCategory` exists with the assumed null-safe signature `(db, userId, categoryId: string | null | undefined) => Promise<void>` at [ownership.ts](/work/personal/compass/apps/api/src/lib/ownership.ts:49), and the plan requires it on both create and update at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:95).

`/catalog/match` is explicitly planned before `/catalog/:id` at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:107), matching the existing static-before-param route convention at [routes/lists.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/lists.ts:128).

BigInt bound checking before `Number()` is now explicit for `unitPricePaise` at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:62).

Zero price valid and zero/negative quantity rejected are explicit at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:66).

The match analogy is now accurate: the plan says catalog matching follows `matchAccount`’s unique-hit discipline and is stricter than `matchCategory`’s first-hit `.find()` behavior at [TASK.md](/work/personal/compass/tasks/066-catalog-canonicalization/TASK.md:78). That matches [extract.ts](/work/personal/compass/apps/extractor/src/extract.ts:255) and [extract.ts](/work/personal/compass/apps/extractor/src/extract.ts:285).

**Residual Note**

One implementation detail to preserve: `convertToBaseQuantity` should keep the “exact” promise by avoiding unsafe JS-number conversion for very large decimal strings, or by checking the computed base quantity is `Number.isSafeInteger` before returning. The existing shared quantity schemas use `.safe()` at [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:27). I would treat this as implementation hygiene, not a blocker to the revised plan.