**Findings**

BLOCKING: `canonicalizeItem`’s parent-row lock is not sufficient to prevent stale matches. The plan locks `shopping_lists` like add/delete/reorder, but `updateItem` does not take that lock; it validates and updates the item directly at [apps/api/src/modules/shopping/services/lists.ts:217](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:217) and [apps/api/src/modules/shopping/services/lists.ts:222](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:222). A concurrent item PUT can change `rawText` or `catalogItemId` while `canonicalizeItem` is matching the old `rawText`, and canonicalize can then attach a catalog item based on stale text. The implementation should lock the `shopping_list_items` row too, or do a conditional update against the exact raw text/version read and return a conflict/retry path. Parent locking is useful only for operations that also honor it.

BLOCKING: `convertToBaseQuantity`’s absolute epsilon rule can accept fractional base units that the plan says must be rejected. With `|q*f - round| <= 1e-6`, values such as `0.000000001 kg` scale to `0.000001 g` and round to `0`, and values very close to an integer base quantity silently snap to that integer. That violates the stated “fractional base unit is not representable” rule and the board’s “no float grams that round badly” concern. If the API must accept decimal display quantities, prefer exact decimal-string parsing into base units, or at least avoid a domain-sized absolute tolerance that changes user input. This needs to be fixed before implementation.

BLOCKING: `canonicalizeItem` should follow existing list-update timestamp semantics. `updateItem` bumps both item `updatedAt` and parent list `updatedAt` at [apps/api/src/modules/shopping/services/lists.ts:221](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:221) and [apps/api/src/modules/shopping/services/lists.ts:234](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:234). The plan says canonicalize sets `catalogItemId` and bumps `updatedAt`, but does not explicitly bump the list. Since the list row is already being locked, omitting the parent bump would make canonicalization behave differently from item PUT for list sorting/sync.

BLOCKING: the duplicate-name 409 requirement must cover both create and update, and should catch the named Postgres constraint through `pgError`, not rely on a pre-check. The unique index is [apps/api/src/modules/shopping/schema.ts:100](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:100). The existing helper for wrapped Postgres errors is [apps/api/src/lib/errors.ts:33](/work/personal/compass/apps/api/src/lib/errors.ts:33). A pre-check alone races; an uncaught `23505` would leak as a 500.

Non-blocking but important: the plan’s case-insensitive ambiguity path is real, and `investigation-1.md` is wrong on that point. The catalog unique index is on raw `(user_id, canonical_name)` at [apps/api/src/modules/shopping/schema.ts:101](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:101), with no `lower()` expression or `citext`, so case-only variants like `Atta` and `atta` can coexist under normal Postgres text semantics. A query on `lower(canonical_name) = lower($want)` can return 2+ rows. The plan is correct to surface ambiguity. It should stop saying this “mirrors `matchCategory` exactly”, though: `matchCategory` uses `.find()` and would return the first case-insensitive hit at [apps/extractor/src/extract.ts:293](/work/personal/compass/apps/extractor/src/extract.ts:293); the catalog plan is stricter and better aligned with the “only a unique hit wins” discipline from `matchAccount` at [apps/extractor/src/extract.ts:252](/work/personal/compass/apps/extractor/src/extract.ts:252).

Non-blocking: `assertOwnedCategory` already exists and is null-safe at [apps/api/src/lib/ownership.ts:49](/work/personal/compass/apps/api/src/lib/ownership.ts:49). The plan should make this definite instead of “worker to confirm”. Catalog CRUD must use it for `categoryId`, because the schema explicitly calls out `catalog_items.category_id` as an unenforced cross-owner FK at [apps/api/src/modules/shopping/schema.ts:20](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:20).

Non-blocking: route placement is acceptable but should be intentional. The catalog CRUD and `GET /catalog/match` belong naturally in `routes/catalog.ts`. The nested mutation `POST /lists/:listId/items/:itemId/canonicalize` could live there if the service boundary is “canonicalization”, but it is still a list-item route and should be registered with the same care as list routes. Existing list routing has an explicit ordering comment for static-vs-param paths at [apps/api/src/modules/shopping/routes/lists.ts:128](/work/personal/compass/apps/api/src/modules/shopping/routes/lists.ts:128). Register `GET /catalog/match` before `GET /catalog/:id` anyway; even if Fastify’s router gives static paths priority, that convention avoids future surprises.

**Math Review**

`unitPricePaise` formula is correct for non-negative integers with positive denominator. For `n = pricePaise * ref` and `q = quantityBase`, round-half-up of `n / q` is:

```ts
(2n * n + q) / (2n * q)
```

or more clearly with BigInt variables:

```ts
(2n * price * ref + quantity) / (2n * quantity)
```

The examples in the plan are correct: `10000 * 1000 / 5000 = 2000` paise/kg, `10000 * 1000 / 2000 = 5000` paise/L, and `10000 / 6` rounds to `1667`.

BigInt arithmetic is overflow-safe for realistic paise values and also for all safe JS integer inputs. The unsafe part is conversion back to `number`: the implementation must compare the BigInt result to `BigInt(Number.MAX_SAFE_INTEGER)` before calling `Number(result)`. Calling `Number()` first can lose precision for oversized results. The plan says “returned as a Number asserted to be a safe integer”; make that assertion a BigInt-bound check.

One wording bug: the plan says `pricePaise` is non-negative, which allows `0`, but P1 says guard tests include “zero/negative”. Zero price should probably be valid; zero `quantityBase` must be rejected.

**No-Migration Claim**

Confirmed, as long as the implementation does not add case-insensitive uniqueness or new columns. `catalog_items` already exists at [apps/api/src/modules/shopping/schema.ts:84](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:84), `normalized_unit` already exists at [apps/api/src/modules/shopping/schema.ts:67](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:67), and shopping tables are already covered by backup/restore: `ALL_TABLES` includes all 8 shopping tables at [apps/api/src/modules/system/services/backup.ts:47](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:47), `USER_TABLES` includes the user-owned shopping tables at [apps/api/src/modules/system/services/backup.ts:71](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:71), and `shopping_list_items` is linked through `shopping_lists` at [apps/api/src/modules/system/services/backup.ts:92](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:92). So “no migration / no backup change” is correct under the current schema.

**Missing Tests**

Add explicit tests for: stale `rawText` race or row-lock behavior around canonicalize; list `updatedAt` bump on successful canonicalize and no bump on `none`/`ambiguous`; create and update duplicate canonical names returning 409; category ownership on both create and update, including null; `unitPricePaise` result greater than `MAX_SAFE_INTEGER`; exact half rounding; zero price; `convertToBaseQuantity` rejecting tiny positive values that would round to zero and near-integer fractional base quantities; `GET /catalog/match` not being swallowed by `/:id`; demo 403 on all catalog mutations and canonicalize via the real auth hook.

**Overall**

The plan is mostly grounded in the repo and follows the existing ownership, paise, `.ts` import, user-scoping, shared-schema, and route-snapshot conventions. The blocking fixes are the canonicalize race, the float tolerance policy, duplicate unique-violation handling, and parent list timestamp semantics.