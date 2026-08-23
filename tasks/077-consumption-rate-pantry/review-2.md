**Findings**

1. [apps/api/src/modules/shopping/services/lists.ts](/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts:241) fires pantry replenishment whenever the submitted status is `"bought"`, not only on a transition to bought. The service does not read the previous item status before updating, so repeating a PUT on an already-bought item or editing its text/quantity while keeping `"bought"` will add stock again. This violates P4/AC9 and can corrupt pantry quantities.

2. [apps/api/src/modules/shopping/services/pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:80) validates replenish units only against the catalog unit. If the catalog unit is null but an existing pantry row has unit `"g"`, a replenish with `"ml"` is accepted and overwrites the pantry unit. P3/AC8 require incoming unit mismatch against existing pantry/catalog unit to return 400.

3. [apps/api/src/modules/shopping/services/pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:222) uses floating-point arithmetic for dampening: `* 0.8` and `* 0.2`. The tests repeat the same float formula at [pantry-management.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.test.ts:55). This violates AC6’s integer-only arithmetic requirement. Use integer weights, e.g. `Math.floor((existing * 80 + implied * 20) / 100)`.

4. [apps/api/src/modules/shopping/routes/habit-profiles.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/habit-profiles.ts:111) returns a synthetic profile with `id: ""` when recompute has insufficient data and no existing profile. That does not satisfy `HabitProfileSchema` because `id` must be a UUID, so the route can fail response validation instead of returning the declared `RecomputeHabitResponseSchema`. This breaks P6 and the `<2 purchases → no confident rate` recompute path.

**P / AC Check**

P1 done. P2 mostly done. P3 partial: replenish unit mismatch and float dampening issues. P4 partial: hook is fire-and-forget, but not transition-only. P5 done. P6 partial: recompute insufficient-data response is invalid. P7 done. P8 done: 9 cases present. P9 present: 8 cases, but dampening tests duplicate math rather than exercising service behavior. P10 done: route snapshots include pantry/habit routes.

AC1 mostly met in pure service, but recompute route has invalid no-profile response. AC2 met. AC3 partially met, blocked by float arithmetic and limited test coverage. AC4 met. AC5 met for catalog-specific writes; reads are user-scoped. AC6 not met due dampening floats. AC7 met. AC8 not fully met for replenish with existing pantry unit. AC9 not met because repeated bought updates replenish again. AC10 partially verified.

**Verification**

`npm run typecheck` passed. `npm run lint` passed. The two new pure test files passed with 17 tests. `npm run test -w apps/api` could not complete in this environment because unrelated DB-backed suites require `DATABASE_URL`; the new consumption/pantry tests were visible and passed in that run before the overall command failed.