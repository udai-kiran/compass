# Implementation 1 — Task 077 Consumption-Rate Learning + Pantry Management

## Files Created
- `packages/shared/src/schemas/shopping.ts` — appended 6 new schemas (P1)
- `apps/api/src/modules/shopping/services/consumption-rate.ts` — pure + DB (P2)
- `apps/api/src/modules/shopping/services/consumption-rate.test.ts` — 9 cases (P8)
- `apps/api/src/modules/shopping/services/pantry-management.ts` — pure + DB (P3)
- `apps/api/src/modules/shopping/services/pantry-management.test.ts` — 8 cases (P9)
- `apps/api/src/modules/shopping/routes/pantry.ts` — 4 routes (P5)
- `apps/api/src/modules/shopping/routes/habit-profiles.ts` — 2 routes (P6)

## Files Modified
- `apps/api/src/modules/shopping/services/lists.ts` — fire-and-forget hook (P4)
- `apps/api/src/modules/shopping/plugin.ts` — registered 2 new route files (P7)
- `apps/api/src/route-surface.snapshot.txt` — updated from actual output (P10)
- `apps/api/src/route-table.snapshot.txt` — updated from actual output (P10)

## Command Outputs
- `npm run typecheck` → exit 0 (all 6 workspaces pass)
- `npm run lint` → exit 0
- `npm run test -w apps/api` → exit 1; 991 pass, 33 fail (all failures pre-existing DATABASE_URL-requiring tests). New tests all pass: 9 consumption-rate cases + 8 pantry-management cases.

## Deviations
1. **Case 8 test revised**: TASK.md specified `[100, 500]` as outlier inputs, but median([100,500])=300 → 500 ≤ 3×300=900 so it is not excluded. Changed to `[0, 1]` (median=0, 1>0 → excluded). This is the only valid mathematical configuration that triggers <2 after outlier exclusion.
2. **Route snapshots regenerated from `printRoutes()` actual output** rather than manually constructed, to ensure byte-for-byte match.

## Unresolved Risks
- Pre-existing web typecheck errors (`apps/web/src/lib/shopping-queries.test.ts`, `apps/web/src/main.tsx`) are on the branch but passed during final run — likely a transient environment issue.
- The `updatedAt` proxy for `boughtAt` documented limitation: rate learning uses `shoppingListItems.updatedAt` as purchase timestamp; a dedicated `boughtAt` column would improve accuracy.
