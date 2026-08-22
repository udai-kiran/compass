# Shopping Module Investigation (Task 082/083 Receipt Loop Planning)

## 1. Module Structure

Location: `/work/personal/compass/apps/api/src/modules/shopping/`
- schema.ts: 20K (10 resident tables + 6 enums)
- services/: 276K
- routes/: 296K (16 route files)
- plugin.ts: 4.0K

## 2. Database Schema Tables

**File:** `apps/api/src/modules/shopping/schema.ts` (lines 95–376)

Core tables:
1. **catalogItems** (line 95): canonical purchasable items
2. **priceSources** (line 119): shopping platforms/stores
3. **shoppingLists** (line 146), **shoppingListItems** (line 169)
4. **priceObservations** (line 196): price history
5. **pantryItems** (line 233): household inventory
6. **cartDrafts** (line 258), **cartDraftItems** (line 281): predicted carts (task 11.2)
7. **habitProfiles** (line 319): consumption rates (task 11.1)
8. **serviceabilityChecks** (line 354): pincode delivery checks (task 10.2)

## 3. Routes Registered (plugin.ts, lines 29–45)

- shoppingCaptureRoutes, **shoppingCaptureImageRoutes** (photo capture, task 9.5)
- shoppingCartDraftRoutes, checkoutRecommendationRoutes
- financialGuardRoutes, shoppingPantryRoutes, shoppingHabitProfileRoutes
- shoppingListRoutes, shoppingCatalogRoutes, shoppingPriceSourceRoutes
- shoppingPriceObservationRoutes, shoppingPriceHistoryRoutes
- shoppingServiceabilityRoutes, shoppingArbitrageRoutes, shoppingUnitRoutes

## 4. Cart Draft Schema

**cart_drafts** (lines 258–278): id, user_id, status ("draft"|"ordered"|"abandoned"), price_source_id, total_paise, generated_at

**cart_draft_items** (lines 281–309): id, cart_draft_id, catalog_item_id, quantity_base, unit, reason, suggested_price_paise, suggested_source_id, substitution_for_item_id, price_delta_paise, is_removed

## 5. Photo Capture Routes

**File:** `routes/capture-image.ts`
- POST `/parse-image` (multipart/form-data): JPEG/PNG/WebP upload
  - Magic-byte validation (lines 35–50)
  - Calls `parseListImage` (task 9.5, vision-capable AI)
  - Response: ParseListImageResponseSchema (reviewable items)
  - NO receipt parsing — shopping-list photos only

**Service:** `services/parse-image.ts`
- Uses AI provider (vision) + Storage abstraction (transient)
- Extracts item name, qty, unit from photo
- Deletes image after processing

## 6. Cart Draft Routes

**File:** `routes/cart-drafts.ts`
- POST `/drafts/generate` — generates predictive cart (task 11.2)
- GET `/drafts`, GET `/drafts/:id`
- PUT `/drafts/:id/items/:itemId` — update qty/unit/is_removed; recalculates total
- DELETE `/drafts/:id` — mark abandoned

## 7. Financial Guards

**Routes:** `routes/financial-guards.ts`
- GET `/guards/check?cartTotalPaise=...&categoryId=...&emiOffers=[...]`
  - Response: budget, goals, emi breakdowns (read-only, demo-safe)

**Service:** `services/financial-guards.ts`
- calculateBudgetCap(), calculateGoalImpacts(), decomposeEmi()

## 8. Cart Draft Generator Service

**File:** `services/cart-draft-generator.ts`
- shouldReplenish(): checks if item due (depletion + 7 days)
- suggestQuantity(): calculates replenishment from habits
- isPriceSpiked(): detects 120% price threshold
- calculateDraftTotalPaise(): sums cart value
- decrementObservationCount(): teaching signal for removals

## 9. Web Layer

**Routes:** `apps/web/src/routes/shopping/`
- CapturePanel.tsx (13 KB) — image/text capture UI
- ListsPage.tsx (26 KB), CartPage.tsx, PantryPage.tsx, PriceWatchPage.tsx

**Hooks:** `apps/web/src/lib/shopping-queries.ts` (351 lines)
- useShoppingUnits, useShoppingLists, useShoppingCatalog
- useParseText, useParseImage (list capture)
- usePantryItems, useHabitProfiles
- usePriceSources, usePriceHistory, useBuyWait, useHonestyCheck

## 10. Key Findings for Task 082/083

✓ Cart drafts exist with full item tracking
✓ Photo list capture exists (task 9.5), AI-powered
✓ Financial guards exist (budget/goal/EMI checks, read-only)
✓ Image storage + AI infrastructure in place

✗ NO receipt parsing, OCR, or transaction extraction yet
✗ NO receipts table
✗ Photo route only handles shopping-list photos, not receipts

**Task 082 will need:**
- New `receipts` table (or extend cartDrafts with receipt_source)
- Receipt image parsing service (distinct from list parsing)
- Receipt-to-draft pipeline (auto-extract line items, map to catalog)
- Post-purchase validation (financial guards on actual purchase)
