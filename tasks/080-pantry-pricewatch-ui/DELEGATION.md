# Sonnet Worker Delegation — Iteration 1

## Task
080 — Pantry & Price Watch UI (task 12.3)

## Approved Plan
- P1: Write pantry-view helpers + tests (TDD — before pages)
- P2: Extend shopping-queries.ts with pantry + price-watch hooks
- P3: Build PantryPage (replace placeholder)
- P4: Build PriceWatchPage (replace placeholder)
- P5: Verify typecheck + lint + test + build

## Files and Symbols

### Reference files (read first)
- `tasks/080-pantry-pricewatch-ui/TASK.md` — full spec with review findings
- `apps/web/src/lib/shopping-queries.ts` — existing hooks (DO NOT remove any)
- `apps/web/src/lib/api.ts` — apiGet, apiPost, apiPut, apiDelete, ApiError
- `apps/web/src/lib/viz.tsx` — LineChart, Sparkline, compactINR, SERIES colors
- `apps/web/src/components/States.tsx` — PageLoading, PageError, EmptyState
- `apps/web/src/routes/shopping/PantryPage.tsx` — current placeholder to replace
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` — current placeholder to replace
- `packages/shared/src/schemas/shopping.ts` — all response schemas
- `packages/shared/src/money.ts` — formatINR, compactINR (shared)

### New files to create
- `apps/web/src/routes/shopping/pantry-view.ts` — pure view-model helpers
- `apps/web/src/routes/shopping/pantry-view.test.ts` — tests for view helpers

### Files to modify
- `apps/web/src/routes/shopping/PantryPage.tsx` — replace placeholder with full UI
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` — replace placeholder with full UI
- `apps/web/src/lib/shopping-queries.ts` — add new hooks (append, preserve existing)

## Required Changes

### 1. pantry-view.ts — Pure helpers

```ts
/** Format depletion estimate as human-readable string. */
export function formatDepletionEstimate(
  expectedDepletionAt: Date | null,
  now: Date,
): string
// Returns: "depleted" if null or past, "3 days", "2 weeks", "1 month", etc.
// Use integer day diff: Math.floor((depletion - now) / 86_400_000)

/** Format consumption rate for display. */
export function formatConsumptionRate(
  rate: number | null,
  unit: string | null,
): string
// Returns: "500 g/month", "2 piece/month", or "—" if null

/** Prepare chart data from PriceHistoryPoint[]. */
export function chartDataFromPoints(
  points: Array<{ pricePaise: number; observedAt: Date }>,
): { labels: string[]; values: number[] }
// Sort by date, labels = date strings "DD MMM", values = pricePaise (integer only)
// DO NOT use unitPricePaisePerBase (can be fractional)

/** Human-readable trend label. */
export function trendLabel(
  trend: string,
  confidence: string,
): string
// "Rising (high confidence)", "Stable", "Not enough data", etc.

/** Honesty check verdict string. */
export function honestyVerdict(
  flagged: boolean,
  maxObservedPricePaise: number | null,
  claimedMrpPaise: number,
): string
// "⚠ Claimed ₹X is XX% above highest observed ₹Y" or "✓ Price appears fair"
// Use formatINR from @compass/shared for amounts
```

### 2. pantry-view.test.ts — Tests (TDD)

Test all 5 helpers above with edge cases:
1. formatDepletionEstimate: future 3 days, future 2 weeks, past/depleted, null
2. formatConsumptionRate: 500g, null rate, null unit
3. chartDataFromPoints: sorted output, empty array, single point
4. trendLabel: all 4 trend values × confidence combos
5. honestyVerdict: flagged true/false, null maxObserved

### 3. shopping-queries.ts — New hooks (APPEND ONLY)

Add these hooks AFTER the existing code. DO NOT modify or remove anything existing.

```ts
// ─── Pantry queries (task 12.3) ──────────────────────────────────────────────

/** Fetch pantry items with habit profiles. */
export function usePantryItems() {
  return useQuery({
    queryKey: ["shopping", "pantry"] as const,
    queryFn: () => apiGet("/api/shopping/pantry", PantryListResponseSchema),
  });
}

/** Fetch all habit profiles. */
export function useHabitProfiles() {
  return useQuery({
    queryKey: ["shopping", "habits"] as const,
    queryFn: () => apiGet("/api/shopping/habits", HabitProfileListResponseSchema),
  });
}

/**
 * Pantry mutations — correct and replenish.
 * CRITICAL: Both return 204 with no body. Use raw fetch, not apiPost.
 * On success, invalidate both ["shopping", "pantry"] and ["shopping", "habits"].
 */
export function usePantryMutations() {
  const qc = useQueryClient();

  function invalidatePantry() {
    void qc.invalidateQueries({ queryKey: ["shopping", "pantry"] });
    void qc.invalidateQueries({ queryKey: ["shopping", "habits"] });
  }

  const correct = useMutation({
    mutationFn: async ({ catalogItemId, body }: { catalogItemId: string; body: CorrectPantry }) => {
      const res = await fetch(`/api/shopping/pantry/${catalogItemId}/correct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const b: unknown = await res.json();
          if (typeof b === "object" && b !== null && "message" in b)
            message = String((b as { message: unknown }).message);
        } catch { /* empty */ }
        throw new ApiError(res.status, message);
      }
    },
    onSuccess: () => invalidatePantry(),
  });

  const replenish = useMutation({
    mutationFn: async ({ catalogItemId, body }: { catalogItemId: string; body: ReplenishPantry }) => {
      const res = await fetch(`/api/shopping/pantry/${catalogItemId}/replenish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          const b: unknown = await res.json();
          if (typeof b === "object" && b !== null && "message" in b)
            message = String((b as { message: unknown }).message);
        } catch { /* empty */ }
        throw new ApiError(res.status, message);
      }
    },
    onSuccess: () => invalidatePantry(),
  });

  return { correct, replenish };
}

// ─── Price Watch queries (task 12.3) ──────────────────────────────────────────

/** Fetch all price sources (for name resolution). */
export function usePriceSources() {
  return useQuery({
    queryKey: ["shopping", "sources"] as const,
    queryFn: () => apiGet("/api/shopping/sources", z.array(PriceSourceSchema)),
    staleTime: 5 * 60_000,
  });
}

/** Fetch price history for a catalog item. */
export function usePriceHistory(itemId: string | null, sourceId?: string) {
  const qs = sourceId ? `?sourceId=${sourceId}` : "";
  return useQuery({
    queryKey: ["shopping", "price-history", itemId, sourceId ?? null] as const,
    queryFn: () => apiGet(`/api/shopping/catalog/${itemId!}/price-history${qs}`, PriceHistoryResponseSchema),
    enabled: !!itemId,
  });
}

/** Fetch buy-now-vs-wait recommendation. */
export function useBuyWait(itemId: string | null, sourceId?: string) {
  const qs = sourceId ? `?sourceId=${sourceId}` : "";
  return useQuery({
    queryKey: ["shopping", "buy-wait", itemId, sourceId ?? null] as const,
    queryFn: () => apiGet(`/api/shopping/catalog/${itemId!}/buy-wait${qs}`, BuyNowVsWaitSchema),
    enabled: !!itemId,
  });
}

/**
 * Fetch honesty check for a claimed MRP. Only fires when claimedMrpPaise > 0.
 * Route is GET with query params (not POST).
 */
export function useHonestyCheck(
  itemId: string | null,
  claimedMrpPaise: number,
  sourceId?: string,
) {
  const params = new URLSearchParams();
  params.set("claimedMrpPaise", String(claimedMrpPaise));
  if (sourceId) params.set("sourceId", sourceId);
  return useQuery({
    queryKey: ["shopping", "honesty", itemId, claimedMrpPaise, sourceId ?? null] as const,
    queryFn: () => apiGet(
      `/api/shopping/catalog/${itemId!}/honesty-check?${params.toString()}`,
      PriceHonestyResultSchema,
    ),
    enabled: !!itemId && claimedMrpPaise > 0,
  });
}
```

Add the necessary imports at the top of shopping-queries.ts:
```ts
import {
  // ... existing imports ...
  PantryListResponseSchema,
  HabitProfileListResponseSchema,
  PriceSourceSchema,
  PriceHistoryResponseSchema,
  BuyNowVsWaitSchema,
  PriceHonestyResultSchema,
  type CorrectPantry,
  type ReplenishPantry,
} from "@compass/shared";
```

### 4. PantryPage.tsx — Full implementation

Replace the placeholder. Key points:
- Use `usePantryItems()` to load items
- `PageLoading` while loading, `PageError` on error
- `EmptyState` when items array is empty: title="No pantry items", hint="Items appear here when you mark them bought on a shopping list."
- For each item, show:
  - canonicalName (bold) + brand (muted, if not null)
  - Stock: quantityBase + unit (or "Empty" if null)
  - Depletion estimate: use `formatDepletionEstimate(item.expectedDepletionAt, new Date())`
  - Consumption rate: use `formatConsumptionRate(item.consumptionBasePerMonth, item.consumptionUnit)`
  - If consumptionBasePerMonth is null: show "Not enough purchase history" instead of rate
- Correction control per item:
  - Number input for quantity + unit display (read-only, from item.unit or default "g")
  - "Update" button → calls `correct.mutate({ catalogItemId, body: { quantityBase, unit } })`
  - Show feedback after mutation (success/error)
  - On success: pantry + habits are invalidated → AC2 visibly updates the rate
- Layout: responsive cards/rows, max-w-3xl

### 5. PriceWatchPage.tsx — Full implementation

Replace the placeholder. Key points:
- **Item selector**: use `useShoppingCatalog()` to get catalog items, render as a dropdown/searchable list
- `EmptyState` when no catalog items exist: title="No catalog items", hint="Add items to your catalog first."
- When an item is selected:
  - **Price chart**: `usePriceHistory(itemId)` → convert points with `chartDataFromPoints` → render with `LineChart`
    - Use pricePaise only (integer), never unitPricePaisePerBase
    - Y-axis uses compactINR (LineChart does this automatically via viz.tsx)
    - `EmptyState` if points.length === 0: title="No price observations", hint="Record prices to see trends."
  - **Source name resolution**: Use `usePriceSources()` to map sourceId → name for display
  - **Buy-now-vs-wait**: `useBuyWait(itemId)` → display using `trendLabel(trend, confidence)`
    - When trend === "insufficient_data": show "Not enough data (X observations, Y distinct days; need 5 obs, 3 days)"
    - When trend !== "insufficient_data" and recommendationPaise !== null: show formatted recommendation
    - Do NOT confuse "stable" with "insufficient_data"
  - **Honesty check**:
    - Input for claimed MRP (paise): number input with "₹" prefix, convert to paise (* 100)
    - "Check" button fires useHonestyCheck query
    - Show `honestyVerdict(flagged, maxObservedPricePaise, claimedMrpPaise)`
    - Show evidence observations list (from evidence array)
    - `EmptyState` if maxObservedPricePaise === null: title="No price data", hint="Record prices first to check honesty."
- Layout: sections stacked vertically, max-w-3xl

## Must Not Change
- Any backend file (apps/api/)
- Any packages/shared/ file
- Existing hooks/queries in shopping-queries.ts (only append)
- apps/web/src/main.tsx
- apps/web/src/layouts/AppLayout.tsx
- apps/web/src/components/icons.tsx

## Commands
1. `npm run test -w apps/web` — exit 0 (pantry-view tests pass)
2. `npm run typecheck` — exit 0
3. `npm run lint` — exit 0
4. `npm run build -w apps/web` — exit 0

## Required Evidence
- Files created/modified
- All 4 commands with exit codes
- Test case names and results
- Deviations

Write findings to `tasks/080-pantry-pricewatch-ui/implementation-1.md` (max 20 lines).
