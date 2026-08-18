# Task: Household switcher & management page (task board 4.6)

## Status
COMPLETE

## Verified
- review-1.md: PASS — all AC verified, typecheck exit 0, build exit 0, lazy chunk produced

## Objective
Sidebar household switcher, management page with member list, invite flow,
person records. Solo users see no added complexity.

## Root Cause
No UI for the household feature.

## Scope

### Nav (three-edit rule)
- `AppLayout.tsx` — add "Household" to NAV_GROUPS (new group or in Setup)
- `icons.tsx` — add `"household"` to IconName + SVG
- `CommandPalette.tsx` — add to PAGES

### Switcher
- `AppLayout.tsx` — household switcher in sidebar chrome, hidden entirely
  when user has no household

### New page
- `routes/household/HouseholdPage.tsx` — members, roles, invite, leave
- `routes/household/PersonList.tsx` — person records from family_members

### Query hooks
- `lib/household-queries.ts` — useHouseholds, useHouseholdMembers,
  useHouseholdMutations, usePersons

### Router
- `main.tsx` or router config — add /household route

## Dependencies
- 053 (API routes) — PLANNING

## Plan
- P1: Add icon + nav + command palette entries
- P2: Create household-queries.ts
- P3: Build HouseholdPage with member list
- P4: Build invite flow (generate token, share, accept)
- P5: Build leave/remove confirmation
- P6: Build household switcher in sidebar
- P7: Ensure switcher hidden for solo users
- P8: Loading/error/empty states via States.tsx
- P9: Mobile layout verification

## Acceptance Criteria
- AC1: Nav entry via all three coordinated edits; Cmd+K reachable
- AC2: Switcher hidden for users with no household
- AC3: Invite → accept → member list → leave works end to end
- AC4: Leaving confirms and states what access is lost
- AC5: People without logins render naturally
- AC6: Demo mode read-only (mutations show 403 toast)
- AC7: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build -w apps/web` all pass

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test (no new failures)
- T4: npm run build -w apps/web (exit 0)

## Non-Goals
- Sharing controls UI (4.7)
- Split modal UI (4.8)
