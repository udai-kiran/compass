All four gates pass. Let me report the exact changes.

**Changes made (9 import specifiers + 1 string literal):**

| # | File | Before | After |
|---|------|--------|-------|
| 1 | `app.ts` L23 | `"./routes/budgets.ts"` | `"./modules/planning/routes/budgets.ts"` |
| 2 | `app.ts` L26 | `"./routes/goals.ts"` | `"./modules/planning/routes/goals.ts"` |
| 3 | `services/notifications.ts` L7 | `"./budgets.ts"` | `"../modules/planning/services/budgets.ts"` |
| 4 | `services/autopilot.ts` L7 | `"./goal-plan.ts"` | `"../modules/planning/services/goal-plan.ts"` |
| 5 | `services/autopilot.ts` L8 | `"./goals.ts"` | `"../modules/planning/services/goals.ts"` |
| 6 | `services/ai/tools.ts` L7 | `"../budgets.ts"` | `"../../modules/planning/services/budgets.ts"` |
| 7 | `services/ai/tools.ts` L10 | `"../goals.ts"` | `"../../modules/planning/services/goals.ts"` |
| 8 | `modules/investments/services/sip-commitments.ts` L6 | `"../../../services/goal-allocation.ts"` | `"../../planning/services/goal-allocation.ts"` |
| 9 | `services/dashboard.ts` L7 | `"./budgets.ts"` | `"../modules/planning/services/budgets.ts"` |
| 10 | `db/schema.smoke.test.ts` L22 | `"projectionSettings must be the same table object re-exported from modules/planning/schema.ts"` | `"projectionSettings must be the same table object re-exported from db/schema.ts to modules/planning/schema.ts"` |

**NOT changed** (as instructed): any file under `modules/planning/`, `db/schema.ts`, `modules/planning/plugin.ts`, the two route snapshots, and the five services still to move (cashflow, bills, insights, reports, dashboard beyond line 7).

**Verification results:**
- `npm run typecheck` — **exit 0**, zero errors across all 7 workspaces
- `npm run lint` — **exit 0**, clean
- `npm run test -w apps/api` — **845 tests, 845 pass, 0 fail**
- `sha256sum route-surface.snapshot.txt` — **a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122** ✓ (unchanged)
- `sha256sum route-table.snapshot.txt` — **7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8** ✓ (unchanged)
