## High

None.

## Medium

1. **Price-chart X-axis labels are corrupted.** `chartDataFromPoints()` emits labels such as `"02 Jan"` ([pantry-view.ts:38](/work/personal/compass/apps/web/src/routes/shopping/pantry-view.ts:38)), but `LineChart` renders axis labels using `label.slice(5)` ([viz.tsx:217](/work/personal/compass/apps/web/src/lib/viz.tsx:217)). Consequently `"02 Jan"` displays as `"n"`. The helper test locks in this incompatible format ([pantry-view.test.ts:33](/work/personal/compass/apps/web/src/routes/shopping/pantry-view.test.ts:33)). AC3’s chart renders values, but its date axis is unusable.

2. **AC1’s per-item estimate basis is not shown.** The UI only gives the page-level statement “Estimated stock from your recorded purchases” ([PantryPage.tsx:22](/work/personal/compass/apps/web/src/routes/shopping/PantryPage.tsx:22)). It omits the available `lastPurchasedAt`, `observationCount`, and `lastComputedAt` basis fields while presenting depletion and consumption estimates ([PantryPage.tsx:74](/work/personal/compass/apps/web/src/routes/shopping/PantryPage.tsx:74)). Users cannot judge the recency or evidence behind an individual estimate.

3. **The acceptance criteria lack the required behavioral tests.** The five helper tests pass, but there are no tests for the pages or new query hooks. In particular, raw 204 handling, pantry/habit invalidation, correction feedback, thin-data refusal, and required `EmptyState` branches are untested. `shopping-queries.test.ts` ends with the older hooks ([shopping-queries.test.ts:179](/work/personal/compass/apps/web/src/lib/shopping-queries.test.ts:179)), contrary to `tasks/TDD.md`’s requirement that every acceptance criterion have a corresponding test.

## Low

1. **A valid zero-price observation produces `Infinity%`.** `honestyVerdict()` divides by `maxObservedPricePaise` without guarding zero ([pantry-view.ts:62](/work/personal/compass/apps/web/src/routes/shopping/pantry-view.ts:62)), while the shared contract permits zero ([shopping.ts:791](/work/personal/compass/packages/shared/src/schemas/shopping.ts:791)). A positive claim against a recorded zero price can therefore render “Infinity% above.”

2. **The “no backend/shared modifications” condition cannot be confirmed from the current change set.** `git status` currently contains numerous modified/untracked `apps/api` files and a modified `packages/shared/src/schemas/shopping.ts`. These may belong to prerequisite or concurrent tasks, but task 080 is not isolated enough to verify the delegation boundary.

## Verification and compliant checks

At final verification, all AC7 commands passed:

- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm run test -w apps/web`: exit 0, 316 tests
- `npm run build -w apps/web`: exit 0

The implementation otherwise correctly uses `States.tsx`, `LineChart`, shared money formatting, `pricePaise` for chart values, raw `fetch` for 204 mutations, and invalidates both pantry and habit query keys. The task-specific hooks are appended after the pre-existing hooks.