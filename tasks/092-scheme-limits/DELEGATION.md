# Worker Delegation

## Task
13.6 PPF / SSY / NPS Contribution-Limit & Eligibility Checks (`tasks/092-scheme-limits`)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: structural opening-balance exclusion against an unfamiliar ledger
shape, NPS LEFT JOIN classification subtleties (mismatched-user detail rows),
PPF end-of-opening-FY maturity arithmetic, SSY age-gate date math, and a
nine-state statusCode machine — several plausible wrong implementations exist
for each.

## Approved Plan
Canonical spec = `tasks/092-scheme-limits/TASK.md` (read it IN FULL first — it
supersedes this summary wherever they differ).
- P1 `apps/api/src/lib/scheme-limits.ts` (+ `.test.ts`): pure FY-aware SchemeRules
  data — PPF min 50_000/max 15_000_000/multiple ₹50/discontinuedBelowMin true/
  revivalPenaltyPerYear **55_000**/deductionSection '80C'; SSY min 25_000/
  max 15_000_000/'80C'; NPS tier-I min 100_000/max null/deductionSection null.
- P2 `db/shared/hubs.ts`: add nullable `schemeOpenedDate` DATE column to accounts;
  expose in `packages/shared/src/schemas/ledger.ts` Account/Create/Update schemas
  (NOT wealth.ts) and `toAccount()` in ledger accounts service; fix any deepEqual
  schema-test expectations; offline-generate migration:
  `cd apps/api && DATABASE_URL="postgres://localhost:5432/offline" npm run db:generate`
- P3 Zod compliance schemas in `packages/shared/src/schemas/tax.ts`.
- P4 `modules/tax/services/scheme-compliance.ts` (+ test): postings query EXACTLY
  per TASK.md "review-3 canonical" block (user scoping, deletedAt null,
  NOT EXISTS opening-system-account posting, gt(0), inclusive fyRange);
  NPS per LEFT JOIN + post-retrieval classification block (null detail →
  data_missing, tier_ii excluded silently, tier_i included); result contract per
  TASK.md interface — `eligible80CPaise` present on every result, null for NPS;
  `npsEmployeeContributionPaise` present, null for PPF/SSY; NO CCD fields;
  PPF maturity = 15y from END of opening FY, post-maturity → lifecycle_unknown;
  SSY holder DOB via family_members (join requires family_members.user_id =
  userId), age>10 at opening → data_invalid, outside 15y window →
  outside_deposit_window, gender gap noted in notes[]; missing scheme_opened_date
  → data_missing; isEstimate true everywhere.
- P5 routes: GET /scheme-compliance?fy= and GET /scheme-compliance/:accountId?fy=
  (statics before params) in tax plugin prefix.
- P6 register plugin; P7 regenerate BOTH route snapshots (legitimately changed).
- P8 tests per TASK.md P8 list incl. boundary values 49_999/50_000 paise, exact
  10th birthday, NPS detail row owned by DIFFERENT user → data_missing,
  cross-user transaction, soft-deleted transaction, opening-balance exclusion.

## Files and Symbols
lib/scheme-limits{,.test}.ts · db/shared/hubs.ts · modules/ledger/services/accounts.ts
(toAccount) · packages/shared/src/schemas/{ledger,tax}.ts · modules/tax/services/
scheme-compliance{,.test}.ts · modules/tax/routes/scheme-compliance.ts ·
modules/tax/plugin.ts · drizzle/0018_* · both route snapshots

## Must Not Change
EPF files (epf-contributions*, payslip-parse*, migration 0016); income-events
files + migration 0017; any table other than accounts; decomposition table count
(stays 78 — column add only, NO backup-array changes needed for columns);
existing route paths/methods outside the two new endpoints.

## Commands
npm run typecheck · npm run lint · node --test on each new/changed test file ·
npm run test -w packages/shared · node --test apps/api/src/app.route-snapshot.test.ts
(and the printRoutes twin if separate)

## Required Evidence
files changed · diff summary per file · literal outputs · exit codes · deviations
→ report to `tasks/092-scheme-limits/implementation-1.md`

## Iteration 2 — Resume after OpenRouter mid-task interruption

The first attempt died mid-task (OpenRouter 402 credit error) after finishing
P1 and starting P2. **`tasks/092-scheme-limits/implementation-1.md` was never
written — it does not exist.** Coordinator has personally verified current
disk state by direct `Read` (not trusted from the dead worker's chat output).
Confirmed-done, do NOT redo:
- P1 `apps/api/src/lib/scheme-limits.ts` + `.test.ts` — complete, matches
  spec exactly (values, revival penalty 55_000, PPF end-of-opening-FY
  maturity, SSY window, `completedYearsBetween` boundary semantics incl.
  exact-10th-birthday = still eligible).
- P2 (partial) `apps/api/src/db/shared/hubs.ts` — `schemeOpenedDate` nullable
  DATE column added to `accounts` with a correct doc comment. Done.
- P2 (partial) `packages/shared/src/schemas/ledger.ts` — `AccountSchema` has
  `schemeOpenedDate: z.string().nullable()` (~line 204); `CreateAccountSchema`
  has `schemeOpenedDate: z.iso.date().nullable().default(null)` (~line 260).
  Done.

Confirmed NOT done — this is the remaining work:
- P2 gap: `UpdateAccountSchema` in the same file (~lines 264-278) has NO
  `schemeOpenedDate` field. Add `schemeOpenedDate: z.iso.date().nullable().optional()`
  (optional — omitted means unchanged, consistent with every other field on
  this schema).
- P2 gap: `toAccount()` in `apps/api/src/modules/ledger/services/accounts.ts`
  (~lines 136-153) does NOT map `row.schemeOpenedDate` into the returned
  `Account` object. Since `AccountSchema.schemeOpenedDate` is required
  (non-optional, nullable), this object literal is currently missing a
  required property — **typecheck is almost certainly red right now.** Add
  `schemeOpenedDate: row.schemeOpenedDate ?? null,` to the returned object.
  Check whether any other `Account`-shaped object literal in the ledger
  module (e.g. an update-path return) needs the same field.
  DELEGATION.md's Must Not Change list holds: do not touch EPF/income-events
  files/migrations while doing this.
- P2 gap: no migration has been generated — `apps/api/drizzle/meta/_journal.json`
  still ends at `0017_common_terror`; there is no `0018_*` migration file.
  Generate one offline (no DB connection required):
  `cd apps/api && DATABASE_URL="postgres://localhost:5432/offline" npm run db:generate`
  — review the generated SQL: it must be a single
  `ALTER TABLE "accounts" ADD COLUMN "scheme_opened_date" date;` (nullable, no
  default) and must NOT touch any other table.
- P2 gap: check `packages/shared` for any `deepEqual`-style test asserting a
  full literal `Account`/`AccountWithBalance` object shape (ledger schema
  tests) and add `schemeOpenedDate` to the expected object(s) if one exists.
- P3: **not started.** Add `AccountComplianceResultSchema` and
  `GetSchemeComplianceQuerySchema` (plus any list-wrapper schema you need) to
  `packages/shared/src/schemas/tax.ts`, appended after the existing EPF
  section (current file ends at line 542 with `GetEpfProjectionQuerySchema`).
  Field set and nullability exactly per TASK.md's `AccountComplianceResult`
  interface (`## Scope` → "Compliance result per account"): `accountId`,
  `schemeKind: 'ppf'|'ssy'|'nps_tier1'`, `fy`, `annualContributedPaise`,
  `minPaise`, `maxPaise: number|null`, `statusCode` (9-value enum exactly as
  listed there), `deficitPaise`, `headroomPaise: number|null`,
  `eligible80CPaise: number|null` (present on every result, null for NPS),
  `npsEmployeeContributionPaise: number|null` (present on every result, null
  for PPF/SSY), `isEstimate: true` (literal), `notes: string[]`. NO
  CCD(1)/(1B)/(2) field anywhere.
- P4: **not started.** `apps/api/src/modules/tax/services/scheme-compliance.ts`
  + `.test.ts` do not exist. Build per TASK.md's "review-3 canonical" blocks
  verbatim — read TASK.md in full before writing this file, it is the single
  source of truth and supersedes this summary wherever they differ:
  - Postings/contribution-total query: user-scoped (`transactions.userId`),
    `deletedAt IS NULL`, opening-balance exclusion via `NOT EXISTS` on a
    posting from the SAME transaction to an account with
    `systemKind = 'opening'` (there is no `transactions.type` column — do not
    invent one), `amountPaise > 0`, FY date range inclusive both ends.
  - NPS: `LEFT JOIN accountNpsDetails` on `accountId` AND
    `detail.userId = userId`, then classify AFTER retrieval in application
    code: null detail → `data_missing`; `tier_ii` → excluded silently from
    results; `tier_i` → included as `nps_tier1`. Never a SQL `WHERE` on tier.
  - PPF maturity = 15 years from the END of the opening FY (use
    `ppfMaturityDate` from `scheme-limits.ts`); past maturity with no
    extension-mode data → `statusCode: 'lifecycle_unknown'` + a note.
  - SSY: holder DOB via `family_members`, join must require
    `family_members.user_id = userId`; age > 10 completed years at opening →
    `data_invalid`; outside the 15-year deposit window
    (`ssyDepositWindowEnd`) → `outside_deposit_window`; gender check is
    always skipped — always add a note saying so.
  - Missing `scheme_opened_date` on the account → `data_missing` (cannot
    judge lifecycle without it).
  - `isEstimate: true` on every result, unconditionally.
- P5: **not started.** Routes `GET /scheme-compliance?fy=` (list) and
  `GET /scheme-compliance/:accountId?fy=` (single) under the tax module's
  `/api/tax` prefix. Static-before-param route registration order matters —
  register the non-param collection route before the `:accountId` route (or
  route on distinct enough paths that Fastify's router doesn't care; verify
  either way against the project's existing route-registration convention in
  this module).
- P6: **not started.** Register the new route file in
  `apps/api/src/modules/tax/plugin.ts` alongside the four existing
  `app.register(...)` calls.
- P7: **not started, and must come last** — regenerate BOTH
  `apps/api/src/route-surface.snapshot.txt` and
  `apps/api/src/route-table.snapshot.txt` only after P5/P6 land (whatever
  command/test this repo uses to regenerate them — check for an `UPDATE_SNAPSHOT`-style
  env var or a route-snapshot test file's own instructions rather than
  hand-editing the snapshot text).
- P8: **not started.** Full test list from TASK.md's `## Plan` → P8 line,
  including: PPF discontinued boundary at exactly 49_999 vs 50_000 paise; SSY
  age gate including the exact 10th-birthday-is-still-eligible case; NPS
  minimum; NPS result has NO CCD allocation field and `eligible80CPaise` is
  null; PPF maturity end-of-opening-FY arithmetic + post-maturity
  `lifecycle_unknown`; missing `schemeOpenedDate` → `data_missing`; NPS
  Tier II excluded; missing NPS detail row → `data_missing`; an NPS detail
  row that exists but is owned by a DIFFERENT user than the account owner →
  `data_missing` (accountId and userId on `accountNpsDetails` are independent
  columns — a wrong-user row must not be trusted just because accountId
  matches); a transaction belonging to a different user excluded; a
  soft-deleted transaction excluded; an opening-balance transaction excluded.

### Required process for this resume
1. Before writing anything, independently re-verify each "confirmed done"
   item above by reading the actual file — do not take this delegation's word
   for it either.
2. Do the remaining P2 items, then P3 → P4 → P5 → P6 → P7 → P8 in that order
   (P7 genuinely must be last: the snapshots can only be correct once the
   routes exist and are registered).
3. Run, and report literal output + exit code for: `npm run typecheck`,
   `npm run lint`, `node --test apps/api/src/lib/scheme-limits.test.ts`,
   `node --test apps/api/src/modules/tax/services/scheme-compliance.test.ts`,
   `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`
   (must stay green — regression check on a file you are not touching),
   `npm run test -w packages/shared`, and the route-snapshot test(s) (find the
   exact filename(s) under `apps/api/src` — do not guess the name; e.g. grep
   for "route-surface.snapshot" or "route-table.snapshot" to find the test
   that reads them).
4. Write the full report to `tasks/092-scheme-limits/implementation-1.md`
   (this path has never been written — write fresh, not append) covering
   every file changed, a diff summary per file, all commands run with literal
   output and exit codes, and any deviation from this brief or from TASK.md
   with your reasoning.
