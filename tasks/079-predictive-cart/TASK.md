# Task: 079 — Predictive Replenishment Cart Drafts (task 11.2)

## Status
COMPLETE

## Review-2 Findings (addressed)
- M1: Zero consumptionBasePerMonth → skip (guard added)
- M2: Concurrent idempotency race → accepted as known limitation (single-user app)
- M3: Teaching signal for substitutions → fixed (use substitutionForItemId ?? catalogItemId)
- M4: deltaPaise raw vs unit-normalized → fixed (uses usualUnitPrice - candidateUnitPrice)
- All 11 tests pass, typecheck + lint green

## Objective
Build a cart draft generation engine that proposes items to buy before the user runs out, based on the pantry model and learned consumption rates from task 077 (11.1). Includes substitution suggestions when the usual brand spikes in price. A draft is a proposal only — never ordered, never auto-accepted.

## Root Cause
`cart_drafts` header table exists but has no lines table and no generation logic. No substitution detection exists.

## Codex Review Findings (review-1, addressed)
- F1: catalogItemId must be nullable for onDelete: set null → fixed
- F2: Idempotency race → use transaction; check existing draft in same txn
- F3: Ownership/IDOR → add assertOwnedDraft helper for all draft routes
- F4: Substitution must use unit-normalized prices (pricePaise / packQuantityBase) not raw → use integer unitPrice = Math.floor(pricePaise * 1000 / packQuantityBase) to compare
- F5: Need latest-price and 30-day average queries → define in generator service
- F6: Empty data (no pantry, no habits, no prices) → return empty draft (0 items), not error
- F7: Null/zero rate in habitProfile → skip item, don't crash
- F8: totalPaise = sum of suggestedPricePaise across non-removed items
- F9: Teaching signal clamp at 0; only decrement on false→true transition
- F10: AC3 clarified: status can be 'draft' or 'abandoned', never 'ordered'

## Scope

### Schema changes needed
- Add `cart_draft_items` table to `modules/shopping/schema.ts`:
  - id, cartDraftId FK (cascade), catalogItemId FK (set null, NULLABLE), quantityBase, unit (paired), reason (text), suggestedPricePaise (nullable — null when no price data), suggestedSourceId FK (set null, nullable), substitutionForItemId (uuid nullable — catalog item this substitutes, no FK), priceDeltaPaise (nullable), isRemoved (boolean default false), createdAt
- Add `cart_draft_items` to backup.ts (LINKED_TABLES under cart_drafts: { fk: "cart_draft_id", parent: "cart_drafts" })
- Add `db/schema.ts` barrel re-export

### New files
- `apps/api/src/modules/shopping/services/cart-draft-generator.ts` — generation engine
- `apps/api/src/modules/shopping/services/cart-draft-generator.test.ts` — unit tests
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` — CRUD routes

### Modified files
- `apps/api/src/modules/shopping/schema.ts` — add cartDraftItems table
- `apps/api/src/db/schema.ts` — re-export cartDraftItems
- `apps/api/src/modules/system/services/backup.ts` — add cart_draft_items
- `packages/shared/src/schemas/shopping.ts` — add CartDraftItem, CartDraftWithItems, GenerateDraftResponse schemas
- `apps/api/src/modules/shopping/plugin.ts` — register route
- Route snapshots

## Dependencies
- task 077 (11.1) — pantry + habit profiles (MUST complete first)
- task 10.1 (price observations, done)

## Plan
- P1: Schema migration — add `cart_draft_items` table with CHECK constraints (quantity_unit_paired, quantity_nonneg), FK to cart_drafts (cascade), FK to catalog_items (set null), FK to price_sources (set null). Run `npm run db:generate` + `npm run db:migrate`
- P2: Add shared Zod schemas:
  - `CartDraftItemSchema` — response shape
  - `CartDraftWithItemsSchema` — CartDraftSchema extended with items array
  - `GenerateDraftResponseSchema` — { draft: CartDraftWithItemsSchema, generated: number, substitutions: number }
  - `UpdateCartDraftItemSchema` — { quantityBase, unit, isRemoved }
- P3: Implement `cart-draft-generator.ts`:
  - `DEPLETION_WINDOW_DAYS = 7` — items expected to run out within 7 days
  - `PRICE_SPIKE_PCT = 120` — price >120% of 30-day average = spike
  - `shouldReplenish(pantryItem, habitProfile, now)` → boolean (pure): true if expectedDepletionAt <= now + DEPLETION_WINDOW_DAYS or quantityBase is 0/null
  - `suggestQuantity(habitProfile)` → { quantityBase, unit } — one month's supply (consumptionBasePerMonth), integer
  - `detectPriceSpike(db, userId, catalogItemId, sourceId)` → { isSpiked, currentPricePaise, avgPricePaise, deltaPaise } — compare latest observation to 30-day avg
  - `findSubstitution(db, userId, catalogItemId, unit)` → { substituteCatalogItemId, pricePaise, sourceId, deltaPaise } | null — find same-unit catalog item with lower current price
  - `generateDraft(db, userId)` → CartDraftWithItems:
    - Load pantry items + habit profiles
    - For each: check shouldReplenish → if yes, add to draft
    - For each draft item: check price spike → if spiked, find substitution
    - Idempotency: if a draft with status='draft' already exists for today (generatedAt same calendar day), return it instead of creating a new one
    - Create cart_drafts header + cart_draft_items
- P4: Routes:
  - `POST /drafts/generate` — trigger generation, return draft
  - `GET /drafts` — list user's drafts (newest first)
  - `GET /drafts/:id` — single draft with items
  - `PUT /drafts/:id/items/:itemId` — update item (edit qty or mark removed → isRemoved=true)
  - `DELETE /drafts/:id` — abandon draft (set status='abandoned')
  - When isRemoved=true: decrease habit profile observationCount by 1 (teaching signal — user doesn't want this item suggested)
- P5: Register in plugin.ts, update snapshots
- P6: Tests (pure functions):
  1. Item with expectedDepletion in 3 days → shouldReplenish = true
  2. Item with expectedDepletion in 10 days → shouldReplenish = false
  3. Item with null quantity (empty) → shouldReplenish = true
  4. suggestQuantity returns one month's supply as integer
  5. Price at 125% of avg → isSpiked = true
  6. Price at 110% of avg → isSpiked = false
  7. Idempotency: second generate same day returns same draft
  8. Removed item decreases observation count (teaching signal)
- P7: Backup registration for cart_draft_items

## Acceptance Criteria
- AC1: Drafts generated from pantry + rates; each item has a reason string
- AC2: Draft is fully editable; removing an item teaches the model (observationCount--)
- AC3: No draft can become an order or ledger entry without explicit user action (status stays 'draft')
- AC4: Substitution suggested when price >120% of 30-day average, with price delta stated
- AC5: Draft generation is idempotent — repeated runs same day return same draft
- AC6: Integer paise, integer quantities, all math uses Math.floor
- AC7: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0 with all test cases visible

## Non-Goals
- Scheduled job for auto-generation (manual trigger via route)
- UI for cart drafts (task 12.2)
- Budget/goal integration (task 11.3)
