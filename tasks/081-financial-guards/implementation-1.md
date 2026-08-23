Implemented P1–P7.

Files created:

- `apps/api/src/modules/shopping/services/financial-guards.ts`
- `apps/api/src/modules/shopping/services/financial-guards.test.ts`
- `apps/api/src/modules/shopping/routes/financial-guards.ts`

Files modified:

- `packages/shared/src/schemas/shopping.ts`
- `apps/api/src/modules/planning/services/goals.ts`
- `apps/api/src/modules/shopping/plugin.ts`
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`

Changes made:

- Added shared financial-guard Zod contracts: GET query coercion, request, budget, goal impact, EMI, and response schemas.
- Extracted side-effect-free `getGoalProjectionInputs()` and made `getGoalProgress()` use it before separately retaining milestone behavior.
- Added live budget-envelope checks, pure goal-impact calculations, and EMI decomposition.
- EMI uses `annualRateBps`, `standardEmiPaise`, the repository’s actual five-argument `amortize()` signature, and `BigInt` processing-fee arithmetic.
- Added `GET /api/shopping/guards/check`; it is read-only and derives EMI offer indexes server-side.
- Registered the route and regenerated both route snapshots.
- Added tests for budget rollover/overage/no-budget handling, goal impact states/allocation, EMI reconciliation/zero-rate/large-fee arithmetic, and schemas.

Commands run and results:

- `node --import tsx --test apps/api/src/modules/shopping/services/financial-guards.test.ts`  
  Passed: 5 tests.
- `node --import tsx --test apps/api/src/app.route-snapshot.test.ts`  
  Passed: 7 tests.
- `npm run typecheck -w apps/api`  
  Passed.
- `npm run typecheck`  
  Passed for all workspaces.
- `npm run lint`  
  Passed.
- `npm run test -w apps/api`  
  Ran 1,011 tests: 977 passed, 1 skipped, 33 failed because `DATABASE_URL` is not configured and the repository’s DB-backed tests intentionally refuse to run without it. The new guard tests and route snapshot tests passed within that run.
- `git diff --check`  
  Reported pre-existing trailing whitespace in `tasks/075-reward-aware-checkout/review-3.md`; no task-081 file whitespace errors.

Issues/risks/deviations:

- Full API verification remains blocked by the missing local `DATABASE_URL`/real Postgres setup; no task status was changed.
- The working tree contained unrelated pre-existing shopping, UI, task, and snapshot changes; these were preserved.