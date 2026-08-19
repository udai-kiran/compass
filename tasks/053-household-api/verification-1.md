# Verification — Task 053: Household API Routes

## Files Inspected
- `packages/shared/src/schemas/household.ts` (existing)
- `apps/api/src/modules/household/schema.ts`
- `apps/api/src/modules/household/services/households.ts`
- `apps/api/src/modules/household/services/membership.ts`
- `apps/api/src/modules/household/services/settlements.ts`
- `apps/api/src/modules/household/services/splits.ts` (existing, modified)
- `apps/api/src/app.ts` (existing, modified)
- `apps/api/src/route-surface.snapshot.txt` (existing, modified)
- `apps/api/src/route-table.snapshot.txt` (existing, modified)
- `apps/api/src/app.route-snapshot.test.ts`
- `apps/api/src/db/index.ts`
- `apps/api/src/lib/errors.ts`

## Files Changed

### Created
- `packages/shared/src/schemas/household.ts` — added SplitRuleSchema, HouseholdSplitShareSchema, HouseholdSplitSchema, CreateHouseholdSplitSchema, UpdateHouseholdSplitSchema, SettlementSchema, CreateSettlementSchema, HouseholdBalancesSchema
- `apps/api/src/modules/household/services/grants.ts` — createGrant, revokeGrant, listGrants
- `apps/api/src/modules/household/routes/households.ts` — householdCrudRoutes (GET/POST/GET/:id/PATCH/:id/DELETE/:id)
- `apps/api/src/modules/household/routes/membership.ts` — membershipRoutes (POST invite/accept/leave, GET members, DELETE members/:memberId)
- `apps/api/src/modules/household/routes/sharing.ts` — sharingRoutes (POST/GET /api/sharing-grants, DELETE /api/sharing-grants/:id)
- `apps/api/src/modules/household/routes/splits.ts` — splitRoutes (POST /api/transactions/:txId/split, GET/PATCH/DELETE /api/splits/:id, GET /api/households/:id/balances)
- `apps/api/src/modules/household/routes/settlements.ts` — settlementRoutes (POST/GET /api/households/:id/settlements)
- `apps/api/src/modules/household/plugin.ts` — householdRoutes plugin registering all 5 route files

### Modified
- `apps/api/src/modules/household/services/splits.ts` — added getSplit, updateSplit; converted all `throw new Error(...)` to `throw new HttpError(...)` in createSplit and deleteSplit
- `apps/api/src/app.ts` — imported householdRoutes, registered after automationRoutes
- `apps/api/src/route-surface.snapshot.txt` — regenerated with 313 routes (was ~273)
- `apps/api/src/route-table.snapshot.txt` — regenerated with new route tree

## Implementation Details

### Name conflict resolution
`SplitSchema` and `Split` already existed in `packages/shared/src/schemas/ledger.ts` (transaction category splits). Renamed the household equivalents to `HouseholdSplitSchema`/`HouseholdSplit`, `HouseholdSplitShareSchema`/`HouseholdSplitShare`, `CreateHouseholdSplitSchema`/`CreateHouseholdSplit`, `UpdateHouseholdSplitSchema`/`UpdateHouseholdSplit`.

### assertMember helper
Defined inline in each of routes/sharing.ts, routes/splits.ts, and routes/settlements.ts (they all import `householdMembers` from the schema and use `and/eq` from drizzle-orm).

### Snapshot update method
Ran a Node.js script to register all routes in a hermetic Fastify instance (no DB/Redis), capture `onRoute` pairs and `printRoutes()` output, then write both files. Then re-ran the snapshot tests to confirm byte-for-byte match.

## Commands Run

```
npm run typecheck 2>&1 | tail -60
# Exit code: 1 (name conflict SplitSchema/Split)

# After renaming to HouseholdSplit*:
npm run typecheck 2>&1 | tail -20
# Exit code: 0

node --test apps/api/src/app.route-snapshot.test.ts 2>&1
# Exit code: 1 (snapshots outdated as expected)

node --input-type=module <<'EOF' (snapshot regeneration script)
# Wrote both snapshot files

node --test apps/api/src/app.route-snapshot.test.ts 2>&1
# Exit code: 0 (7/7 pass)
```

## Route Snapshot Test Output (final)

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (95.479851ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (24.94681ms)
✔ assertRouteTableMatches rejects an added route (0.187678ms)
✔ assertRouteTableMatches rejects a removed route (0.070184ms)
✔ assertRouteTableMatches rejects a renamed route (0.058312ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.060996ms)
✔ assertRouteTableMatches accepts identical tables (0.092446ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 854.877957
```

## Typecheck Output (final)

All 6 workspaces pass tsc --noEmit with exit code 0. No errors.

## New Routes Verified in Snapshot (20 non-HEAD routes)

DELETE /api/households/:id  
DELETE /api/households/:id/members/:memberId  
DELETE /api/sharing-grants/:id  
DELETE /api/splits/:id  
GET /api/households  
GET /api/households/:id  
GET /api/households/:id/balances  
GET /api/households/:id/members  
GET /api/households/:id/settlements  
GET /api/sharing-grants  
GET /api/splits/:id  
PATCH /api/households/:id  
PATCH /api/splits/:id  
POST /api/households  
POST /api/households/:id/invite  
POST /api/households/:id/leave  
POST /api/households/:id/settlements  
POST /api/households/invites/accept  
POST /api/sharing-grants  
POST /api/transactions/:txId/split  

## Assumptions
- `HouseholdSplit*` prefix naming for shared schemas is acceptable given the existing ledger `Split`/`SplitSchema` conflict. The delegation named them `SplitSchema`/`Split` but those names were already taken.
- `removeMember` in membership.ts takes a `targetUserId` (user ID), not a `memberId` (member row ID). The route uses `params.memberId` as a user ID. This matches the existing service signature.

## Unresolved Risks
- The `removeMember` service takes `targetUserId` (the UUID of the *user* to remove), but the route path is `/api/households/:id/members/:memberId`. The semantics of `:memberId` (whether it's a household_member row UUID or a user UUID) are ambiguous from the service signature — the service uses it as `userId` in a DB query. Callers must pass a userId. This is consistent with the existing service but may surprise API consumers.
- No backup.ts coverage was added (no new tables were created in this task — tables existed from task 052).
