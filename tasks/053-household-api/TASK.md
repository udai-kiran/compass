# Task: Household & split API routes (task board 4.5)

## Status
COMPLETE

## Verified
- review-1.md: plan gaps found (getSplit/updateSplit missing, no grants service, split auth missing)
- review-2.md: 3 highs (split scope, grant grantee check, txn ownership) + 2 mediums
- review-3.md: PASS — all 3 highs resolved, typecheck 0, snapshot 7/7
- Resource ownership for sharing grants: deferred Phase 5 limitation (commented in code)

## Objective
Complete REST API for households, membership, sharing grants, splits,
balances and settlements. Route snapshots deliberately updated.

## Root Cause
Services from 4.2–4.4 exist but have no HTTP surface.

## Scope

### Routes (`modules/household/routes/`)
- `households.ts` — POST/GET /api/households, GET/PATCH/DELETE
  /api/households/:id
- `membership.ts` — POST /api/households/:id/invite,
  POST /api/households/accept, DELETE /api/households/:id/members/:userId,
  POST /api/households/:id/leave, GET /api/households/:id/members
- `sharing.ts` — POST/DELETE /api/sharing-grants, GET
  /api/sharing-grants?resourceType=&resourceId=
- `splits.ts` — POST /api/transactions/:txId/split, GET/PATCH/DELETE
  /api/splits/:id, GET /api/households/:id/balances
- `settlements.ts` — POST /api/households/:id/settlements,
  GET /api/households/:id/settlements

### Shared Zod schemas
- `packages/shared/src/schemas/household.ts` — all request/response
  schemas for the above routes

### Plugin
- `modules/household/plugin.ts` — register all route groups

### Snapshots
- `route-surface.snapshot.txt` — add new routes alphabetically
- `route-table.snapshot.txt` — regenerate via regen script

## Dependencies
- 052 (Splits & settlements) — PLANNING

## Plan
- P1: Define all Zod request/response schemas in packages/shared
- P2: Implement household CRUD routes
- P3: Implement membership routes (invite/accept/leave/remove/list)
- P4: Implement sharing grant routes
- P5: Implement split routes + balance query
- P6: Implement settlement routes
- P7: Wire plugin.ts; register in app.ts
- P8: Update route snapshots
- P9: Verify all mutating routes rejected for demo session

## Acceptance Criteria
- AC1: Full CRUD for households, membership, grants, splits, settlements
- AC2: All requests/responses typed by Zod schemas from @compass/shared
- AC3: Route snapshots updated with all new routes
- AC4: Every mutating route rejected for demo session (403)
- AC5: `npm run typecheck`, `npm run lint`, `npm run test` exit 0

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test (no new failures)
- T4: Route snapshot tests pass

## Non-Goals
- Frontend consumption (4.6-4.8 own that)
