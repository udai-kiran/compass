# Task 054 — Household UI — Verification

## Files Changed
- `apps/web/src/components/icons.tsx` — added `"household"` to IconName union + PATHS entry
- `apps/web/src/layouts/AppLayout.tsx` — added `{ to: "/household", label: "Household", icon: "household" }` to Setup group
- `apps/web/src/components/CommandPalette.tsx` — added `{ label: "Household", to: "/household" }` to PAGES array
- `apps/web/src/main.tsx` — added lazy HouseholdPage import + `{ path: "household", element: <HouseholdPage /> }` route

## Files Created
- `apps/web/src/lib/household-queries.ts` — exports useHouseholds, useHouseholdMembers, useHouseholdMutations
- `apps/web/src/routes/household/HouseholdPage.tsx` — exports HouseholdPage

## Implementation Notes
- The `invite` mutation calls `apiPost` with no body (body param is optional in apiPost); `leave` likewise
- Icon added as inner path fragment matching PATHS record pattern (outer SVG is rendered by Icon component)
- PAGES array in CommandPalette.tsx has shape `{ label, to }` — no icon field needed there

## Commands Run

```
npm run typecheck 2>&1 | tail -40
```
Exit 0. All workspaces passed with no errors.

```
npm run build -w apps/web 2>&1 | tail -30
```
Exit 0. HouseholdPage-CCtOA7Xu.js (6.61 kB) built as a separate lazy chunk. "✓ built in 169ms".

## Acceptance Criteria
- AC1: "Household" in nav sidebar (Setup group) and Command+K palette ✓
- AC2: /household route renders HouseholdPage ✓
- AC3: useHouseholds, useHouseholdMembers, useHouseholdMutations all exported ✓
- AC4: npm run typecheck exits 0 ✓
- AC5: npm run build -w apps/web exits 0 ✓

## Assumptions
- `apiPost` body being optional means calling `invite.mutate(householdId)` / `leave.mutate(householdId)` with no body arg is valid — confirmed by api.ts signature `body?: unknown`
- CreateHouseholdSchema / UpdateHousehold types are consumed in household-queries.ts directly from @compass/shared

## Unresolved Risks
- None
