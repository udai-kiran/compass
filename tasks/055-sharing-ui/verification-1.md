# Task 055 — Per-record sharing controls UI: Verification

## Files Changed

| File | Status |
|------|--------|
| `apps/web/src/lib/sharing-queries.ts` | NEW |
| `apps/web/src/components/SharingControl.tsx` | NEW |
| `apps/web/src/routes/household/HouseholdPage.tsx` | MODIFIED |

## Implementation Details

### sharing-queries.ts
- `useSharingGrants(resourceType, resourceId)` — GET `/api/sharing-grants?resourceType=…&resourceId=…`, returns `SharingGrant[]`
- `useSharingMutations(resourceType, resourceId)` — returns `{ grant, revoke }` mutations; POST `/api/sharing-grants` and DELETE `/api/sharing-grants/:id`
- Both invalidate `["sharing-grants", resourceType, resourceId]` on success
- Toast on success and error

### SharingControl.tsx
- Uses `useHouseholds()`, `useHouseholdMembers()`, `useSharingGrants()`, `useSharingMutations()`
- Shows "Private (no household)" if user has no household
- Shows "Private" or "Shared with N member(s)" label
- Renders a checkbox per non-owner member; checking grants sharing, unchecking revokes it
- Uses first household from the list (Phase 4 single-household assumption)

### HouseholdPage.tsx
- Added imports: `SharingControl`, `useAccounts`
- Added `SharingDemoPanel` component: fetches accounts, renders `SharingControl` for the first account
- `SharingDemoPanel` is rendered at the bottom of the household page as a proof-of-concept

## Commands Run

```
npm run typecheck 2>&1; echo "EXIT:$?"
```

Output (last lines):
```
> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

```
npm run build -w apps/web 2>&1 | tail -15; echo "EXIT:$?"
```

Output:
```
dist/assets/ImportPage-4QzonaX-.js          12.77 kB │ gzip:   3.64 kB
dist/assets/InboxPage-BX__4K2l.js           13.09 kB │ gzip:   3.38 kB
dist/assets/SipsPage-CiBLj-5A.js            15.78 kB │ gzip:   4.26 kB
dist/assets/CardsPage-D7PlgJni.js           15.89 kB │ gzip:   4.54 kB
dist/assets/PortfolioPage-DSqp121o.js       16.89 kB │ gzip:   4.89 kB
dist/assets/GoalsPage-B2mhsy0m.js           17.86 kB │ gzip:   5.09 kB
dist/assets/InsurancePage-BR-ERi2T.js       22.29 kB │ gzip:   5.89 kB
dist/assets/UpiQr-OqS6AeHJ.js               24.34 kB │ gzip:   8.78 kB
dist/assets/AccountDetailPage-uwOCqvvZ.js   25.69 kB │ gzip:   6.85 kB
dist/assets/TransactionsPage-CdEpCVAV.js    56.86 kB │ gzip:  15.56 kB
dist/assets/SettingsPage-DCraZGlU.js        59.25 kB │ gzip:  14.16 kB
dist/assets/src-CU52cthT.js                150.87 kB │ gzip:  41.88 kB
dist/assets/index-UzmZIBqP.js              339.36 kB │ gzip: 105.24 kB

✓ built in 173ms
EXIT:0
```

## Assumptions

- `SharingResourceTypeSchema` and `CreateSharingGrantSchema` were present in `packages/shared/src/schemas/household.ts` already (from task 053/054 work); no changes to shared package were needed.
- `SharingResourceTypeSchema` import was omitted from `sharing-queries.ts` since only the type (`type SharingResourceType`) is needed there, avoiding an unused-value lint error.
- The linter auto-added an import for `BalancesPanel` (from `./BalancesPanel.tsx`) during the edit of `HouseholdPage.tsx` — that file pre-existed from a prior task and the import is valid.

## Unresolved Risks

- The `/api/sharing-grants` endpoint (task 053) must be deployed for the UI to function; the component will silently show an empty grants list if the endpoint is absent.
- Only the first household is used for sharing (`households?.[0]`); a user in multiple households cannot choose which one to share within — this is an accepted Phase 4 limitation.
