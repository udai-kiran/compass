# Task: Households schema + membership (task board 4.2)

## Status
COMPLETE

## Objective
Create the `household` module with `households`, `household_members` and
`household_invites` tables. Provide basic CRUD services and the invite/
accept/leave membership flow. A user with no household sees identical
behaviour to today.

## Root Cause
Compass is single-player. There is no way to share financial data with a
spouse or family member. Households are the containment boundary for
sharing and splits.

## Scope

### New module: `apps/api/src/modules/household/`
- `schema.ts` — tables: `households`, `householdMembers`,
  `householdInvites`; enums: `householdRole`
- `services/households.ts` — create, rename, delete household; list user's
  households; get household by ID
- `services/membership.ts` — invite (generate token), accept invite,
  leave household, remove member, list members
- `routes/households.ts` — CRUD + invite/accept/leave routes
- `plugin.ts` — register routes

### Schema barrel + app registration
- `db/schema.ts` — re-export household tables + enum
- `app.ts` — register `householdRoutes` in `registerRoutes()`
- `modules/system/services/backup.ts` — add all 3 tables to
  `ALL_TABLES` + `USER_TABLES`/`LINKED_TABLES`

### Shared schemas
- `packages/shared/src/schemas/household.ts` — Zod schemas for
  Household, HouseholdMember, HouseholdInvite, Create/Update schemas
- `packages/shared/src/index.ts` — re-export

### Migration
- Drizzle-generated DDL for 3 new tables + 1 enum

## Dependencies
- 1.9 (COMPLETE)

## Plan
- P1: Create `modules/household/schema.ts` with 3 tables + enum
- P2: Create shared Zod schemas in `packages/shared`
- P3: Create household CRUD service
- P4: Create membership service (invite → token → accept → member)
- P5: Create routes + plugin; register in app.ts
- P6: Re-export from db/schema.ts
- P7: Generate Drizzle migration
- P8: Update ALL_TABLES / USER_TABLES / LINKED_TABLES
- P9: Ensure demo mode rejects all mutations
- P10: Regression: solo user sees no behaviour change

## Acceptance Criteria
- AC1: `households`, `household_members`, `household_invites` tables exist
- AC2: Invite → accept → member flow works via service layer
- AC3: Leaving a household removes the member row cleanly
- AC4: A user with no household gets empty arrays (no behaviour change)
- AC5: Demo session cannot create/join a household (403)
- AC6: backup.test.ts passes (new tables registered)
- AC7: `npm run typecheck`, `npm run lint`, `npm run test` exit 0

## Verification
- T1: npm run db:generate produces expected migration
- T2: npm run typecheck (exit 0)
- T3: npm run lint (exit 0)
- T4: npm run test (no new failures)
- T5: Review migration SQL for correctness

## Non-Goals
- API routes (deferred to 4.5 combined with splits routes)
- UI (deferred to 4.6)
- Sharing grants (4.3 owns that)
