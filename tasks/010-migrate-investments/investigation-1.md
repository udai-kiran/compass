# Investigation 1 — task 1.3 "Migrate investments module" (`tasks/01.03-migrate-investments.md`)

Read-only investigation. No files changed. All paths absolute-relative to repo root `/home/udai/PennyPilot`. Written after reading both precedent investigations (`tasks/007-migrate-ledger/investigation-1.md`, `tasks/008-migrate-credit/investigation-1.md`) and matching their structure/rigor.

Files inspected (full list): `apps/api/src/routes/holdings.ts`, `apps/api/src/routes/sips.ts`,
`apps/api/src/routes/networth.ts`, `apps/api/src/routes/retirement.ts`,
`apps/api/src/routes/account-nps.ts`, `apps/api/src/services/holdings.ts`,
`apps/api/src/services/sips.ts`, `apps/api/src/services/networth.ts`,
`apps/api/src/services/goal-networth.ts`, `apps/api/src/services/holding-details.ts`,
`apps/api/src/services/account-nps.ts`, `apps/api/src/services/retirement.ts`,
`apps/api/src/services/capital-gains.ts`, `apps/api/src/services/tax-lots.ts`,
`apps/api/src/services/mf-import.ts`, `apps/api/src/services/xirr.ts`,
`apps/api/src/services/amfi.ts`, `apps/api/src/services/mf-scheme-map.ts`,
`apps/api/src/services/goal-allocation.ts`, `apps/api/src/services/ownership.ts`,
`apps/api/src/db/schema.ts` (relevant sections), `apps/api/src/app.ts`,
`apps/api/src/jobs/index.ts`, `apps/api/src/jobs/index.test.ts`,
`apps/api/src/services/backup.ts`, `apps/api/src/route-surface.snapshot.txt`,
`apps/api/src/route-table.snapshot.txt`, `apps/api/src/app.route-snapshot.test.ts`,
`apps/api/src/modules/ledger/services/transactions.ts`,
`apps/api/src/modules/credit/services/reconciliation-writes.ts`,
`apps/api/src/modules/planning/plugin.ts`, `apps/api/src/services/holdings.test.ts`,
`apps/api/src/services/sips.test.ts`, `apps/api/src/services/networth.test.ts`,
`apps/api/src/services/goal-networth.test.ts`, `apps/api/src/services/capital-gains.test.ts`,
`apps/api/src/services/tax-lots.test.ts`, `apps/api/src/services/mf-import.test.ts`,
`tasks/01.03-migrate-investments.md`, `tasks/01.04-migrate-protection.md`,
`tasks/01.05-migrate-planning.md`, `tasks/README.md` (status frontmatter grep).

---

## 1. Route files

`find`/`ls` over `apps/api/src/routes/` for holdings/sips/networth naming confirms exactly three files match the roadmap's own "Routes: holdings (13 endpoints), sips, networth" line:

```
apps/api/src/routes/holdings.ts
apps/api/src/routes/networth.ts
apps/api/src/routes/sips.ts
```

No file matched a `net-worth`/`net_worth` filename pattern — the route file is named `networth.ts` (no hyphen), only the URL paths use the hyphen (`/api/net-worth`, `/api/net-worth/by-goal`, `/api/net-worth/backfill`).

`wc -l`:
```
  176 apps/api/src/routes/holdings.ts
  122 apps/api/src/routes/sips.ts
   54 apps/api/src/routes/networth.ts
  352 total
```

`apps/api/src/app.ts` import lines (exact grep):
```
27:import { sipRoutes } from "./routes/sips.ts";
34:import { holdingRoutes } from "./routes/holdings.ts";
35:import { netWorthRoutes } from "./routes/networth.ts";
```

`app.ts`'s `registerRoutes()` call sites (`app.ts:103-130`), exact lines:
```
112:  await app.register(sipRoutes);
119:  await app.register(holdingRoutes);
120:  await app.register(netWorthRoutes);
```

**Registration is NOT contiguous.** Between `sipRoutes` (112) and `holdingRoutes`/`netWorthRoutes` (119/120) sit five other route-group registrations: `cashflowRoutes` (113), `billRoutes` (114), `creditRoutes` (115), `retirementRoutes` (116), `accountNpsRoutes` (117), `insuranceRoutes` (118). So the three investments route groups are split across two non-adjacent positions in `registerRoutes()`, with `sipRoutes` registered *before* the (already-migrated) `creditRoutes` plugin, and `holdingRoutes`/`netWorthRoutes` registered *after* it. Any plugin collapse of the three into one `investmentsRoutes` will visibly restructure `route-table.snapshot.txt`'s tree exactly as tasks 1.1/1.2 anticipated — same two-snapshot design (`route-surface.snapshot.txt` is order-insensitive per-path; `route-table.snapshot.txt` is not, per `app.route-snapshot.test.ts:14-68`).

### Endpoint counts — two independent methods, cross-checked

**Method A** — direct count of `r.get/post/patch/put/delete(` call sites in each route file:
```
grep -c "r\.\(get\|post\|patch\|put\|delete\)(" apps/api/src/routes/holdings.ts   → 16
grep -c "r\.\(get\|post\|patch\|put\|delete\)(" apps/api/src/routes/sips.ts       → 9
grep -c "r\.\(get\|post\|patch\|put\|delete\)(" apps/api/src/routes/networth.ts  → 3
```

Full `holdings.ts` endpoint list (16, `apps/api/src/routes/holdings.ts`):
1. `GET /api/portfolio` (48)
2. `GET /api/holdings/capital-gains` (54)
3. `POST /api/holdings/refresh-nav` (65)
4. `POST /api/holdings/import-mf/preview` (71)
5. `POST /api/holdings/import-mf/commit` (77)
6. `POST /api/holdings` (83)
7. `PATCH /api/holdings/:id` (90)
8. `DELETE /api/holdings/:id` (96)
9. `PUT /api/holdings/:id/valuation` (105)
10. `POST /api/holdings/:id/events` (114)
11. `DELETE /api/holdings/:id/events/:eventId` (121)
12. `POST /api/holdings/:id/events/:eventId/move` (130)
13. `GET /api/holdings/:id/nps` (145)
14. `PUT /api/holdings/:id/nps` (151)
15. `GET /api/holdings/:id/gold` (159)
16. `PUT /api/holdings/:id/gold` (165)

`sips.ts` (9): `GET /api/sips`, `GET /api/goals/:id/sips`, `POST /api/sips`, `PATCH /api/sips/:id`, `DELETE /api/sips/:id`, `POST /api/sips/:id/installments`, `POST /api/sips/:id/installments/link`, `DELETE /api/sips/:id/installments/link/:transactionId`, `GET /api/sips/:id/installment-candidates`.

`networth.ts` (3): `GET /api/net-worth`, `GET /api/net-worth/by-goal`, `POST /api/net-worth/backfill`.

**Method B** — `apps/api/src/route-surface.snapshot.txt` (283 lines total), grepped by path prefix and counted excluding the auto-generated `HEAD` lines:

```
--- holdings (20 lines incl. HEAD) ---
DELETE /api/holdings/:id
DELETE /api/holdings/:id/events/:eventId
GET /api/holdings/:id/gold
GET /api/holdings/:id/nps
GET /api/holdings/capital-gains
GET /api/portfolio
HEAD /api/holdings/:id/gold
HEAD /api/holdings/:id/nps
HEAD /api/holdings/capital-gains
HEAD /api/portfolio
PATCH /api/holdings/:id
POST /api/holdings
POST /api/holdings/:id/events
POST /api/holdings/:id/events/:eventId/move
POST /api/holdings/import-mf/commit
POST /api/holdings/import-mf/preview
POST /api/holdings/refresh-nav
PUT /api/holdings/:id/gold
PUT /api/holdings/:id/nps
PUT /api/holdings/:id/valuation
--- sips (12 lines incl. HEAD) ---
DELETE /api/sips/:id
DELETE /api/sips/:id/installments/link/:transactionId
GET /api/goals/:id/sips
GET /api/sips
GET /api/sips/:id/installment-candidates
HEAD /api/goals/:id/sips
HEAD /api/sips
HEAD /api/sips/:id/installment-candidates
PATCH /api/sips/:id
POST /api/sips
POST /api/sips/:id/installments
POST /api/sips/:id/installments/link
--- networth (5 lines incl. HEAD) ---
GET /api/net-worth
GET /api/net-worth/by-goal
HEAD /api/net-worth
HEAD /api/net-worth/by-goal
POST /api/net-worth/backfill
```

20 − 4 HEAD = 16 real holdings endpoints; 12 − 3 HEAD = 9 real sips endpoints; 5 − 2 HEAD = 3 real networth endpoints. **Both methods agree: 16 + 9 + 3 = 28 real endpoints total.**

**Roadmap text says "holdings (13 endpoints)" — the actual count is 16, not 13.** This is the same category of discrepancy tasks 1.1/1.2 each found in their own roadmap line (task 1.2's "cards (12 endpoints)" was actually 15).

`route-table.snapshot.txt` (156 lines) — relevant lines:
```
79:├── /api/sips (GET, HEAD, POST)
131:├── /api/net-worth (GET, HEAD)
138:│       └── /sips (GET, HEAD)
142:├── /api/portfolio (GET, HEAD)
145:└── /api/holdings (POST)
```

---

## 2. Service files

`wc -l` on every service file this domain's routes touch, plus files reachable transitively:

```
  536 apps/api/src/services/holdings.ts
 1319 apps/api/src/services/sips.ts
  581 apps/api/src/services/networth.ts
  148 apps/api/src/services/goal-networth.ts
  110 apps/api/src/services/holding-details.ts
   58 apps/api/src/services/account-nps.ts
   73 apps/api/src/services/retirement.ts
  164 apps/api/src/services/capital-gains.ts
  378 apps/api/src/services/tax-lots.ts
  405 apps/api/src/services/mf-import.ts
```

`sips.ts` is confirmed **exactly 1319 lines** (`wc -l` output: `1319 apps/api/src/services/sips.ts`) — the roadmap's "1319 lines" claim is exact. `networth.ts` is confirmed **exactly 581 lines** — the roadmap's "(581)" claim is exact too. Both of these specific numeric claims check out, unlike the "13 endpoints" one.

### `holding-details.ts`, `account-nps.ts`, `retirement.ts` — not named in the roadmap's prose at all

- `services/holding-details.ts` (110 lines) exports `getGoldDetails`, `getNpsDetails`, `upsertGoldDetails`, `upsertNpsDetails` — imported only by `routes/holdings.ts:23-28`, backing the `GET/PUT /api/holdings/:id/nps` and `GET/PUT /api/holdings/:id/gold` endpoints (already counted in the 16 above). The roadmap prose never names this file, but its two tables (`nps_details`, `gold_details`) are both in the roadmap's own Tables list — consistent, no conflict here, just an unnamed filename (same category of gap as task 1.2's `card-statements.ts`).
- `services/account-nps.ts` (58 lines) exports `getAccountNpsDetails`, `upsertAccountNpsDetails` — imported only by `routes/account-nps.ts:5`, backing `GET/PUT /api/accounts/:accountId/nps-details`. Its table `account_nps_details` **is** in task 01.03's own Tables list (`tasks/01.03-migrate-investments.md:10`). But `routes/account-nps.ts` + `services/account-nps.ts` are **not** named by 01.03's Routes line ("holdings, sips, networth" only) — instead, `tasks/01.04-migrate-protection.md:10` explicitly claims: `"Routes: insurance, retirement, account-nps. Tables: insurance_policies, insurance_health_cards, retirement_details."` — i.e. task 1.4's own text claims the `account-nps` **route**, while task 1.3's own text claims the `account_nps_details` **table**. See the flag at the end of §9.
- `services/retirement.ts` (73 lines) exports `getRetirementDetails`, `upsertRetirementDetails` — imported only by `routes/retirement.ts:5`, backing `GET/PUT /api/retirement/:accountId/details`. Its table `retirement_details` is named only in task 1.4's Tables list, **not** in task 01.03's — no conflict here; `retirement.ts`/`retirement_details` is unambiguously protection-module (1.4) despite the tempting name.

### `sips.ts` (1319 lines) — full read, seam analysis

The file already carries four `// ---------- ... ----------` section-comment headers of its own, plus an unheaded first block. Exact section boundaries (line numbers from the full `Read`):

**A. Lifecycle / CRUD (lines 1-550, no section header — runs from the top of the file to the first `// ----------` comment at line 551)**
- `toSip` (34-52), `isUniqueViolation` (61-64, exported — this is the function `modules/ledger/services/transactions.ts:18` imports cross-module, see §5), `isCheckViolation` (74-77, exported), `laterInstallmentDate` (88-92, exported pure fn), `lastInstallmentDateFor` (102-115), `ownedSip` (117-121), `isArchived` (128-130, exported), `lockedAccountForSip` (140-151), `assertBankSource` (160-165), `assertAccountTargetType` (180-199), `ownedHoldingGoal` (207-217), `resolveTargetGoalDecision`/`TargetGoalDecision` (228-233, exported), `resolveSipDateRange` (244-252, exported), `resolveSipFundingTarget` (264-272, exported), `sipEditOrphansLinks` (285-293, exported), `assertLinkRowsMatched` (303-307, exported), `linkTargetToGoal` (320-343), `assertAndLinkTarget` (351-370), `listSipsWhere` (383-394), `listSipsForGoal` (396-398, exported), `listAllSips` (405-407, exported), `createSip` (409-425, exported), `updateSip` (439-541, exported — the largest single function in the seam, ~100 lines), `deleteSip` (543-549, exported).

**B. Installment matching (lines 551-1039, two of the file's own section headers: `// ---------- Recording an actual installment ----------` at 551, `// ---------- Linking a ledger transaction as an account-target installment ----------` at 776)**
- `installmentDateError` (559-563, exported pure fn), `accountInstallmentSipIssue` (572-583, exported pure fn), `linkInstallmentIssue` (602-630, exported pure fn), `candidateDateBounds` (641-647, exported pure fn), `INSTALLMENT_CANDIDATE_LIMIT` (650), `recordSipInstallment` (658-774, exported — books an MF-folio buy from a SIP), `linkSipInstallment` (787-875, exported — stamps `sip_id` on an existing ledger transaction), `unlinkSipInstallment` (883-923, exported), `linkedInstallmentRows` (944-961), `unlinkedInstallmentRows` (970-999), `listSipInstallmentCandidates` (1012-1039, exported).

**C. A fourth, roadmap-unnamed seam — goal-plan committed-monthly (lines 1041-1126, own section header `// ---------- Committed monthly (goal-plan gap) ----------` at 1041)**
- `ClassifiableSip` (1043-1048, exported interface), `monthlyEquivalentPaise` (1055-1059, exported pure fn), `committedSplit` (1062-1074, exported pure fn), `classifySipTarget` (1077-1086, exported pure fn), `committedForGoal` (1094-1126, exported — the only DB-touching function in this seam, joins `sips`/`holdings`/`accounts`). This block is **not** covered by the roadmap's own 3-way "date-math / lifecycle / installment-matching" split description — it is planning/goal-plan-facing logic (classifying a SIP's committed contribution as equity/debt for the goal gap), sharing `./goal-allocation.ts` with `services/goals.ts` and `services/goal-returns.ts` (both planning-module files per `01.05`'s own Routes list, see §5).

**D. Date-math / cash-flow (lines 1128-1319, own section header `// ---------- Next-occurrence / cash-flow ----------` at 1128)**
- `pad` (1130-1132), `FREQUENCY_STEP_MONTHS` (1135), `monthIndex` (1138-1141), `dateFromMonthIndex` (1143-1147), `firstOccurrenceOnOrAfter` (1158-1175, exported), `lastOccurrenceOnOrBefore` (1187-1204, exported), `occurrenceMonthStart` (1215-1217), `dueInstallmentDate` (1243-1261, exported), `nextSipDate` (1269-1284, exported), `dayAfter` (1286-1290), `sipOccurrencesInWindow` (1299-1319, exported). This is the cleanest, most self-contained seam — every function here is pure (no `db`/`tx` parameter) and already exported.

**Summary:** the roadmap's own "date-math / lifecycle / installment-matching" 3-way split maps onto seams D / A / B respectively. Seam C (goal-plan committed-monthly, ~86 lines) does not map cleanly onto any of the three named seams — a fact for the plan to resolve, not resolved here.

### `networth.ts` (581 lines) — exhaustiveness mechanism, quoted verbatim

`apps/api/src/services/networth.ts:19-48`:
```ts
/** Account-derived buckets; holdingsPaise comes from the portfolio, not accounts. */
type AccountBucket = Exclude<keyof Breakdown, "holdingsPaise">;

/**
 * Which bucket each account type contributes to.
 *
 * Exhaustive on purpose: adding an account type without classifying it here is
 * a compile error. An unclassified type would otherwise be dropped from the
 * balance sheet entirely — the balance simply vanishes, with no error to notice.
 */
export const ACCOUNT_BUCKET: Record<AccountType, AccountBucket | null> = {
  bank: "cashPaise",
  cash: "cashPaise",
  investment: "investmentAccountsPaise",
  // PPF/EPF/SSY balances are real, credited money — assets, same as any investment account.
  ppf: "investmentAccountsPaise",
  epf: "investmentAccountsPaise",
  ssy: "investmentAccountsPaise",
  nps: "investmentAccountsPaise",
  credit_card: "creditCardsPaise",
  loan: "loansPaise",
  overdraft: "loansPaise",
  // Overdraft home loan: the balance is what you owe (net of parked surplus),
  // so it's a liability like any other loan. The drawing power is liquidity, not
  // a separate asset — counting it would double what the surplus already offset.
  home_loan_od: "loansPaise",
  // An insurance policy is a tracking record with no balance of its own —
  // premiums are expenses on the paying account, not money held here. It
  // contributes to no bucket (null), distinct from an unclassified type.
  insurance: null,
};
```
This is a `Record<AccountType, AccountBucket | null>` (imported type `AccountType` from `@compass/shared`) — TypeScript enforces every member of the `AccountType` union has a key, so adding a new account type to the shared union without an entry here fails to compile, matching the AC verbatim. A runtime test also exists (`apps/api/src/services/networth.test.ts:24-36`, `test("every account type is classified for net worth", ...)`, iterating `AccountTypeSchema.options`), but the compile-time guarantee is the `Record<AccountType, ...>` type itself, not this test.

**On "reaches across every domain"**: direct inspection of `networth.ts`'s imports (`apps/api/src/services/networth.ts:1-8`) shows it imports only `netWorthSnapshots`, `users` from `../db/schema.ts` and `portfolioValue` from `./holdings.ts` (in-domain) — it does **not** import any credit/protection-domain table or service. `computeNetWorth` (`networth.ts:51-95`) reads `accounts`/`transactions` via a raw `db.execute(sql\`...\`)` string (`networth.ts:56-66`), not via imported Drizzle table objects — so it touches the ledger's `accounts`/`transactions` tables by raw SQL, not an import. The "reaches across every domain" characterization is accurate only in the sense that `AccountType` values it classifies (`credit_card`, `loan`, `overdraft`, `insurance`) conceptually belong to other domains (credit, protection) — physically the file imports nothing from those domains' service/table files.

---

## 3. Tables — full read of `apps/api/src/db/schema.ts`

All 8 roadmap-named tables confirmed present, plus `retirement_details` (protection-owned, read for the boundary check in §9).

**`holdings`** (`schema.ts:1255-1290`, `pgTable("holdings", ..., (t) => [index("holdings_user_idx").on(t.userId)])`): `id` (uuid pk), `userId` → `users.id` (1259-1261), `name`, `assetClass` (`assetClass` pgEnum, 1263), `notes`, `targetPct`, `amfiSchemeCode`, `folioNumber`, `grandfatherNavPaise`, `gainsTaxClass` (`gainsTaxClass` pgEnum, default `"equity"`, 1282), `goalId` → `goals.id` (`onDelete: "set null"`, 1284), `archivedAt`, `createdAt`, `updatedAt`.

**`accountNpsDetails`** (`schema.ts:1295-1310`, table name `"account_nps_details"`): `accountId` (uuid, **primary key**, → `accounts.id` `onDelete: "cascade"`, 1296-1298), `userId` → `users.id` (1299-1301), `pran`, `tier` (`npsTier` pgEnum, 1303), `equityPct`, `corporatePct`, `govtPct`, `createdAt`, `updatedAt`.

**`npsDetails`** (`schema.ts:1313-1328`, table name `"nps_details"`): `holdingId` (uuid, **primary key**, → `holdings.id` `onDelete: "cascade"`, 1314-1316), `userId` → `users.id` (1317-1319), `pran`, `tier` (`npsTier`, same shared enum as `accountNpsDetails`), `equityPct`, `corporatePct`, `govtPct`, `createdAt`, `updatedAt`. **Has a `user_id` column** (not FK-scoped-only) despite its parent (`holdings`) also carrying `userId`.

**`goldDetails`** (`schema.ts:1333-1347`, table name `"gold_details"`): `holdingId` (uuid, **primary key**, → `holdings.id` `onDelete: "cascade"`), `userId` → `users.id`, `form` (`goldForm` pgEnum), `purityKarat`, `maturityDate`, `createdAt`, `updatedAt`. **Has a `user_id` column.**

**`holdingValuations`** (`schema.ts:1349-1368`, `pgTable("holding_valuations", ..., (t) => [uniqueIndex("holding_valuations_unique_idx").on(t.holdingId, t.date)])`): `id` (uuid pk), `holdingId` → `holdings.id` (`onDelete: "cascade"`, not null, 1353-1355), `date`, `valuePaise`, `nav` (`doublePrecision`, nullable), `createdAt`. **No `userId` column at all** — confirms the roadmap's claim exactly.

**`holdingEvents`** (`schema.ts:1377-1412`, indexes `holding_events_holding_idx` on `(holdingId, date)` and a partial unique index `holding_events_sip_date_idx` on `(sipId, date) where sip_id is not null`): `id` (uuid pk), `holdingId` → `holdings.id` (`onDelete: "cascade"`, not null, 1381-1383), `type` (`holdingEventType` pgEnum: `["buy","sell","dividend"]`), `date`, `amountPaise`, `units` (`doublePrecision`, nullable), `note`, `seq` (nullable integer, intra-day order), `source` (`holdingEventSource` pgEnum: `["import","manual"]`, default `"import"`), `sipId` → `sips.id` (`onDelete: "set null"`, 1405), `createdAt`. **No `userId` column at all** — confirms the roadmap's claim exactly.

**`sips`** (`schema.ts:1437-1496`, indexes on `userId`, `goalId`, `sourceAccountId`, plus a check constraint `sips_payroll_requires_account_target`): `id` (uuid pk), `userId` → `users.id` (not null, 1441-1443), `goalId` → `goals.id` (`onDelete: "cascade"`, not null, 1444-1446), `sourceAccountId` → `accounts.id` (not null, 1447-1449), `targetKind` (`sipTargetKind` pgEnum: `["mf_folio","account"]`), `targetHoldingId` → `holdings.id` (`onDelete: "cascade"`, nullable, 1452-1454), `targetAccountId` → `accounts.id` (`onDelete: "cascade"`, nullable, 1456-1458), `amountPaise`, `dayOfMonth`, `frequency` (`sipFrequency` pgEnum: `["monthly","quarterly","yearly"]`, default `"monthly"`), `status` (`sipStatus` pgEnum: `["active","paused"]`, default `"active"`), `fundingSource` (`sipFundingSource` pgEnum: `["bank_debit","payroll"]`, default `"bank_debit"`), `startDate`, `endDate` (nullable), `createdAt`. The check constraint (1491-1494): `sql\`${t.fundingSource} <> 'payroll' or ${t.targetKind} = 'account'\`` — a DB-level guard for the same rule `sipFundingSourceIssue` enforces at the app layer (see `sips.ts` §2 seam A).

**`netWorthSnapshots`** (`schema.ts:1498-1515`, table name `"net_worth_snapshots"`, `uniqueIndex("net_worth_snapshots_unique_idx").on(t.userId, t.date)`): `id` (uuid pk), `userId` → `users.id` (not null, 1502-1504), `date`, `assetsPaise`, `liabilitiesPaise`, `breakdown` (jsonb, comment: `{ cash, holdings, investmentAccounts, creditCards, loans }`), `estimated` (boolean, default `false`), `createdAt`.

**Owned enums** (all `pgEnum` declarations physically adjacent to these 8 tables in `schema.ts`): `assetClass` (1228-1238, 9 members), `gainsTaxClass` (1245-1253, 7 members), `npsTier` (1292, 2 members, **shared** by both `accountNpsDetails` and `npsDetails`), `goldForm` (1330, 4 members), `holdingEventType` (1370), `holdingEventSource` (1375), `sipTargetKind` (1414), `sipStatus` (1415), `sipFundingSource` (1416), `sipFrequency` (1423).

**Roadmap claim confirmed exactly:** "`holding_valuations` and `holding_events` have no `user_id` and scope via parent FK" — true for exactly these two tables. It does **not** extend to `nps_details`, `gold_details`, or `account_nps_details`, which all carry their own `user_id` column despite also having a parent FK (`holdingId`/`accountId`).

**Not in the roadmap's Tables list (adjacent, protection-owned):** `retirementDetails` (`schema.ts:951-972`, table `"retirement_details"`) — `accountId` (uuid pk → `accounts.id` cascade), `userId` → `users.id`, `annualRateBps`, `maturityDate`, `referenceNumber`, `epsBalancePaise`, `createdAt`, `updatedAt`. Confirmed this table is **not** referenced anywhere in `services/holdings.ts`, `sips.ts`, `networth.ts`, `holding-details.ts`, or `account-nps.ts` — it belongs solely to `services/retirement.ts`/`routes/retirement.ts`.

---

## 4. Cross-module FK graph

**Outbound FKs from the 8 investments tables to tables outside this domain** (exact grep + read of `.references()` calls):

| Column | Target | onDelete | Target module |
|---|---|---|---|
| `holdings.userId` | `users.id` | — | core/auth |
| `holdings.goalId` | `goals.id` | set null | **planning (1.5)** |
| `accountNpsDetails.accountId` | `accounts.id` | cascade | **ledger (1.1)** |
| `accountNpsDetails.userId` | `users.id` | — | core/auth |
| `npsDetails.userId` | `users.id` | — | core/auth |
| `goldDetails.userId` | `users.id` | — | core/auth |
| `sips.userId` | `users.id` | — | core/auth |
| `sips.goalId` | `goals.id` | cascade | **planning (1.5)** |
| `sips.sourceAccountId` | `accounts.id` | — | **ledger (1.1)** |
| `sips.targetAccountId` | `accounts.id` | cascade | **ledger (1.1)** |
| `netWorthSnapshots.userId` | `users.id` | — | core/auth |

In-domain-only outbound FKs (not cross-module, listed for completeness): `npsDetails.holdingId → holdings.id`, `goldDetails.holdingId → holdings.id`, `holdingValuations.holdingId → holdings.id`, `holdingEvents.holdingId → holdings.id`, `holdingEvents.sipId → sips.id`, `sips.targetHoldingId → holdings.id`.

**Inbound FK — a table OUTSIDE this domain FKing into one of these 8 tables.** Grepped the entire `db/schema.ts` for `=> sips.id`, `=> holdings.id`, `=> npsDetails`, `=> goldDetails`, `=> accountNpsDetails`, `=> netWorthSnapshots`, `=> holdingEvents`, `=> holdingValuations`. Exactly one hit outside the domain itself:
```
344:    sipId: uuid("sip_id").references((): AnyPgColumn => sips.id, { onDelete: "set null" }),
```
This is `transactions.sipId → sips.id` (a **ledger table** FKing into an **investments table**), using the same `(): AnyPgColumn => target.id` forward-reference technique task 007 found for `transactions.policyId`/`transactions.reconciledStatementId`/`accounts.goalId`. `task 007's` own investigation (`tasks/007-migrate-ledger/investigation-1.md:122`) already flagged this exact FK from the ledger side ("`transactions.sip_id → sips.id` (investments module, task `1.3`)") — **re-confirmed still accurate** here from the investments side; no other table anywhere in `schema.ts` references any of the 8 tables' primary keys.

---

## 5. Cross-service imports, both directions

### (a) Every non-test production file importing FROM an investments service file (full grep, not a sample)

```
apps/api/src/routes/holdings.ts        ← services/holdings.ts, services/holding-details.ts,
                                          services/capital-gains.ts, services/mf-import.ts
apps/api/src/routes/sips.ts            ← services/sips.ts
apps/api/src/routes/networth.ts        ← services/networth.ts, services/goal-networth.ts
apps/api/src/routes/account-nps.ts     ← services/account-nps.ts
apps/api/src/routes/retirement.ts      ← services/retirement.ts
apps/api/src/jobs/index.ts:10-15       ← closePreviousDay, isSystemicFailure, snapshotAllUsers,
                                          type SnapshotPassResult   from services/networth.ts
apps/api/src/modules/ledger/services/transactions.ts:18
                                        ← isUniqueViolation   from services/sips.ts
apps/api/src/modules/credit/services/reconciliation-writes.ts:9
                                        ← repairSnapshots     from services/networth.ts
```

**Two already-migrated-module files import from still-flat investments files** — the same reverse-direction pattern tasks 1.1/1.2 each flagged for their own domain:

- `apps/api/src/modules/ledger/services/transactions.ts:17` (import) / `:320` (use site, in `updateTransaction`'s catch block):
  ```ts
  import { isUniqueViolation } from "../../../services/sips.ts";
  ...
    // A SIP's linked installment holds (sip_id, date) uniquely, so moving this
    // transaction onto the date of another installment of the same SIP collides.
    // Before `transactions.sip_id` was ever written (see linkSipInstallment in
    // services/sips.ts) this index could not fire from here at all — without this
    // catch the collision reaches the client as an unhandled 23505, i.e. a 500.
    if (isUniqueViolation(err, "transactions_sip_date_idx")) {
      throw new HttpError(409, "This SIP's installment is already recorded on that date — unlink it first");
    }
  ```
  When `sips.ts` moves to (presumably) `modules/investments/services/sips.ts`, this already-shipped ledger file's import path needs updating.

- `apps/api/src/modules/credit/services/reconciliation-writes.ts:9`:
  ```ts
  import { repairSnapshots } from "../../../services/networth.ts";
  ```
  (used inside `absorbCarryover`'s post-commit step per its own doc comment at `reconciliation-writes.ts:271-274`.) Same import-path-update-on-move needed for `networth.ts`.

No test file in `apps/api/src/modules/**` imports `sips.ts`/`networth.ts` directly — grepped `apps/api/src/modules/ledger/services/transactions.test.ts` and `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`; both only mention "sips"/"networth" in prose comments (e.g. `reconciliation-writes.test.ts:271,274,589`), not imports.

### (b) Investments files importing a still-flat sibling service, a still-flat table, or infra

- `services/goal-networth.ts:6` → `import { listAccounts } from "../modules/ledger/services/accounts.ts";` — **already-moved ledger file**, import path already correct, needs only depth adjustment once `goal-networth.ts` itself moves one directory deeper.
- `services/goal-networth.ts:5` → `import { goals } from "../db/schema.ts";` — `goals` is a **planning-owned table** per `tasks/01.05-migrate-planning.md:10` ("Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals, projection_settings"), still physically in `db/schema.ts` — no path change needed (table doesn't move), but it's a cross-module table reference from an investments-candidate file.
- `services/sips.ts:26` → `import { accounts, holdingEvents, holdings, sips, transactions } from "../db/schema.ts";` — mixed: `accounts`/`transactions` are ledger-owned, `holdingEvents`/`holdings`/`sips` are investments-owned — a split-import will be needed exactly as tasks 1.1/1.2 required.
- `services/sips.ts:28` → `import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "./goal-allocation.ts";` — `goal-allocation.ts` (99 lines) is a **shared, still-flat utility** also imported by `services/goals.ts` and `services/goal-returns.ts` (both planning-module files per `01.05`'s Routes list — confirmed by grep, `goal-allocation.ts` importers: `apps/api/src/services/goals.ts`, `apps/api/src/services/goal-returns.ts`, `apps/api/src/services/sips.ts`, plus its own `goal-allocation.test.ts`). This is a two-way shared dependency between the planning and investments module candidates, analogous to task 1.1's `periods.ts`/`recurring.ts` finding.
- `services/sips.ts:30` and `services/holdings.ts:19` → `import { assertOwnedGoal } from "./ownership.ts";` — `ownership.ts` (67 lines) is a **shared, still-flat utility** also imported by `modules/credit/services/emis.ts`, `modules/ledger/services/accounts.ts`, `modules/ledger/services/recurring.ts`, `modules/ledger/services/transactions.ts`, `services/budgets.ts`, `services/prefs.ts` — i.e. it's already consumed by two already-migrated modules plus several still-flat files; not investments-specific.
- `services/holdings.ts:18` → `import { fetchNavByCode } from "./amfi.ts";` — `amfi.ts` (63 lines) imported only by `holdings.ts` and `mf-import.test.ts`/`xirr.test.ts` (test-only, in-domain).
- `services/holdings.ts:20` → `import { defaultTaxClass } from "./tax-lots.ts";` — in-domain (`tax-lots.ts` has **zero imports of its own** — confirmed by `grep "^import" tax-lots.ts` returning nothing; it's pure money-math with no DB/infra dependency at all).
- `services/holdings.ts:21` → `import { positionCashFlows, xirrBps, type CashFlow } from "./xirr.ts";` — `xirr.ts` (270 lines) imported only by `holdings.ts` and its own `xirr.test.ts`; in-domain.
- `services/mf-import.ts:7` → `import { resolveScheme } from "./mf-scheme-map.ts";` — `mf-scheme-map.ts` (56 lines) imported only by `mf-import.ts` and `mf-import.test.ts`; in-domain.
- `services/networth.ts:8` → `import { portfolioValue } from "./holdings.ts";` — in-domain.
- `services/account-nps.ts:5` → `import { accountNpsDetails, accounts } from "../db/schema.ts";` — mixed (`accounts` ledger, `accountNpsDetails` investments per 01.03's Tables list) — split-import case, complicated further by the route-ownership conflict noted in §9.
- `services/retirement.ts:5` → `import { accounts, retirementDetails } from "../db/schema.ts";` — mixed (`accounts` ledger, `retirementDetails` protection-owned per 01.04) — **not** an investments-scope file at all (see §2).

### (c) Test files that cross-import

No colocated investments test file (`holdings.test.ts`, `sips.test.ts`, `networth.test.ts`, `goal-networth.test.ts`, `capital-gains.test.ts`, `tax-lots.test.ts`, `mf-import.test.ts`) imports from a still-flat sibling **outside** the investments domain — each imports only from its own same-named `.ts` file. `networth.test.ts:7` imports `AccountTypeSchema` from `@compass/shared` (the shared package, not a service file).

---

## 6. Existing tests — colocated `*.test.ts` files

```
  191 apps/api/src/services/holdings.test.ts       — cost-basis/FIFO unit ordering, dividend handling, sell-more-than-held clamp
 1026 apps/api/src/services/sips.test.ts           — committedSplit/classifySipTarget, create/update/delete lifecycle, linking/unlinking installments, date-math (firstOccurrenceOnOrAfter etc.)
  946 apps/api/src/services/networth.test.ts       — ACCOUNT_BUCKET exhaustiveness/mapping, snapshot upsert/backfill/repair, closePreviousDay ordering
   95 apps/api/src/services/goal-networth.test.ts  — groupByGoal/liabilitiesGroup pure-function grouping rules
   67 apps/api/src/services/capital-gains.test.ts  — Indian-FY (fyOf/fyRange) boundary math, exempt-gain rollup
  368 apps/api/src/services/tax-lots.test.ts       — FIFO lot matching, short/long-term boundary (incl. the 2024 24-vs-36-month reform date)
  305 apps/api/src/services/mf-import.test.ts      — CSV parsing (Kuvera format), scheme resolution, quoted-field handling
```

No colocated test exists for `services/holding-details.ts`, `services/account-nps.ts`, `services/retirement.ts` (confirmed — no `holding-details.test.ts`/`account-nps.test.ts`/`retirement.test.ts` found by `find`).

Investments-adjacent shared-utility tests, not colocated with any of the 8 tables but exercised by this domain's own service files: `apps/api/src/services/xirr.test.ts` (imported/used only by `holdings.ts`), `apps/api/src/services/goal-allocation.test.ts` (shared with planning's `goals.ts`/`goal-returns.ts`, see §5b).

**No route-level (`*.route.test.ts`) test exists for any of `holdings.ts`, `sips.ts`, `networth.ts`, `account-nps.ts`, `retirement.ts`.** `find apps/api/src -iname "*.route.test.ts"` returns only `projection-settings.route.test.ts` (planning, task 0.3), `ledger-events.route.test.ts` and `user-tasks.route.test.ts` (both ledger, task 1.1) — none for investments.

---

## 7. Net-worth daily scheduler

`apps/api/src/jobs/index.ts:141-149` — `LEDGER_DAY_SCHEDULERS` array (exact quote):
```ts
export const LEDGER_DAY_SCHEDULERS = [
  "recurring.materialize",
  "bills.remind",
  "cards.remind",
  "networth.snapshot",
  "networth.snapshot.close",
  "autopilot.review",
  "autopilot.goals",
] as const;
```

Scheduler registration (`jobs/index.ts:188-203`, exact quote):
```ts
  // nightly net-worth snapshot (one row per user per day, recomputed in place).
  // The date it files under comes from `snapshotDay()`, i.e. `toISOString()`.
  await system.upsertJobScheduler(
    "networth.snapshot",
    { pattern: "30 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "networth.snapshot" },
  );
  // ...then close out the day that just ended, once its transactions are all in.
  // Without this the 00:30 row above is the only record of a day, taken before
  // anything was entered, so history permanently understates it. Runs at 00:05 so
  // it lands just after the ledger day it closes actually ends.
  await system.upsertJobScheduler(
    "networth.snapshot.close",
    { pattern: "5 0 * * *", tz: LEDGER_DAY_TZ },
    { name: "networth.snapshot.close" },
  );
```
`LEDGER_DAY_TZ` itself, `jobs/index.ts:131`: `const LEDGER_DAY_TZ = "Etc/UTC";`. The worker case handlers for `"networth.snapshot"`/`"networth.snapshot.close"` (`jobs/index.ts:278-303`) call `snapshotAllUsers`/`closePreviousDay` — both imported from `../services/networth.ts` (`jobs/index.ts:10-15`).

Test enforcement — `apps/api/src/jobs/index.test.ts`:
```
5:import { LEDGER_DAY_SCHEDULERS, LOCAL_TIME_SCHEDULERS } from "./index.ts";
71:  const constantMatch = SOURCE_TEXT.match(/const\s+LEDGER_DAY_TZ\s*=\s*"([^"]+)"/);
73:  assert.equal(constantMatch[1], "Etc/UTC", "LEDGER_DAY_TZ must be Etc/UTC");
75:  for (const schedulerId of LEDGER_DAY_SCHEDULERS) {
121:    { id: "networth.snapshot", expected: 30 },
150:    assert.equal(closeMin, 5, "networth.snapshot.close must run at 00:05");
```
Both `networth.snapshot` and `networth.snapshot.close` are confirmed present in `LEDGER_DAY_SCHEDULERS` and covered by the source-text-regex test that pins `LEDGER_DAY_TZ = "Etc/UTC"` and asserts every listed scheduler id's registration options string matches `/tz:\s*LEDGER_DAY_TZ/`.

---

## 8. Demo-mode / mutating-route check

Mutating (POST/PATCH/PUT/DELETE) routes exist in all three route files: `holdings.ts` has 12 of its 16 (all but the 4 GETs), `sips.ts` has 6 of its 9, `networth.ts` has 1 of its 3 (`POST /api/net-worth/backfill`).

The demo-mode chokepoint itself lives in `apps/api/src/plugins/auth.ts:16` (`const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);`) and `auth.ts:68` — this file has **no colocated test of its own** (`find apps/api/src/plugins -name "*.test.ts"` returns only `security.test.ts`). Per tasks 1.1/1.2's own precedent, the demo-mode-403 characterization instead lives in a per-domain route test (e.g. `user-tasks.route.test.ts:288-289`'s `AC12` test for ledger). **No such route test exists today for holdings/sips/networth** — confirmed in §6, no `*.route.test.ts` file matches any of the three. So there is at least one mutating route a demo-mode-403 characterization test could target (e.g. `POST /api/sips` or `POST /api/net-worth/backfill`), but none currently exists.

---

## 9. Roadmap-text accuracy check

Checked every specific claim in `tasks/01.03-migrate-investments.md` against the code:

1. **"holdings (13 endpoints)" — wrong.** Actual count is **16** (§1, two independent methods agree). Same category of error as task 1.2's "cards (12 endpoints)" (actual 15).
2. **"`sips.ts` is the largest service in the repo (1319 lines)" — line count exact** (`wc -l` = 1319). Whether it is still literally "the largest service in the repo" was not separately re-verified against every other service file in this pass (out of scope for this investigation), but the self-contained numeric claim about `sips.ts` itself is correct.
3. **"`networth.ts` (581)" — exact** (`wc -l` = 581).
4. **"Note `holding_valuations` and `holding_events` have no `user_id` and scope via parent FK" — confirmed exactly** (§3): true for precisely these two tables, and does not extend to `nps_details`/`gold_details`/`account_nps_details` (all three carry their own `user_id` despite also having a parent FK).
5. **Missing filenames, not missing tables**: `services/holding-details.ts`, `services/capital-gains.ts`, `services/tax-lots.ts`, `services/mf-import.ts`, `services/xirr.ts`, `services/amfi.ts`, `services/mf-scheme-map.ts` are all investments-domain files not named anywhere in the roadmap's prose, though every table they touch (`nps_details`, `gold_details`, `holdings`, `holding_events`, `holding_valuations`) is in the roadmap's own Tables list. `services/goal-networth.ts` is also unnamed and is genuinely ambiguous in ownership — see next point.
6. **`services/goal-networth.ts` ownership is ambiguous.** It is consumed exclusively by `routes/networth.ts` (`netWorthByGoal`, backing `GET /api/net-worth/by-goal` — one of the 3 counted networth endpoints), which argues for investments ownership. But it imports `goals` (a planning-owned table per `01.05`) and `listAccounts` from the already-migrated `modules/ledger/services/accounts.ts`, and its own logic (grouping *assets* by *goal*) reads as much like planning/goal-tracking as portfolio math. Neither `01.03` nor `01.05`'s own Routes/Tables prose names this file.
7. **The `account-nps` route/table split is a genuine cross-task-file conflict, the most significant finding of this investigation.** `tasks/01.03-migrate-investments.md:10` claims table `account_nps_details` for investments. `tasks/01.04-migrate-protection.md:10` claims: `"Routes: insurance, retirement, account-nps. Tables: insurance_policies, insurance_health_cards, retirement_details."` — i.e. task 1.4's own text explicitly claims the `account-nps` **route** (`routes/account-nps.ts` + `services/account-nps.ts`, backing `GET/PUT /api/accounts/:accountId/nps-details`), while task 1.4's own Tables line does **not** list `account_nps_details` at all (only `retirement_details`). So the single `account_nps_details` table + its one route/service file pair is claimed by the *table* list of one roadmap task (1.3) and the *route* list of a different roadmap task (1.4), with neither task's own text internally acknowledging the other's claim. This is directly analogous to what task 007's investigation found for `imports.ts` (claimed as a "heaviest service" in 1.1's prose but explicitly owned by 1.7's own Tables/Routes line) and what task 008's investigation found for the `card-statements.ts`/reward-earn-rate-interface gaps — a same-shape "which task's own text is authoritative" question, not resolved here.
8. **`retirement.ts`/`retirement_details` correctly excluded from 01.03's scope** — confirmed protection-owned (1.4), not investments, despite the tempting "retirement" name; no discrepancy on this one.
9. No table or route file was found that is investments-domain-relevant (touches one of the 8 named tables) yet completely unlisted anywhere in any roadmap task's Tables line — every table found in schema.ts search is accounted for in either 01.03 or, for `retirement_details`, in 01.04.

---

## 10. `services/backup.ts` coverage

`apps/api/src/services/backup.ts:28-41` (`ALL_TABLES`) — all 8 named tables present (exact substrings, in the file's existing order):
```
"card_details", "card_issuer_settings", "card_statements", "bank_details", "retirement_details", "account_nps_details", "overdraft_details",
...
"reward_entries", "emi_details", "holdings", "nps_details", "gold_details",
"holding_valuations", "sips", "holding_events", "net_worth_snapshots",
```

`USER_TABLES` (`backup.ts:44-59`) — exact substrings:
```
holdings: "user_id", nps_details: "user_id", gold_details: "user_id",
net_worth_snapshots: "user_id",
```
and, on the earlier `card_details...` line: `... account_nps_details: "user_id", ...` and (separately, line 48) `... sips: "user_id", ...`. So `holdings`, `nps_details`, `gold_details`, `net_worth_snapshots`, `account_nps_details`, `sips` — **6 of the 8** — are `USER_TABLES`.

`LINKED_TABLES` (`backup.ts:66-74`) — exact substring:
```
holding_valuations: { fk: "holding_id", parent: "holdings" },
holding_events: { fk: "holding_id", parent: "holdings" },
```
The remaining **2 of the 8** (`holding_valuations`, `holding_events`) are `LINKED_TABLES`, matching the precedent set by `transaction_splits`/`attachments`/`transaction_links` in task 1.1 (child table, no `user_id`, scoped via parent FK — here the parent is `holdings` rather than `transactions`).

All 8 tables accounted for: 6 `USER_TABLES` + 2 `LINKED_TABLES` = 8. `retirement_details` is separately present as a `USER_TABLES` entry too (`backup.ts:51`) — consistent with it being a normal `user_id`-scoped table, just not one of the 8 investments tables. No gap found; a pure file move requires no change to `backup.ts` (it addresses tables by raw snake_case string literal, not by importing the Drizzle table objects — same fact task 1.2's investigation established for its own 8 tables).

---

## Other facts relevant to planning (not separately numbered above)

- `apps/api/src/modules/planning/plugin.ts` already exists (registered at `app.ts:41`, `planningRoutes`) but today wires up only `projectionSettingsRoutes` per task 0.3's own module-scaffold slice — its doc comment (`plugin.ts:6-13`) explicitly says "Task 1.5 registers the rest of the planning module here (budgets, goals, cashflow, bills, dashboard, insights, reports)." `goals`/`goal-allocation.ts`/`goal-networth.ts`/`goal-returns.ts` are therefore all still flat, pending task 1.5 — relevant since §5/§9 found investments files (`sips.ts`, `goal-networth.ts`) already reaching into planning-owned tables/utilities today.
- `packages/shared/src/schemas/sips.ts` and `packages/shared/src/schemas/wealth.ts` exist as the Zod-schema sources for this domain's DTOs (`CreateSipSchema`, `HoldingSchema`, `PortfolioSchema`, `NetWorthReportSchema`, etc.) — not separately investigated in depth (out of the brief's ask), noted for completeness.
- `apps/web/src` was grepped for direct imports of any investments `services/*.ts` file — none found; the two grep hits (`apps/web/src/routes/sips/sip-recording.ts:8`, `apps/web/src/routes/investments/PortfolioPage.tsx:471`) are prose comments cross-referencing the API service's logic by name, not actual imports. Confirms the web side only ever consumes `@compass/shared`, as the ledger/credit precedents also found.
