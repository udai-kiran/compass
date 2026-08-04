# Investigation 1 — protection domain survey (task 1.4 / `01.04-migrate-protection.md`)

Read-only. No source file modified. Working tree note: at the time of this investigation, tasks
1.1/1.2/1.3 (ledger/credit/investments migrations) are present in the **uncommitted working tree**
(`git status` shows `modules/ledger`, `modules/credit`, `modules/investments` as untracked new
directories, and dozens of `D`eleted flat `routes/*.ts` / `services/*.ts`), even though
`tasks/010-migrate-investments/TASK.md` marks itself `COMPLETE`. All findings below are against this
current working-tree state (the state the coordinator will build task 1.4 on top of), not against
`HEAD`/`git log`.

## 1. Routes

Exactly two route files belong to protection: `apps/api/src/routes/insurance.ts` and
`apps/api/src/routes/retirement.ts`. `find apps/api/src -iname "*insurance*" -o -iname "*retirement*"`
returns exactly 4 paths total (these 2 route files + their 2 same-named service files) — no other file
name matches, so no third route file exists.

**`apps/api/src/routes/insurance.ts` (166 lines) — 12 (METHOD, URL) pairs:**
| # | Line | Method | URL |
|---|---|---|---|
| 1 | 33 `r.get` | GET | `/api/insurance/policies` |
| 2 | 39 `r.post` | POST | `/api/insurance/policies` |
| 3 | 45 `r.put` | PUT | `/api/insurance/policies/:id` |
| 4 | 57 `r.delete` | DELETE | `/api/insurance/policies/:id` |
| 5 | 69 `app.post` | POST | `/api/insurance/policies/:id/document` |
| 6 | 82 `app.get` | GET | `/api/insurance/policies/:id/document` |
| 7 | 96 `r.delete` | DELETE | `/api/insurance/policies/:id/document` |
| 8 | 106 `app.post` | POST | `/api/insurance/policies/:id/health-cards` |
| 9 | 123 `app.get` | GET | `/api/insurance/health-cards/:cardId` |
| 10 | 137 `r.delete` | DELETE | `/api/insurance/policies/:id/health-cards/:cardId` |
| 11 | 149 `r.get` | GET | `/api/insurance/policies/:id/premiums` |
| 12 | 155 `r.post` | POST | `/api/insurance/policies/:id/premiums` |

**`apps/api/src/routes/retirement.ts` (30 lines) — 2 (METHOD, URL) pairs:**
| # | Line | Method | URL |
|---|---|---|---|
| 1 | 12 `r.get` | GET | `/api/retirement/:accountId/details` |
| 2 | 18 `r.put` | PUT | `/api/retirement/:accountId/details` |

**Total: 14 endpoints** (12 + 2).

`tasks/01.04-migrate-protection.md` (full text, 18 lines) does not state any numeric endpoint count —
its one-line summary is `Routes: insurance, retirement. Tables: insurance_policies,
insurance_health_cards, retirement_details.` No discrepancy to flag since no count is claimed (unlike
`01.03-migrate-investments.md`, which did claim a count and needed correction per that task's own
changelog).

Cross-check against the canonical route-surface snapshot (`apps/api/src/route-surface.snapshot.txt`,
§12 below) confirms all 14 non-HEAD (method,url) pairs are present verbatim; Fastify auto-adds a `HEAD`
variant for every `GET`, so the snapshot additionally lists 5 `HEAD` lines (one per distinct GET path:
`/api/insurance/health-cards/:cardId`, `/api/insurance/policies`, `/api/insurance/policies/:id/document`,
`/api/insurance/policies/:id/premiums`, `/api/retirement/:accountId/details`) — not a 15th/16th real
endpoint.

## 2. Services

Exactly two service files: `apps/api/src/services/insurance.ts` (334 lines) and
`apps/api/src/services/retirement.ts` (73 lines). No `*-details.ts`, health-card, or policy-document
helper file exists outside these two — `find apps/api/src -iname "*insurance*" -o -iname "*retirement*"`
(§1) is exhaustive proof; no basename-adjacent file (e.g. `insurance-uploads.ts`) exists anywhere in
`apps/api/src`.

**`services/insurance.ts` (334 lines).** Exported symbols (all `export async function` unless noted):
`listPolicies`, `createPolicy`, `updatePolicy`, `deletePolicy`, `savePolicyDocument`,
`readPolicyDocument`, `deletePolicyDocument`, `addHealthCard`, `readHealthCard`, `deleteHealthCard`,
`listPolicyPremiums`, `logPremium` — 12 exported functions, plus private helpers `toHealthCard`,
`toPolicy`, `getPolicyWithCards`, `ownedPolicy`. Purpose: CRUD for insurance policies, policy-document
and health-card file upload/download via `Storage`, and premium-payment logging (creates a real ledger
transaction tagged `policyId`).

**`services/retirement.ts` (73 lines).** Exported symbols: `getRetirementDetails`,
`upsertRetirementDetails`, plus private helpers `toDetails`, `ownedRetirementAccount`. Purpose: per-account
(PPF/EPF/SSY) retirement detail upsert/read, gated by `isRetirementAccount(acc.type)` from
`@compass/shared`, with EPF/PPF-specific field nulling (EPS balance only for EPF, no maturity date for
EPF).

## 3. Tables + enums

From `apps/api/src/db/schema.ts`, exactly 3 tables and 4 enums are protection-owned:

| Export identifier | Line | Kind |
|---|---|---|
| `retirementDetails` | 951 | table (`retirement_details`) |
| `insuranceKind` | 997 | enum (`insurance_kind`: life/health/vehicle) |
| `vehicleKind` | 998 | enum (`vehicle_kind`: car/bike/other) |
| `healthType` | 999 | enum (`health_type`, 6 values) |
| `premiumFrequency` | 1007 | enum (`premium_frequency`, 5 values) |
| `insurancePolicies` | 1023 | table (`insurance_policies`) |
| `insuranceHealthCards` | 1083 | table (`insurance_health_cards`) |

Exhaustiveness method: `grep -n "^export const.*pgEnum\|^export const.*pgTable" db/schema.ts` over the
whole file (all ~60 top-level table/enum declarations), manually walked line-by-line from line 39 to
1300+; every declaration between `overdraftDetails` (982, credit-owned) and `rewardEntries` (1104,
credit-owned) belongs to protection and only those 7 identifiers do. No other table/enum anywhere in the
file references "insurance" or "retirement" in its identifier or comment.

This is the exact thin-re-export list for `modules/protection/schema.ts`: **3 tables + 4 enums = 7
bindings**.

## 4. FK graph

**`insurancePolicies`**
- Outbound: `resourceId → resources.id` (`onDelete: "set null"`, schema.ts:1038) — `resources` is
  **ledger-owned, already migrated** (confirmed re-exported from `modules/ledger/schema.ts:29`).
  `userId → users.id` (schema.ts:1029) — core (`db/core-schema.ts`, implicit via `users` import).
- Inbound: `insuranceHealthCards.policyId → insurancePolicies.id` (`onDelete: "cascade"`,
  schema.ts:1089) — in-domain (protection). `transactions.policyId → insurancePolicies.id`
  (`onDelete: "set null"`, schema.ts:334, uses `AnyPgColumn` lazy-ref) — `transactions` is
  **ledger-owned, already migrated**.

**`insuranceHealthCards`**
- Outbound: `policyId → insurancePolicies.id` (cascade, in-domain, self-loop within protection).
  `userId → users.id` — core.
- Inbound: none found (grep of `insuranceHealthCards\.(id)` across `db/schema.ts` matches only its own
  declaration).

**`retirementDetails`**
- Outbound: `accountId → accounts.id` (`onDelete: "cascade"`, primary key, schema.ts:954) — `accounts`
  is **ledger-owned, already migrated**. `userId → users.id` — core.
- Inbound: none found (no other table references `retirementDetails`).

**Exact count: 3 outbound FK columns to still-flat/other-module tables total**
(`insurancePolicies.resourceId`, `insurancePolicies.userId`, `insuranceHealthCards.userId`,
`retirementDetails.accountId`, `retirementDetails.userId` — of these, the 2 `userId` FKs on each table
go to core `users`, not a peer module, so the count of FKs into a **non-core peer module** is exactly 2:
`insurancePolicies.resourceId → resources` and `retirementDetails.accountId → accounts`, both already
inside `modules/ledger`) **and exactly 2 inbound FK columns from other-module tables**
(`transactions.policyId → insurancePolicies.id`, also ledger, already migrated) plus 1 in-domain inbound
(`insuranceHealthCards.policyId → insurancePolicies.id`, doesn't cross a module boundary). Method: full
`grep -n "insurancePolicies\|insuranceHealthCards\|retirementDetails"` across `db/schema.ts` (6 hits
total, quoted above) proves exhaustiveness — every reference to any of the 3 tables in the entire schema
file is accounted for.

No still-flat (non-core, non-already-migrated-module) table references or is referenced by any
protection table — every cross-domain edge protection has today points at `modules/ledger` (already
done), which is the simplest FK situation of any of the 4 migrated/candidate domains so far.

## 5. Cross-import inventory

**(a) Non-test files anywhere importing FROM a protection service/route file** — searched
`apps/api/src`, `apps/ingestor/src`, `apps/extractor/src`, `packages/*` via
`grep -rn "services/insurance\.ts\|services/retirement\.ts\|routes/insurance\.ts\|routes/retirement\.ts"`
(catches every relative depth since it matches the tail of the specifier, not just `./`) plus a second,
independent basename-aware pass `grep -rln "insurance\.ts\|retirement\.ts"` over all of `apps/api/src`.
Both agree on the same 6 hits:
- `apps/api/src/app.ts:31` — `import { retirementRoutes } from "./routes/retirement.ts";`
- `apps/api/src/app.ts:32` — `import { insuranceRoutes } from "./routes/insurance.ts";`
- `apps/api/src/routes/insurance.ts:26` — `} from "../services/insurance.ts";` (own route→service import)
- `apps/api/src/routes/retirement.ts:5` — `import { getRetirementDetails, upsertRetirementDetails } from "../services/retirement.ts";` (own route→service import)
- `apps/api/src/db/schema.ts:332` — prose comment only, "See services/insurance.ts." — not an import
- `apps/api/src/modules/investments/services/holding-details.ts:3` — prose comment only, "Mirrors
  services/retirement.ts on the accounts side." — not an import

**Count: 2 real production import statements from outside the domain** (both in `app.ts`, both simply
registering the route plugin — the standard pattern every prior migration's `app.ts` edit follows), plus
2 stale/harmless doc-comments (not imports, no compile/runtime effect — same class of drift task 1.3
explicitly declined to chase down). **No other file in `apps/api/src`, `apps/ingestor`, `apps/extractor`,
or `packages/*` imports anything from `routes/insurance.ts`, `routes/retirement.ts`,
`services/insurance.ts`, or `services/retirement.ts`.** This is the smallest external-import footprint
of any of the 4 migrations investigated so far (ledger/credit/investments each needed 4-6+ updates in
`services/*.ts` outside the domain).

**(b) Imports INSIDE the protection files pointing OUT**, classified:
- `routes/insurance.ts:12` — `import { MAX_ATTACHMENT_BYTES } from "../modules/ledger/services/attachments.ts";` — **already-migrated module** (ledger). Already points at the new location (not a stale flat path) — confirms task 1.1's own migration already updated this import.
- `routes/insurance.ts:11` — `import { HttpError } from "../lib/errors.ts";` — infra.
- `routes/insurance.ts:1-10` — `fastify`, `fastify-type-provider-zod`, `zod`, `@compass/shared` — infra/shared.
- `routes/insurance.ts:13-26` — `import { ... } from "../services/insurance.ts";` — in-domain (moves with it).
- `services/insurance.ts:16` — `import { insuranceHealthCards, insurancePolicies, transactions } from "../db/schema.ts";` — mixed: `insuranceHealthCards`/`insurancePolicies` in-domain (redirect to `./schema.ts` once moved); `transactions` — **already-migrated module** (ledger) — split import required at implementation time.
- `services/insurance.ts:19` — `import { assertUploadable } from "../modules/ledger/services/attachments.ts";` — already-migrated module, already correct path.
- `services/insurance.ts:20` — `import { createTransaction } from "../modules/ledger/services/transactions.ts";` — already-migrated module, already correct path.
- `services/insurance.ts:21` — `import { assertOwnedResource } from "../modules/ledger/services/resources.ts";` — already-migrated module, already correct path.
- `services/insurance.ts:1-14,17-18` — `drizzle-orm`, `@compass/shared` (types + schemas), `../db/index.ts` (`Db` type), `../lib/errors.ts`, `../lib/storage.ts` (`Storage` type) — infra/shared.
- `routes/retirement.ts:1-4` — `fastify`, `fastify-type-provider-zod`, `zod`, `@compass/shared` — infra/shared.
- `routes/retirement.ts:5` — `import { getRetirementDetails, upsertRetirementDetails } from "../services/retirement.ts";` — in-domain.
- `services/retirement.ts:1-4` — `drizzle-orm`, `@compass/shared`, `../db/index.ts` — infra/shared.
- `services/retirement.ts:5` — `import { accounts, retirementDetails } from "../db/schema.ts";` — mixed: `retirementDetails` in-domain; `accounts` — **already-migrated module** (ledger) — split import required.
- `services/retirement.ts:6` — `import { HttpError } from "../lib/errors.ts";` — infra.

**Count: 9 distinct import statements inside the 4 protection files that reach outward** (excluding the
2 in-domain route→service imports and pure infra/shared-package imports counted separately above); of
these, exactly **2 require a split-import rewrite when the tables move to `modules/protection/schema.ts`**
(`services/insurance.ts:16` and `services/retirement.ts:5`, each mixing an in-domain table name with a
ledger-owned one in the same `db/schema.ts` import statement) and **3 already point at
`modules/ledger/services/...`** (no change needed — `routes/insurance.ts:12`,
`services/insurance.ts:19-21`, three separate named imports from `attachments.ts`/`transactions.ts`/
`resources.ts`, all already correctly repointed by task 1.1's own migration). Notably: **zero** imports
to any still-flat (not-yet-migrated) sibling service exist in either protection file — every
outward-pointing import in `services/insurance.ts` and `services/retirement.ts` targets either
`db/schema.ts` or an already-migrated ledger module, unlike investments (which had still-flat
`goal-allocation.ts`/`ownership.ts` dependencies) or credit.

**(c) Test files importing a protection production file** — `find apps/api/src -iname "*insurance*" -o
-iname "*retirement*"` (§1/§2) returns exactly 4 paths, none named `*.test.ts` or `*.route.test.ts`.
Corroborated by a second, independent search: `grep -rln "from \"\.\./services/insurance\.ts\"\|from
\"\.\./services/retirement\.ts\"\|from \"\.\./routes/insurance\.ts\"\|from \"\.\./routes/retirement\.ts\""
apps/api/src` (which would also catch a test importing at a different relative depth) returns zero
hits outside the 2 route files' own same-domain imports already listed in (a). **Count: 0 test files
import any protection production file.** This is consistent with §6's finding that no test file for
this domain exists at all.

## 6. Tests

**No test file exists for the protection domain today.** `find apps/api/src -iname "*insurance*" -o
-iname "*retirement*"` returns exactly `routes/insurance.ts`, `routes/retirement.ts`,
`services/insurance.ts`, `services/retirement.ts` — no colocated `insurance.test.ts`,
`retirement.test.ts`, `insurance.route.test.ts`, or `retirement.route.test.ts` anywhere. Zero test files,
zero `test(...)` cases, zero coverage of any kind for this domain.

**Demo-mode-403 route test check:** `grep -ln "demo\|403"` was run over every existing
`*.route.test.ts` in the repo (`apps/api/src/modules/investments/routes/networth.route.test.ts`,
`apps/api/src/modules/ledger/routes/ledger-events.route.test.ts`,
`apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`,
`apps/api/src/modules/planning/routes/projection-settings.route.test.ts`) — 3 of the 4 match ("demo" or
"403" text present: planning, ledger's `user-tasks.route.test.ts`, and investments' `networth.route.test.ts`),
none of which is insurance/retirement (none exists, per above). **Confirmed: no demo-mode-403 route test
exists for insurance or retirement today** — same standing gap task 1.3 found and closed for
holdings/sips/networth/account-nps (`tasks/README.md`'s Known-traps obligation applies here too).

## 7. Storage

`routes/insurance.ts` calls `app.storage` directly at 7 call sites: lines 61 (`deletePolicy(...,
app.storage)`), 74/86/100/114/127/146 (`savePolicyDocument`, `readPolicyDocument`,
`deletePolicyDocument`, `addHealthCard` ×2 call sites at 114/127, `deleteHealthCard`). `services/
insurance.ts:18` imports `type { Storage } from "../lib/storage.ts"` and threads it as a parameter
through `deletePolicy`, `savePolicyDocument`, `readPolicyDocument`, `deletePolicyDocument`,
`addHealthCard`, `readHealthCard`, `deleteHealthCard` (7 functions taking a `Storage` parameter). The
upload endpoints are `POST /api/insurance/policies/:id/document` (line 69) and `POST
/api/insurance/policies/:id/health-cards` (line 106); download endpoints are `GET
/api/insurance/policies/:id/document` (line 82) and `GET /api/insurance/health-cards/:cardId` (line 123).

`services/retirement.ts` has **no** `Storage`/`app.storage` reference at all — confirmed by `grep -n
"app.storage\|lib/storage" apps/api/src/routes/retirement.ts apps/api/src/services/retirement.ts`
returning zero matches. Storage usage is exclusively in the insurance half of the domain.

This is confirmed distinct from `routes/attachments.ts` — that file no longer exists as a flat file at
all (`git status` shows `D apps/api/src/routes/attachments.ts`); it has already moved to
`apps/api/src/modules/ledger/routes/attachments.ts` (ledger-owned, task 1.1, already migrated) and backs
transaction-level attachments, a separate feature from insurance's own policy-document/health-card
uploads. `routes/insurance.ts:12` only imports the `MAX_ATTACHMENT_BYTES` **constant** from the
ledger module's `services/attachments.ts` (shared file-size limit), not any attachments route/table —
`services/insurance.ts:19` similarly imports only the `assertUploadable` validation helper, not
attachment storage/records themselves. Insurance's own uploads write to `insurancePolicies.documentPath`
/ `insuranceHealthCards.storedPath` columns directly (§3), not to the `attachments` table.

## 8. Jobs / schedulers

`grep -n "renewalDate\|renewal_date\|policy.*remind\|insurance.*remind" apps/api/src` (excluding test
files and `schema.ts`) returns **zero matches** anywhere in the codebase — no policy-renewal-reminder
feature exists today. `grep -n "import\|from \"" apps/api/src/jobs/index.ts | grep -i "services/"`
lists every service import in `jobs/index.ts` (10 lines: `services/notifications.ts`,
`services/bills.ts`, `modules/credit/services/alerts.ts`, `modules/credit/services/
card-due-tasks.ts`, `services/anomaly.ts`, `services/autopilot.ts`, `modules/investments/services/
networth.ts`, `services/backup.ts`, `services/prefs.ts`, `modules/ledger/services/recurring.ts`) — **no
line references `services/insurance.ts` or `services/retirement.ts`, and no scheduler is registered for
either.** `jobs/index.ts` requires no changes for this migration beyond what would already be required if
any import path pointed at protection (none does).

## 9. Other consumers

- `services/backup.ts:35-36` — `ALL_TABLES` **already lists all 3 protection tables**: `"...
  retirement_details, account_nps_details, overdraft_details", "insurance_policies,
  insurance_health_cards"` (verbatim, lines 35-36).
- `services/backup.ts:51-52` — `USER_TABLES` **already lists all 3**: `bank_details: "user_id",
  retirement_details: "user_id", account_nps_details: "user_id",` (line 51) / `overdraft_details:
  "user_id", insurance_policies: "user_id", insurance_health_cards: "user_id",` (line 52).
- `services/backup.ts:148-151` — `FILE_COLUMNS` already lists the 2 file-bearing protection columns:
  `{ table: "insurance_policies", column: "document_path" }` (150), `{ table: "insurance_health_cards",
  column: "stored_path" }` (151) — alongside `attachments.stored_path` (149, ledger) and
  `card_statements.stored_path` (152, credit). **`backup.ts` needs no change for this migration** — all
  coverage is already present; the migration only needs to keep it green (`backup.test.ts`), per the
  roadmap's own AC1.
- `services/restore-user.ts:14` — `const MUST_BE_EMPTY = ["accounts", "transactions",
  "insurance_policies", "goals", "holdings"] as const;` — references `insurance_policies` by string
  table name (not an import of `services/insurance.ts`), used as a pre-restore emptiness guard.
- `services/restore-user.ts:19` — `const mime = table === "insurance_policies" ? row?.document_mime :
  row?.mime_type;` — same file, string-keyed table-name branch for MIME-type resolution during restore.
- `services/demo.ts:19,22` — imports `insurancePolicies`, `retirementDetails` directly from
  `../db/schema.ts` (not from `services/insurance.ts`/`services/retirement.ts`); `services/demo.ts:139`
  seeds `retirementDetails` rows, `services/demo.ts:225` seeds `insurancePolicies` rows. This is a
  direct-table-write pattern (same as every other domain's demo seeding) — not a protection-service
  import, so out of §5(a)'s external-consumer count, but a real `db/schema.ts`-level dependency worth
  noting: once `insurancePolicies`/`retirementDetails` are re-exported from
  `modules/protection/schema.ts`, `services/demo.ts` is not required to change its import source (same
  precedent as 1.1/1.2/1.3 — `db/schema.ts` keeps exporting the raw tables; consumers outside the moved
  module keep importing from the barrel unless the task chooses to repoint them, which prior tasks did
  not do for demo.ts).
- `services/dashboard.ts`, `services/notifications.ts`, `apps/api/src/jobs/index.ts`,
  `apps/api/src/services/ai/tools.ts` — `grep -n "insurance\|retirement"` on each returns **zero
  matches**. `services/search.ts` no longer exists as a flat file (already moved to
  `modules/ledger/services/search.ts` per task 1.1; not re-checked here as out of scope, but confirmed
  not to exist at its old path).

## 10. Roadmap accuracy check

Full text of `tasks/01.04-migrate-protection.md` (18 lines) read in full (reproduced in relevant part
above, §1). Findings:
- **Route list "insurance, retirement" is accurate and complete** — confirmed exhaustively in §1, no
  third route file exists.
- **Table list "insurance_policies, insurance_health_cards, retirement_details" is accurate and
  complete** — confirmed exhaustively in §3, no fourth table/enum-owning table exists.
- **No stale `account-nps` mention exists in the current text** — `grep -n "account-nps\|account_nps"
  tasks/01.04-migrate-protection.md` returns zero matches. Cross-checked against
  `tasks/010-migrate-investments/TASK.md`'s own claim (its "Scope decision 1", quoted in that file) that
  it corrected `01.04-migrate-protection.md`'s Routes line to remove an `account-nps` mention — **this
  correction is confirmed actually present in the current file** (the working tree's `01.04` text has no
  `account-nps` anywhere). `account-nps.ts` (both route and service) is confirmed fully relocated to
  `apps/api/src/modules/investments/{routes,services}/account-nps.ts` (`find apps/api/src -iname
  "*account-nps*"` returns only those 2 paths, both under `modules/investments/`) — no flat
  `routes/account-nps.ts` or `services/account-nps.ts` remains.
- **Gaps not stated as gaps, but not inaccuracies either**: the roadmap prose doesn't name the exact
  4 enums (`insuranceKind`, `vehicleKind`, `healthType`, `premiumFrequency`) or give a file/line count —
  consistent with every other `01.0N-migrate-*.md` file's terseness (none of the others name their enums
  in prose either, e.g. `01.03`'s own original text before its task-file corrections). Not a defect
  specific to this file.
- **No factual inaccuracy found** in `01.04-migrate-protection.md`'s current text — unlike `01.03`
  (which needed an endpoint-count fix) or the credit/ledger tasks' own documented corrections, this
  domain's roadmap entry is already accurate against the current code, likely because task 1.3's own
  Scope-decision-1 fix already resolved the one real cross-file conflict (`account-nps`) before this
  investigation ran.

**Other roadmap task files checked for protection claims**: `grep -n "insurance\|retirement\|protection"
tasks/01.05-migrate-planning.md tasks/01.06-migrate-automation.md tasks/01.07-migrate-ingest.md
tasks/01.08-migrate-system.md tasks/01.09-cross-module-ports.md` — only one hit, in
`01.09-cross-module-ports.md:12`: *"Primary case: net worth reaching into ledger, credit, investments and
protection to classify balances into buckets — becomes a `NetWorthContributor` port each module
implements."* This is a forward-looking architectural reference to the protection module existing in the
future (task 1.9 depends on all of 1.1-1.8 being done), not a claim about any specific protection
route/service/table — no conflict with `01.04`'s own scope.

## 11. Size check

`services/insurance.ts` — 334 lines. `routes/insurance.ts` — 166 lines. `services/retirement.ts` — 73
lines. `routes/retirement.ts` — 30 lines. **None exceeds 500 lines** — no split along seams is warranted
for any of the 4 files, unlike `cards.ts` (task 1.2) or `sips.ts` (task 1.3). `services/insurance.ts`
does have 3 internal comment-delimited sections (`// ---------- Policy document ... ----------` at line
156, `// ---------- Health cards ... ----------` at line 220, plus the unlabeled top CRUD section) but at
334 total lines this is well under any precedent split threshold.

## 12. Snapshot gate

Both files exist: `apps/api/src/route-surface.snapshot.txt` (7.7 KB) and
`apps/api/src/route-table.snapshot.txt` (6.1 KB) — confirmed via `ls -la`.

`app.route-snapshot.test.ts` (170 lines) uses each differently, per its own header comment (lines 8-46):
- `route-surface.snapshot.txt` is the **canonical, byte-frozen (method,path)-pair list**, captured once
  by task 1.1's P2 and never regenerated since — "every later comparison ... is against this same
  committed file. A pure registration-structure change ... must NOT change this snapshot." Test at
  lines 80-118 builds a hermetic Fastify instance, walks `onRoute` hooks, sorts+joins `${method}
  ${url}` pairs, and does a literal `===` comparison (no trim) against the file's exact bytes.
- `route-table.snapshot.txt` is the **raw, regenerate-and-diff-review `printRoutes()` tree** — "sensitive
  to registration/plugin-nesting structure ... stays a hard, byte-for-byte regression gate, but with an
  explicit exception policy: if you deliberately restructured route registration ... regenerate this
  file and justify the diff ... do not silently accept it." Test at lines 120-132 does a literal `===`
  via `assertRouteTableMatches`.

Current insurance/retirement lines in the canonical `route-surface.snapshot.txt` (14 non-HEAD +
5 auto-HEAD lines, all confirmed matching §1's route enumeration exactly):
```
13: DELETE /api/insurance/policies/:id
14: DELETE /api/insurance/policies/:id/document
15: DELETE /api/insurance/policies/:id/health-cards/:cardId
75: GET /api/insurance/health-cards/:cardId
76: GET /api/insurance/policies
77: GET /api/insurance/policies/:id/document
78: GET /api/insurance/policies/:id/premiums
93: GET /api/retirement/:accountId/details
157: HEAD /api/insurance/health-cards/:cardId
158: HEAD /api/insurance/policies
159: HEAD /api/insurance/policies/:id/document
160: HEAD /api/insurance/policies/:id/premiums
175: HEAD /api/retirement/:accountId/details
240: POST /api/insurance/policies
241: POST /api/insurance/policies/:id/document
242: POST /api/insurance/policies/:id/health-cards
243: POST /api/insurance/policies/:id/premiums
278: PUT /api/insurance/policies/:id
282: PUT /api/retirement/:accountId/details
```
Current insurance/retirement lines in the raw `route-table.snapshot.txt` (3 lines — `printRoutes()`
groups by shared path prefix, so nested sub-paths collapse into the same tree node rather than one line
per endpoint):
```
74: ├── /api/retirement/:accountId/details (GET, HEAD, PUT)
97: ├── /api/insurance/policies (GET, HEAD, POST)
103: ├── /api/insurance/health-cards/:cardId (GET, HEAD)
```

## app.ts wiring (context for the plan, not a separate numbered question)

`app.ts:31-32` imports `retirementRoutes`/`insuranceRoutes` directly from flat `./routes/retirement.ts` /
`./routes/insurance.ts`; `registerRoutes()` (`app.ts:110-134`) registers them at lines 123-124, both
still flat/uncollapsed (`await app.register(retirementRoutes); await app.register(insuranceRoutes);`),
positioned after `creditRoutes` (line 122) and before `insightRoutes` (line 125) — i.e. between the
already-migrated credit module and the still-flat `routes/insights.ts`. `app.ts:83-108`'s own header
comment (updated through task 1.3) explicitly documents this ordering: *"`holdingRoutes`/`netWorthRoutes`
used to register after `insuranceRoutes`"* — meaning `insuranceRoutes`/`retirementRoutes` registration
position is itself unchanged by any prior migration and is exactly where task 1.4 will replace 2 calls
with 1 `await app.register(protectionRoutes)`.
