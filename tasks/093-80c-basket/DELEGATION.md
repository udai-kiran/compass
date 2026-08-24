# Delegation — 13.7 80C/80D Deduction Basket (replan resolving review-2.md)

Coordinator replan after `review-2.md` verdict "Not implementation-ready" (12 high findings).
This document supersedes TASK.md's Scope/Plan sections with concrete, decision-complete
resolutions. Every review-2.md High finding is addressed below; Medium findings are addressed
where cheap/safe, otherwise explicitly deferred as a documented non-goal (never silently dropped).

Dependencies 13.5 (`tasks/091-epf-passbook`) and 13.6 (`tasks/092-scheme-limits`) are now
**COMPLETE** — both shipped in `v3.9.0` (commit `e551748` on `main`). Confirmed via
`git log --oneline -- tasks/090-taxable-income-ledger tasks/092-scheme-limits` and reading
`epf-contributions.ts`. Flip both TASK.md `## Status` headers to `COMPLETE` as part of this work
(they have full `implementation-*`/`review-*` evidence chains already; only the header is stale).

## Phase 1 (Worker A) — prerequisites, in existing modules

### 1a. `apps/api/src/modules/protection/services/insurance.ts` — wire `policyCoveredPersons`
Currently `toPolicy()` hardcodes `coveredPersonIds: []` (line 53) and `createPolicy`/`updatePolicy`
never touch the `policyCoveredPersons` junction table, even though
`CreateInsurancePolicySchema`/`UpdateInsurancePolicySchema`/`InsurancePolicySchema` in
`packages/shared/src/schemas/insurance.ts` already carry `coveredPersonIds: z.array(z.uuid())`.

- Add a private helper `async function replaceCoveredPersons(db, userId, policyId, personIds: string[])`:
  validate every `personId` belongs to a `family_members` row with `userId` (throw `HttpError(400,
  "Unknown family member: <id>")` for any that don't — batch-check with one `inArray` query, don't
  loop queries); then in one transaction: `delete from policyCoveredPersons where policyId=...` then
  bulk-insert the new pairs (skip insert if array empty). Call from `createPolicy` (after the policy
  insert, same function, not wrapped in `db.transaction` unless you also move the initial insert in —
  wrap both the policy insert/update AND the covered-persons replace in one `db.transaction`) and from
  `updatePolicy`.
- Add `async function loadCoveredPersonIds(db, policyId): Promise<string[]>` (or batch-load via
  `inArray(policyCoveredPersons.policyId, ids)` for `listPolicies`, mirroring the existing health-card
  batch-load pattern in `listPolicies`) and thread the result into `toPolicy()`'s `coveredPersonIds`
  field for `listPolicies`, `getPolicyWithCards` (used by `createPolicy`'s return... note: `createPolicy`
  currently returns `toPolicy(rows[0]!)` directly without cards/covered-persons reload — change it to
  reload via `getPolicyWithCards` after the covered-persons write so the response is accurate, same
  as `updatePolicy` already does).
- Add a new exported helper `sumPolicyPremiumsInRange(db, userId, policyId, fyStart, fyEnd):
  Promise<{ totalPaise: number; count: number }>` — same query shape as `listPolicyPremiums` (postings
  joined to transactions joined to accounts, `isNull(accounts.systemKind)`, non-deleted, magnitude
  summed) but with an added `and(gte(transactions.date, fyStart), lte(transactions.date, fyEnd))`
  filter and no per-row mapping (just the sum + count). `deductions.ts` (Phase 2) calls this per
  health/life policy instead of re-deriving the query.
- Import `familyMembers` from `../../../db/shared/persons.ts` and `policyCoveredPersons` from the
  existing `spines.ts` re-export already in `protection/schema.ts` (check the barrel; if
  `policyCoveredPersons` isn't re-exported from `protection/schema.ts` yet, add it there first — it's
  already a resident of `db/shared/spines.ts` per `db/schema.decomposition.test.ts:223`).

### 1b. `apps/api/src/modules/tax/services/scheme-compliance.ts` — stop zeroing real contributions
In `ppfCompliance` (currently lines ~139-189) and `ssyCompliance` (~192-272): the early-return paths
for `data_missing`/`data_invalid`/`outside_deposit_window` currently pass `0` as
`annualContributedPaise` into `buildResult` without ever calling `sumContributions`. Move the
`sumContributions(db, account.id, userId, fyStart, fyEnd)` call to the top of each function (it only
needs `account.id`/`userId`/`fyStart`/`fyEnd`, none of which depend on `schemeOpenedDate` or holder
lookup) and pass the real `contributed` value into every `buildResult` call in both functions,
including the early-return ones. Do not change any `statusCode` logic — only the
`annualContributedPaise` value carried alongside a `data_missing`/`data_invalid`/etc. status. Update
the two now-stale doc comments that say "Returns 0 when there are no qualifying postings" is the
reason these paths report 0 (they were reporting 0 by construction, not because there were no
postings — fix the misleading data_missing branches' behavior, `sumContributions`'s own doc comment
about returning 0 for "no qualifying postings" stays accurate and unchanged).

### 1c. `apps/api/src/lib/tax-rules.ts` — two additions, no schema changes to `DeductionCap`
- Add `export const PREVENTIVE_CHECKUP_SUBLIMIT_PAISE = lakh(0.05);` near the 80D block (₹5,000; a
  flat statutory sub-limit, not FY/regime-varying, so it's a constant, not a `DeductionCap` row).
- Add `export function resolveEmployerNpsRateBps(fy: string, regime: Regime, employerType:
  "private" | "government"): number` — calls `getDeductionCap("80CCD(2)", fy)`, finds the entry whose
  `.regime === regime` (throw `HttpError`-free plain `Error` — this file has no HttpError import and
  other functions here throw plain `Error`, matching the file's existing convention — with a message
  naming fy/regime if no matching entry, though today every covered FY has both regimes populated),
  then finds `employerRatesBps.find(r => r.employerType === employerType)` (throw if absent). Returns
  the `rateBpsOfBasic` number. Pure function — no DB access. Do NOT add an 80CCD(1) salary-rate
  constant; 093 exposes the raw uncapped NPS remainder pool (see Phase 2 §80CCD1B/1) rather than
  applying an employee-side salary cap, which stays deferred to 13.8 per TASK.md AC4 — that's an
  intentional, now-explicit scope boundary, not an oversight.

### 1d. `apps/api/src/modules/credit/services/emis.ts` — FY interest estimate helper
Add `export async function getEmiInterestEstimateForFy(db: Db, userId: string, fy: string):
Promise<{ estimatePaise: number; templateCount: number }>`. List the user's EMI recurring templates
(reuse whatever existing query `listEmis`/similar already uses to enumerate `emiDetails` rows for a
user — grep the file for the existing list function and match its query shape exactly, don't
reinvent), for each call `listEmiInstallments(db, userId, templateId)`, filter installments whose
`date` falls in `[fyStart, fyEnd]` (`fyRange(fy)` from `../../../lib/financial-year.ts`), sum
`interestPaise`. This is `emiInterestEstimatePaise` in Phase 2's basket response — NOT a deduction
bucket, never added into any capped/eligible total.

### 1e. `apps/api/src/db/shared/spines.ts` — `isElss` on holdings
Add `isElss: boolean("is_elss").notNull().default(false)` to the `holdings` pgTable, plus a table-level
`check("holdings_elss_requires_mf", sql`NOT ${t.isElss} OR ${t.assetClass} = 'mutual_fund'`)`. Update
`packages/shared/src/schemas/wealth.ts`: add `isElss: z.boolean()` to `HoldingSchema`, `isElss:
z.boolean().default(false)` to `CreateHoldingSchema`, and `isElss: z.boolean().optional()` to
`UpdateHoldingSchema` (find the exact existing field list/ordering and match style — check whichever
service builds `toHolding()` in `apps/api/src/modules/investments/services/*.ts` and add `isElss:
row.isElss` there). In the holdings update service function, when the merged/resulting state would
have `isElss=true` and `assetClass !== "mutual_fund"`, throw `HttpError(400, "isElss can only be set
on mutual_fund holdings")` — the DB check constraint is the backstop, this is the friendly 400.

### 1f. Migration
After 1e's schema edit, run `npm run db:generate` (offline, no DB connection) to produce the Drizzle
migration for the new `is_elss` column + check constraint. Do NOT hand-write SQL.

### 1g. Verification gate for Phase 1
`npm run typecheck` (all workspaces) and `npm run lint` must be clean, and existing tests for
`insurance`, `scheme-compliance`, `emis`, and `holdings`/investments must still pass unmodified
(no behavior change to their existing passing assertions — only new capability added). Add/extend
unit or integration tests for each of 1a-1e's new/changed behavior in this same phase (colocated
`*.test.ts`/`*.integration.test.ts` next to the files touched):
  - insurance: create/update a policy with `coveredPersonIds`, assert `listPolicies`/`getPolicy`
    return them; assert an unowned/foreign `personId` is rejected 400; assert `sumPolicyPremiumsInRange`
    only counts postings within the given date range (boundary-inclusive) and excludes soft-deleted.
  - scheme-compliance: a PPF/SSY account with real contribution postings but missing
    `schemeOpenedDate` now reports the real summed `annualContributedPaise` alongside
    `statusCode: "data_missing"` (previously asserted/implied 0 — update or add the test explicitly).
  - tax-rules: `resolveEmployerNpsRateBps` returns 1000/1400 correctly across the FY23-24/FY24-25+
    boundary for both employer types and both regimes (table already in tax-rules.ts — this is a
    pure lookup test, no new data).
  - emis: `getEmiInterestEstimateForFy` sums only installments within the FY window across 2+
    templates, using the existing `splitInstallments`/`listEmiInstallments` machinery already
    covered by emis.test.ts (don't recompute amortization math in the new test — assert the FY
    filter/sum behavior).
  - holdings: `isElss=true` rejected on a non-`mutual_fund` create/update (400); accepted on
    `mutual_fund`; DB check constraint test if the repo pattern for constraint tests exists elsewhere
    (grep for an existing `check(...)` constraint test to match convention, otherwise a service-level
    400 test suffices).

Report back: exact diff (`git diff --stat`), full `npm run typecheck`/`npm run lint`/`npm run test`
output (this workspace's tests at minimum; full monorepo if time permits), and a list of every new
test with pass/fail.

## Phase 2 (Worker B, after Phase 1 is verified) — the deduction basket itself

### 2a. Schema — `apps/api/src/modules/tax/schema.ts`: new `deductionEntries` table
```ts
export const deductionSection = pgEnum("deduction_section", ["80C", "80D", "80CCD1B", "80CCD2"]);
export const deductionKind = pgEnum("deduction_kind", [
  "nsc_additional", "tuition_fees", "elss_manual", "nps_additional",
  "employer_nps_ccd2", "preventive_checkup", "other_80c", "other_80d",
]);
export const eightyDGroup = pgEnum("eighty_d_group", ["self_family", "parents"]);

export const deductionEntries = pgTable("deduction_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  fy: text("fy").notNull(),
  section: deductionSection("section").notNull(),
  deductionKind: deductionKind("deduction_kind").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  description: text("description").notNull().default(""),
  employerType: text("employer_type"),        // 'private' | 'government'; required iff section='80CCD2'
  salaryBasePaise: bigint("salary_base_paise", { mode: "number" }), // Basic+DA; required iff section='80CCD2'
  eightyDGroup: eightyDGroup("eighty_d_group"), // required iff section='80D'
  createdAt: timestamp(...).notNull().defaultNow(),
  updatedAt: timestamp(...).notNull().defaultNow(),
}, (t) => [
  index("deduction_entries_user_fy_idx").on(t.userId, t.fy),
  check("deduction_entries_amount_positive", sql`${t.amountPaise} > 0`),
  check("deduction_entries_ccd2_fields", sql`
    ${t.section} <> '80CCD2' OR (${t.employerType} IN ('private','government') AND ${t.salaryBasePaise} > 0)`),
  check("deduction_entries_80d_group", sql`${t.section} <> '80D' OR ${t.eightyDGroup} IS NOT NULL`),
  check("deduction_entries_section_kind", sql`
    (${t.section} = '80C' AND ${t.deductionKind} IN ('nsc_additional','tuition_fees','elss_manual','other_80c'))
    OR (${t.section} = '80CCD1B' AND ${t.deductionKind} = 'nps_additional')
    OR (${t.section} = '80CCD2' AND ${t.deductionKind} = 'employer_nps_ccd2')
    OR (${t.section} = '80D' AND ${t.deductionKind} IN ('preventive_checkup','other_80d'))`),
]);
```
No `source_doc_key` column (review-2.md Medium #11 — removed, not deferred silently: document this
explicitly as a Non-Goal in TASK.md, "document attachment for manual deduction entries"). Add
`deduction_entries` to `ALL_TABLES` and `USER_TABLES` (`user_id`) in
`apps/api/src/modules/system/services/backup.ts`, and to the tax module's entry in
`db/schema.decomposition.test.ts` if that test enumerates tax's tables explicitly (check the file's
existing tax-module entry and follow its pattern).

### 2b. Shared Zod contract — `packages/shared/src/schemas/tax.ts`
Add `DeductionEntrySchema`/`CreateDeductionEntrySchema`/`UpdateDeductionEntrySchema` mirroring the
table (section/deductionKind/eightyDGroup as matching z.enum; `employerType`/`salaryBasePaise`
optional; validate section/kind/group compatibility with `.superRefine` matching the DB check
constraints above so bad requests 400 before hitting the DB check).

Add `DeductionBasketSchema` with this exact top-level shape (every money field `z.number().int()`,
paise):
```ts
{
  fy: string;
  regime: "old" | "new";               // getRegimePreference(...).effective
  eightyC: {
    sources: Array<{
      kind: "epf" | "vpf" | "ppf" | "ssy" | "elss" | "life_insurance" | "tax_saver_fd" | "nsc" | "manual";
      label: string;                    // e.g. account/policy/holding display name
      contributedPaise: number;
      provenance: "actual" | "expected" | "estimated" | "manual" | "data_missing";
      note: string | null;              // e.g. compliance statusCode passthrough, estimation caveat
    }>;
    npsRemainderPaise: number;          // NPS pool left after 80CCD(1B) allocation, NOT salary-capped
    contributedPaise: number;           // sum(sources) + npsRemainderPaise
    capPaise: number;                   // from tax-rules.ts "80C"
    eligiblePaise: number;              // min(contributedPaise, capPaise)
    headroomPaise: number | null;       // null when regime === "new" (suppressed)
    assumptions: string[];              // e.g. "80CCD(1) remainder included without salary-cap validation"
  };
  eightyCcd1b: {
    contributedPaise: number;           // min(nps employee contribution, 50,000)
    capPaise: number;
    eligiblePaise: number;
    headroomPaise: number | null;
  };
  eightyCcd2: {
    entries: Array<{ id: string; employerType: "private" | "government"; salaryBasePaise: number;
      contributedPaise: number; ratebps: number; capPaise: number; eligiblePaise: number; capExceeded: boolean }>;
    contributedPaise: number;
    eligiblePaise: number;              // sum of entries' eligiblePaise; available BOTH regimes, never suppressed
  };
  eightyD: {
    selfFamily: { contributedPaise: number; seniorApplies: boolean; capPaise: number; eligiblePaise: number;
      preventiveCheckupPaise: number; headroomPaise: number | null };
    parents: { contributedPaise: number; seniorApplies: boolean; capPaise: number; eligiblePaise: number;
      preventiveCheckupPaise: number; headroomPaise: number | null };
    unallocatedPolicies: Array<{ policyId: string; name: string; reason: "no_covered_persons" | "mixed_coverage" }>;
  };
  emiInterestEstimatePaise: number;      // NOT a deduction bucket — informational only
  generatedAt: string;                   // ISO timestamp
}
```
This is the literal contract — implementers must not rename/restructure fields without checking back
with `deductions.ts`'s tests. `headroomPaise` fields are `null` exactly when `regime === "new"` (for
80C/80CCD1B/80D only — `eightyCcd2` never nulls out headroom).

### 2c. Service — `apps/api/src/modules/tax/services/deductions.ts`
Two responsibilities: (i) `deductionEntries` CRUD (list/create/update/delete, `userId`-scoped, Zod
`.superRefine` + DB check as double validation), (ii) `getDeductionBasket(db, userId, fy):
Promise<DeductionBasket>`. Precise algorithm per bucket:

**80C sources** (each becomes one `sources[]` item unless zero/absent — omit zero items, don't emit
noise rows):
- EPF+VPF: for each `epf_contributions` row in the FY's wage-month range (reuse
  `fyToWageMonthRange`/`listContributions` from `epf-contributions.ts`), use
  `buildEpfContributionDto(row).eligible80cPaise` (already actual??expected, employee+VPF combined) —
  sum across wage months into ONE `kind: "epf"` source item (don't split employee/VPF into two rows;
  the DTO already merges them under one number, keep that). No raw-payslip third-tier fallback (scope
  boundary — note in `assumptions` if any wage month in the FY has no `epf_contributions` row: "N
  wage month(s) have no EPF record and are excluded").
- PPF/SSY: from `getAllSchemeCompliance(db, userId, fy)`, each `ppf`/`ssy` result becomes one source
  item, `contributedPaise: result.annualContributedPaise` (now real post-1b fix even under
  `data_missing`), `provenance: result.statusCode === "ok" ? "actual" : "data_missing"`, `note:
  result.notes.join("; ") || null`.
- ELSS: `holdings` where `isElss = true` and `userId` matches; sum `holdingEvents.amountPaise` where
  `type` is the buy-type enum value (check `holdingEventType` pgEnum in spines.ts for the exact buy
  value name — likely `"buy"`) and `date` in FY, per holding → one source item per ELSS holding (or
  one aggregated `kind: "elss"` item if holdings count is high — prefer one item per holding, `label`
  = holding name, since that matches the per-source-item contract better).
- Life insurance: `insurancePolicies` where `kind = "life"` and `userId` matches (not archived — check
  and decide: an archived policy could still have had premiums paid in-FY, so filter by premium
  transactions in range, not by `archivedAt`). For each, call `sumPolicyPremiumsInRange` (Phase 1a).
  If `totalPaise === 0` for the FY, fall back to `premiumPaise * paymentsPerYear(premiumFrequency)` as
  `provenance: "estimated"` (map `premiumFrequency` monthly=12/quarterly=4/half_yearly=2/yearly=1/
  single=0-skip-if-single). Otherwise `provenance: "actual"`.
- Tax-saver FD / NSC: `deposit_details` where `depositKind IN ('tax_saver_fd','nsc')`, `userId`-scoped
  (join through the owning holding — check the FK path: depositDetails likely FKs a holdingId or
  accountId; use whichever the schema has and scope through it), `startDate` within FY →
  `contributedPaise: principalPaise`, `kind: "tax_saver_fd" | "nsc"` respectively.
- Manual: `deductionEntries` where `section = '80C'` and `fy` matches, `kind: "manual"`, one item per
  entry (or summed — prefer summed into one `kind: "manual"` item labeled "Manual 80C entries" to
  avoid an unbounded sources array; each entry's own id/description is available via the entries CRUD
  endpoint, not duplicated here).

**NPS split (80CCD1B / 80C remainder)**: `nps = getAllSchemeCompliance(...).find(r => r.schemeKind ===
"nps_tier1")`; `contributed = nps?.npsEmployeeContributionPaise ?? 0`;
`eightyCcd1b.contributedPaise = Math.min(contributed, 5_000_000)` (₹50,000 in paise);
`eightyC.npsRemainderPaise = contributed - eightyCcd1b.contributedPaise`. Push
`"80CCD(1) remainder (₹X) included in 80C total without salary-cap validation — see task 13.8"` into
`eightyC.assumptions` whenever `npsRemainderPaise > 0`.

**80CCD(2)**: `deductionEntries` where `section = '80CCD2'` and `fy` matches. For each, `ratebps =
resolveEmployerNpsRateBps(fy, regime, entry.employerType)`, `capPaise = Math.floor(entry.salaryBasePaise
* ratebps / 10000)`, `eligiblePaise = Math.min(entry.amountPaise, capPaise)`, `capExceeded =
entry.amountPaise > capPaise`. Sum across entries. Never suppressed by regime — always both-regime
eligible (per AC5/M2 medium finding — this is the fix for that finding).

**80D**: `insurancePolicies` where `kind = "health"`, `userId`-scoped, with `coveredPersonIds` (now
real, post-1a). For each policy: load the covered `family_members` rows, classify:
  - empty `coveredPersonIds` → push to `unallocatedPolicies` with `reason: "no_covered_persons"`,
    skip from both buckets.
  - all covered members have `relationship === "parent"` → parents bucket.
  - none have `relationship === "parent"` → self_family bucket.
  - mixed → push to `unallocatedPolicies` with `reason: "mixed_coverage"`, skip from both buckets (do
    NOT guess a split).
  For the bucket a policy lands in, sum `sumPolicyPremiumsInRange` (same actual/estimated fallback as
  life insurance above) into that bucket's `contributedPaise`.
  Senior check for `selfFamily.seniorApplies`: `user_profiles.dateOfBirth` (the taxpayer) OR any
  `family_members` row with `relationship = "spouse"` has `dateOfBirth`, age ≥ 60 completed years as
  of `fyRange(fy)[1]` (FY end date) via `completedYearsBetween`. Missing DOB → treat as NOT senior
  (conservative default; note it if you want, not required).
  Senior check for `parents.seniorApplies`: ANY covered `family_members` row with `relationship =
  "parent"` across ALL policies landing in the parents bucket has `dateOfBirth` and age ≥ 60 as of FY
  end.
  `capPaise` per bucket = `getDeductionCap(seniorApplies ? "<x>_senior" : "<x>", fy)` filtered to
  `regime: "old"` entry's `capPaise` (sections are `80D_self`/`80D_self_senior`/`80D_parents`/
  `80D_parents_senior` — already in tax-rules.ts).
  Preventive checkup: `deductionEntries` where `section='80D'`, `deductionKind='preventive_checkup'`,
  grouped by `eightyDGroup` into `selfFamily.preventiveCheckupPaise`/`parents.preventiveCheckupPaise`,
  each capped at `PREVENTIVE_CHECKUP_SUBLIMIT_PAISE` (Phase 1c) BEFORE being added into that bucket's
  `contributedPaise` (it's inside the group cap, not additive on top — per TASK.md's original M3 note,
  now made concrete). `other_80d` manual entries add directly to the matching group's
  `contributedPaise`.
  `eligiblePaise = min(contributedPaise, capPaise)`; `headroomPaise = regime === "new" ? null :
  max(0, capPaise - eligiblePaise)`.

**EMI estimate**: `emiInterestEstimatePaise = (await getEmiInterestEstimateForFy(db, userId, fy)).estimatePaise`.

**Regime suppression**: for 80C/80CCD1B/80D buckets, when `regime === "new"`, set `headroomPaise:
null` on every sub-bucket (contributed/eligible/cap values still computed and returned — only
headroom, the "how much more can I contribute" figure, is suppressed, since it's misleading when the
deduction isn't available at all). `eightyCcd2.eligiblePaise`/entries are never suppressed.

**FY validation**: unknown/uncovered FY must fail loudly — reuse whatever `assertValidCoveredFy`-style
guard `regime-preference.ts`/`tax-rules.ts` already has (call `getDeductionCap("80C", fy)` early, which
already throws for uncovered FYs, as the cheap guard, or reuse `coveredFys()` directly).

### 2d. Routes — `apps/api/src/modules/tax/routes/deductions.ts`
Follow `epf-contributions.ts`'s existing route-file conventions exactly (Zod request/response via
`app.withTypeProvider<ZodTypeProvider>()`, `req.session!.userId`, demo-mode is automatic via the
existing auth plugin for the 3 mutating routes):
- `GET /deductions?fy=` → `DeductionBasketSchema`
- `GET /deductions/entries?fy=` → `DeductionEntrySchema[]`
- `POST /deductions/entries` → `DeductionEntrySchema`
- `PUT /deductions/entries/:id` → `DeductionEntrySchema`
- `DELETE /deductions/entries/:id` → 204

Register `deductionRoutes` in `apps/api/src/modules/tax/plugin.ts` alongside the other 5.

### 2e. Migration
`npm run db:generate` for the new `deduction_entries` table + `is_elss` column if Phase 1f wasn't
already run/merged into the same branch.

### 2f. Tests (TDD.md — one failing-first test per AC, no DB mocking, real-Postgres for persistence)
At minimum, matching review-2.md's P8 list scoped to what's actually implemented above:
- Shared: `DeductionEntrySchema`/`DeductionBasketSchema` deep-equality + section/kind/group
  `.superRefine` rejection cases.
- `deductions.ts` unit tests (pure logic, no DB): NPS 80CCD(1B)/remainder split boundary (exactly
  ₹50,000, above, below, zero); 80CCD(2) cap/capExceeded across FY23-24/FY24-25+ boundary and both
  employer types; 80D senior-citizen boundary (exactly 60th birthday on FY-end date); preventive
  checkup sub-limit enforcement inside vs additive-on-top (assert it's capped-inside); regime
  suppression (headroom null only for old-exclusive buckets, never 80CCD2); money invariants
  (`eligiblePaise <= capPaise`, `headroomPaise >= 0` when non-null, NPS split sums back to the source
  pool exactly).
- Integration (real Postgres): full `getDeductionBasket` across a seeded user with EPF rows, a PPF
  account (including one with missing `schemeOpenedDate` to prove it's no longer silently zeroed),
  ELSS holdings, life+health policies (including a mixed-coverage policy → `unallocatedPolicies`, an
  empty-coverage policy → `unallocatedPolicies`, a parents-only policy, a self-only policy), tax-saver
  FD/NSC deposits, manual `deduction_entries` for each section, and an EMI template with real
  installments (prove `emiInterestEstimatePaise` present but excluded from all bucket totals). Assert
  user isolation (a second user's data never leaks in). CRUD tests for `deduction_entries`
  (create/list/update/delete, ownership 404 on cross-user id, DB check-constraint violations reject
  with a clear error). Unknown FY → loud failure. Backup coverage: `backup.test.ts` must pass with
  `deduction_entries` added to `ALL_TABLES`/`USER_TABLES` (don't skip — that test enforces this).

### 2g. Verification gate for Phase 2
Same bar as Phase 1g: full `npm run typecheck`, `npm run lint`, `npm run test` (all workspaces) output,
pass/fail counts, literal text. `backup.test.ts` specifically must be confirmed green (new table
registered). Report `git diff --stat` and the new file list.

## After both phases
- Flip `tasks/090-taxable-income-ledger/TASK.md` and `tasks/092-scheme-limits/TASK.md` `## Status` to
  `COMPLETE` (stale headers, functionally shipped — see top of this doc).
- Update `tasks/093-80c-basket/TASK.md`: flip `## Status` to `COMPLETE` once Codex review confirms no
  outstanding high-severity findings, and append a resolution section (matching the style of
  `091-epf-passbook/TASK.md`'s appended history) listing how each review-2.md High finding was closed,
  referencing this DELEGATION.md.
- Codex review of the full diff (both phases combined) before merge — coordinator will commission this
  separately, not part of either worker's own brief.
