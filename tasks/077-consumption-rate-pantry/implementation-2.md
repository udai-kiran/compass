# Task 077 – Codex review fixes (implementation-2)

## Fixes applied

1. **lists.ts bought-transition guard** – Read existing item status before update; `replenishPantry` now fires only when `previousStatus !== "bought"` and new status is `"bought"`.

2. **replenishPantry unit check** – After loading the existing pantry row, added a check: if `existing.unit` is set and differs from the incoming `unit`, throw HTTP 400. Prevents cross-unit replenishment when catalog unit is null.

3. **Integer dampening** – Changed `Math.floor(rate * 0.8 + implied * 0.2)` to `Math.floor((rate * 80 + implied * 20) / 100)` in `correctPantry`. Updated test cases 6 and 7 in `pantry-management.test.ts` to use the same integer formula.

4. **Nullable recompute profile** – `RecomputeHabitResponseSchema.profile` changed to `HabitProfileSchema.nullable()` in `packages/shared`. Route now returns `{ profile: null, purchaseCount }` when no existing profile and insufficient data (instead of synthetic `id: ""`).

## Validation results

- `npm run typecheck` — exit 0, no errors
- `npm run lint` — exit 0, no errors
- `npm run test -w apps/api` — 973 pass, 33 fail (all failures require DATABASE_URL/Redis; pre-existing, unrelated to these fixes). All pantry, habit, and dampening tests pass.
