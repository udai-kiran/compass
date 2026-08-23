**Plan Review Findings**

**High Severity**

- `cart_draft_items.catalogItemId` is planned with `onDelete: "set null"` but the field list does not say it is nullable. If the FK uses `set null`, the Drizzle column and shared schema must allow `catalogItemId: null`; otherwise deletes of catalog items will fail or the schema will be inconsistent. Same question applies to `substitutionForItemId`, which is described as a UUID pointer but not explicitly as an FK or with delete behavior. See planned fields in `tasks/079-predictive-cart/TASK.md:15`.

- Idempotency is underspecified and race-prone. “Existing draft for today” in `tasks/079-predictive-cart/TASK.md:55` needs a concrete timezone rule because `cart_drafts.generated_at` is `timestamptz` (`apps/api/src/modules/shopping/schema.ts:270`). It also needs DB-level protection or transaction locking; two concurrent `POST /drafts/generate` calls can both observe no draft and insert duplicates. Consider a generated date column or partial unique index for `(user_id, generated_date)` where `status = 'draft'`, plus tests for concurrent generation and day-boundary behavior.

- Ownership/IDOR coverage is missing for the new routes. `cart_draft_items` will likely be a linked child with no `user_id`, so `GET /drafts/:id`, `PUT /drafts/:id/items/:itemId`, and `DELETE /drafts/:id` must scope through `cart_drafts.user_id`, and item updates must constrain both `item.id` and `cartDraftId`, like list item ownership does. The existing shopping ownership helpers only cover lists, catalog items, price sources, and observations; there is no draft guard yet (`apps/api/src/modules/shopping/services/ownership.ts`). This needs explicit scope and route/service tests for cross-user draft and cross-draft item access.

- The substitution plan risks incorrect financial recommendations because it says “same-unit catalog item with lower current price” (`tasks/079-predictive-cart/TASK.md:50`) but price observations are per pack and may have `packQuantityBase` (`apps/api/src/modules/shopping/services/price-observations.ts:68`). Raw `pricePaise` cannot compare a 500g pack to a 1kg pack. Use integer unit-price math or exact pack-normalized cost for the suggested quantity. Do not use the existing `unitPricePaisePerBase` from price history because it currently divides with `/` and returns a float (`apps/api/src/modules/shopping/services/price-history.ts:45`).

**Medium Severity**

- The plan assumes a usable latest-price helper exists. `price-observations.ts` only exposes `listObservations`, ordered newest first and scoped by `userId` (`apps/api/src/modules/shopping/services/price-observations.ts:53`). `price-history.ts` exposes full ordered history and honesty checks, not “latest current price” or “30-day average” (`apps/api/src/modules/shopping/services/price-history.ts:66`). The generator should define its own user-scoped queries, including what counts as current, whether stale observations older than `STALE_DAYS = 7` are ignored (`apps/api/src/modules/shopping/services/price-observations.ts:20`), and how no price data is represented.

- Empty and incomplete data behavior is not defined. For empty pantry, no habit profiles, `consumptionBasePerMonth: null`, `unit: null`, zero consumption, no current prices, or no 30-day average, the plan should say whether generation returns an empty draft, returns no draft, or creates unpriced draft lines. This matters because an empty idempotent draft could block a useful draft later the same day if new pantry or price data is added.

- `shouldReplenish` and `suggestQuantity` need unit/rate guardrails. `suggestQuantity(habitProfile)` uses one month of `consumptionBasePerMonth` (`tasks/079-predictive-cart/TASK.md:48`), but `habit_profiles.consumption_base_per_month` and `unit` are nullable and paired (`apps/api/src/modules/shopping/schema.ts:298`). The generator needs to skip or handle null profiles, mismatched pantry/habit units, and `consumptionBasePerMonth <= 0`, otherwise it may generate invalid rows or crash a whole draft.

- Header `totalPaise` is currently non-null and nonnegative (`apps/api/src/modules/shopping/schema.ts:269`). The plan does not define how it is computed from item prices, substitutions, removed lines, missing prices, or suggested quantities. If `suggestedPricePaise` is a pack price but `quantityBase` is a month’s base quantity, total calculation is ambiguous. This needs a tested rule.

- The “teaching signal” can violate constraints or double-count. `observation_count` has a nonnegative check (`apps/api/src/modules/shopping/schema.ts:309`), while the plan says removal decrements it (`tasks/079-predictive-cart/TASK.md:63`). Clamp at zero or one intentionally, and only decrement on transition from `isRemoved=false` to `true`; repeated PUTs should not keep reducing it. Also define whether removing a substitution decrements the original item profile or substitute profile.

- AC3 conflicts with the existing enum surface. `cart_draft_status` already includes `"ordered"` (`apps/api/src/modules/shopping/schema.ts:265`), while AC3 says status stays `"draft"` and no draft can become an order (`tasks/079-predictive-cart/TASK.md:79`). The implementation must avoid adding any route that sets `"ordered"` and should test that update/delete paths cannot transition to ordered. If `"abandoned"` is allowed by DELETE, AC3 wording should say drafts never become orders/ledger entries, not literally always stay draft.

**Missing Tests**

- The current P6 test list is too pure-function-heavy for this task. Add route/service integration tests for DB persistence: draft header + items insert, item update, abandon draft, ownership checks, backup/export coverage, and idempotent same-day behavior.

- Add edge-case tests for empty pantry, pantry item with no habit profile, habit profile with null rate/unit, no price observations, stale latest observation, no 30-day average, unit mismatch, and all items unpriced.

- Add substitution tests with different pack sizes to prove integer normalized comparison, not raw price comparison.

- Add migration/schema smoke expectations for the new table, checks, indexes, and `apps/api/src/db/schema.ts` export. Backup drift tests should catch `ALL_TABLES` and `LINKED_TABLES`, but the task should explicitly require `cart_draft_items` after `cart_drafts` in `ALL_TABLES` and linked via `{ fk: "cart_draft_id", parent: "cart_drafts" }` (`apps/api/src/modules/system/services/backup.ts:32`, `apps/api/src/modules/system/services/backup.ts:82`).

**Convention Notes**

- Keep all new imports explicit with `.ts`, matching current module style.

- Use generated Drizzle migration workflow only; do not hand-edit metadata.

- Shared schemas must mirror DB pairing constraints for `quantityBase` and `unit`, as existing shopping schemas do.

- For `UpdateCartDraftItemSchema`, decide whether it is full-replace like existing PUT schemas or partial update. Existing PUT contracts deliberately make every field required and avoid defaults.

- All money stays integer paise. For averages, percentage thresholds, unit prices, proportional quantities, and deltas, use integer arithmetic with explicit `Math.floor` where division is unavoidable.