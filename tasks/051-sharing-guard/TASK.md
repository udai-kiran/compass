# Task: Central withSharing() authorization guard (task board 4.3)

## Status
COMPLETE

## Objective
One central `withSharing()` guard that all services compose to extend
visibility from "user_id = me" to "user_id = me OR explicitly shared via a
household grant." Private is the default; sharing is an explicit per-record
grant. The 7 parent-FK-scoped tables are individually resolved and tested.

## Root Cause
The current model is `eq(table.userId, userId)` everywhere. Household
sharing needs to widen that predicate without ad-hoc per-route checks,
because the failure mode of a missed check is a privacy breach.

## Scope

### New table
- `sharing_grants` — in `modules/household/schema.ts`:
  id, resourceType (enum), resourceId, ownerUserId, grantedToUserId,
  householdId, createdAt.
  Unique on (resourceType, resourceId, grantedToUserId).

### New enum
- `sharingResourceType` — `["account", "goal", "holding",
  "insurance_policy", "budget"]`

### New helper
- `apps/api/src/lib/sharing.ts` — `withSharing(db, userId, table, idCol)`
  returns a SQL condition: `userId = me OR id IN (shared resource IDs)`.
  For parent-FK tables, a `withSharingViaParent()` variant resolves through
  the parent FK.

### Service integration
- `modules/ledger/services/accounts.ts` — compose withSharing in list queries
- `modules/ledger/services/transactions.ts` — compose via parent (account)
- Other services adopt withSharing progressively; read paths widen,
  write paths stay owner-only

### Cache
- `lib/cache.ts` — sharing grant/revoke invalidates BOTH owner and grantee
  cache versions

### Backup
- Add `sharing_grants` to ALL_TABLES / USER_TABLES

## Dependencies
- 049 (Person model) — PLANNING
- 050 (Households schema) — PLANNING

## Plan
- P1: Add `sharingResourceType` enum + `sharingGrants` table to
  household schema.ts
- P2: Re-export from db/schema.ts; update backup tables
- P3: Create `lib/sharing.ts` with `withSharing()` and
  `withSharingViaParent()`
- P4: Create sharing grant service: grant, revoke, list grants for resource
- P5: Integrate withSharing into account list queries (proof of concept)
- P6: Integrate into transaction queries via parent account
- P7: Handle all 7 parent-FK tables explicitly
- P8: Cache invalidation on grant/revoke
- P9: Generate Drizzle migration
- P10: Write tests: cross-household isolation, private-by-default,
  revocation removes access, parent-FK scoping

## Acceptance Criteria
- AC1: One `withSharing()` helper; no route performs its own sharing check
- AC2: All 7 parent-FK tables enumerated and individually covered by tests
- AC3: Unshared records invisible to other household members
- AC4: Revoking a share immediately removes access
- AC5: Demo session unchanged
- AC6: Cache invalidated for both parties on grant/revoke
- AC7: backup.test.ts passes
- AC8: `npm run typecheck`, `npm run lint`, `npm run test` exit 0

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test (no new failures)
- T4: Review sharing.ts for correctness of SQL conditions

## Non-Goals
- UI for sharing controls (4.7 owns that)
- Split-level sharing (4.4 owns splits)
