Files modified:

- `apps/web/src/routes/shopping/CartPage.tsx`

Changes made:

- Added `sourcesMap: Map<string, PriceSource>` to `SourceGroupSection` and `CartItemRow` props.
- Passed `sourcesMap` from `DraftCard` → `SourceGroupSection` → `CartItemRow`.
- Removed `CartItemRow`’s empty local `Map`, so `priceLine(item, sourcesMap)` now resolves the actual price source.

Commands run:

- Read `tasks/TDD.md` and inspected relevant `CartPage.tsx` prop usage.
- Ran `git status --short` before editing; the worktree already contained unrelated changes, which were left untouched.
- Ran `npm run typecheck` — passed.

```text
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit


> @compass/docs@0.1.0 typecheck
> tsc --noEmit


> @compass/extractor@0.1.0 typecheck
> tsc --noEmit


> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit


> @compass/web@0.1.0 typecheck
> tsc --noEmit


> @compass/ai@0.1.0 typecheck
> tsc --noEmit


> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

- Ran `npm run build -w apps/web` — passed.

```text
> @compass/web@0.1.0 build
> vite build

vite v8.2.1 building client environment for production...
transforming...✓ 357 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                              0.53 kB │ gzip:   0.31 kB
dist/assets/index-BVsPnaeR.css              56.23 kB │ gzip:  10.60 kB
dist/assets/account-meta-lAns5q7G.js         0.44 kB │ gzip:   0.29 kB
dist/assets/resource-queries-Dj8KjFeb.js     0.58 kB │ gzip:   0.33 kB
dist/assets/pantry-view-Doiz5lBD.js          1.03 kB │ gzip:   0.57 kB
dist/assets/useInfiniteQuery-gO3xa-ZH.js     1.11 kB │ gzip:   0.46 kB
dist/assets/States-BG1Ckw9T.js               1.30 kB │ gzip:   0.58 kB
dist/assets/import-queries-BrNwfQN1.js       2.74 kB │ gzip:   0.97 kB
dist/assets/StatusPage-OErM8Cc3.js           2.90 kB │ gzip:   0.97 kB
dist/assets/card-queries-tKxUPXjT.js         3.07 kB │ gzip:   0.94 kB
dist/assets/wealth-queries-DCHFDosD.js       3.19 kB │ gzip:   0.98 kB
dist/assets/TrendsPage-DsirqlFQ.js           3.28 kB │ gzip:   1.28 kB
dist/assets/institutions-seVmX7B3.js         3.45 kB │ gzip:   1.44 kB
dist/assets/PantryPage-B1FzjMw1.js           3.49 kB │ gzip:   1.39 kB
dist/assets/goal-queries-BwurjxBA.js         3.90 kB │ gzip:   1.18 kB
dist/assets/NotificationsPage-_zSUX-gV.js    4.06 kB │ gzip:   1.57 kB
dist/assets/queries-B4FnEmdZ.js              4.46 kB │ gzip:   1.37 kB
dist/assets/CategoryPicker-BWMflp_C.js       4.64 kB │ gzip:   2.04 kB
dist/assets/ResourcesPage-CLBDXkFN.js        4.93 kB │ gzip:   1.78 kB
dist/assets/DashboardPage-1VfpDnjA.js        5.07 kB │ gzip:   1.58 kB
dist/assets/PriceWatchPage-DWz0u3pK.js       5.12 kB │ gzip:   1.87 kB
dist/assets/MfImportPage-CL8PK9p7.js         5.23 kB │ gzip:   1.91 kB
dist/assets/InsightsPage-DLksp_eS.js         5.38 kB │ gzip:   1.91 kB
dist/assets/AccountLedgerPage-v73ZC-Je.js    5.39 kB │ gzip:   1.67 kB
dist/assets/CashFlowPage-B7FUBDaY.js         5.48 kB │ gzip:   1.86 kB
dist/assets/NetWorthPage-DPjXlf6y.js         5.58 kB │ gzip:   1.76 kB
dist/assets/AccountsPage-Dn2IknDy.js         5.61 kB │ gzip:   1.99 kB
dist/assets/EventLogPage-DTwmINPn.js         6.08 kB │ gzip:   2.25 kB
dist/assets/DateField-DTTWpPXa.js            6.57 kB │ gzip:   2.61 kB
dist/assets/CapitalGainsPage-BDLYsLRb.js     7.25 kB │ gzip:   2.45 kB
dist/assets/BillsPage-JP343GKY.js            7.27 kB │ gzip:   2.52 kB
dist/assets/viz-CBcS5PhO.js                  7.82 kB │ gzip:   2.82 kB
dist/assets/BudgetsPage-C8nUVDAN.js          8.99 kB │ gzip:   2.75 kB
dist/assets/HouseholdPage-Bz4QQ-jX.js       10.01 kB │ gzip:   2.73 kB
dist/assets/EMIsPage-CYjAnhyY.js            10.09 kB │ gzip:   3.01 kB
dist/assets/TasksPage-Bk6U-X_R.js           10.80 kB │ gzip:   3.29 kB
dist/assets/ReportsPage-7b0EhcDh.js         11.54 kB │ gzip:   3.27 kB
dist/assets/CardDetailPage-DUaCBPVU.js      11.81 kB │ gzip:   3.53 kB
dist/assets/ImportPage-D42TVK7B.js          12.78 kB │ gzip:   3.64 kB
dist/assets/InboxPage-oKgrD0bR.js           13.09 kB │ gzip:   3.39 kB
dist/assets/CartPage-Bel0Xh-N.js            13.48 kB │ gzip:   4.09 kB
dist/assets/SipsPage-CuBlHt_Z.js            15.78 kB │ gzip:   4.27 kB
dist/assets/CardsPage-D07WTlmp.js           15.89 kB │ gzip:   4.53 kB
dist/assets/PortfolioPage-BU29jBpx.js       16.89 kB │ gzip:   4.89 kB
dist/assets/ListsPage-G7nnFLxX.js           20.23 kB │ gzip:   5.33 kB
dist/assets/InsurancePage-BXzkXwJ3.js       22.29 kB │ gzip:   5.88 kB
dist/assets/UpiQr-C9vI2zUf.js               24.33 kB │ gzip:   8.78 kB
dist/assets/AccountDetailPage-CFDejHBT.js   25.69 kB │ gzip:   6.84 kB
dist/assets/GoalsPage-BkMikZ29.js           30.84 kB │ gzip:   8.02 kB
dist/assets/TransactionsPage-B71aePkx.js    57.36 kB │ gzip:  15.67 kB
dist/assets/SettingsPage-CWk2gw6W.js        59.25 kB │ gzip:  14.16 kB
dist/assets/src-DjF9NrUe.js                172.89 kB │ gzip:  46.69 kB
dist/assets/index-B9RlX0oe.js              343.37 kB │ gzip: 105.79 kB

✓ built in 185ms
```

Issues, risks, or deviations:

- None. Both requested verification commands completed successfully.