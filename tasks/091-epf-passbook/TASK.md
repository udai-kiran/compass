# Task: 13.5 — EPF Passbook Reconciliation & Benefit Projection

## Status
COMPLETE

## Objective
Track EPF contributions per wage-month with employee/employer/EPS split, reconcile payslip-derived expected amounts against manually-confirmed actual deposits, flag contribution gaps, and project EPF corpus at retirement. **EPS defined-benefit pension formula is out of scope** (requires service history not yet modelled).

## Root Cause
Compass records one combined EPF transaction per payroll cycle. Payslip parsing (13.2) extracts components but nothing reconciles them. Missed employer deposits are permanently lost money and nothing catches them.

## Design Decisions (reviews 1 + 2 addressed)

**H1 (schema — dual columns)**: Two column sets per row: `expected_*` (payslip-derived) and `actual_*` (passbook-confirmed). Reconciliation status is a persisted field (not purely computed) because it requires user action (confirm-actual). Gap detection: status='gap' means expected_employee IS NOT NULL AND actual_employee IS NULL. Mismatch: |actual_employee - expected_employee| > expected_employee * 0.01 per component.

**H1 (review-2) — EPFO Member ID**: `employer_uan_member_id` is nullable. BUT because PostgreSQL UNIQUE treats NULLs as distinct, the UNIQUE constraint on (user_id, wage_month, employer_uan_member_id) only works when non-null. The import route REQUIRES `epfoMemberId` as a mandatory request body field — if the user doesn't know it, they must look it up. Without it, the import returns a 422 ("epfoMemberId is required"). Alternative: use payslip_id as a partial unique index for idempotency by payslip (non-null constraint on payslip_id when source='payslip'). BOTH are enforced: `UNIQUE (user_id, wage_month, employer_uan_member_id) DEFERRABLE` + partial index on payslip_id.

**H2 (employer EPF/EPS invariant)**: `employer_epf_paise` = net credited to member's PF corpus (AFTER EPS diversion). `eps_paise` = diverted to EPS pension fund. `gross_employer = employer_epf_paise + eps_paise`. NEVER `gross_employer = employer_epf_paise`. Invariant only enforced as: `sum = employer_epf + eps`. The "12% of wage" check is removed — EPFO rate varies (10% for some establishments, exceptions for international workers). NOTE: payslip-parse.ts parser's PARSE_PAYSLIP_TOOL already requests `employer_epf` and `eps` as separate canonical components; the import service must map canonical_kind='employer_epf' → expected_employer_paise and canonical_kind='eps' → expected_eps_paise. No double counting if extraction is correct.

**H3 (EPS projection)**: EPS defined-benefit pension correctly descoped. Corpus projection is EPF only.

**H4 (reconciliation rules)**: Explicitly defined below.

**VPF (review-2 M2)**: Add `vpf` to CanonicalComponentKindSchema in packages/shared/src/schemas/tax.ts. Import maps canonical_kind='vpf' → expected_vpf_paise.

**80C eligibility**: employee_expected_paise + expected_vpf_paise = 80C eligible amount (employee contribution to recognized PF). employer_epf_paise = NOT 80C (recognized PF, treated as perquisite). EPS = not relevant for 80C. Use ACTUAL values when confirmed; EXPECTED values when not yet confirmed. Label accordingly.

**Backup**: epf_contributions must be in ALL_TABLES + USER_TABLES (has own user_id). If payslip_id becomes FK to payslips, must appear AFTER payslips in ALL_TABLES ordering.

**Reconciliation rules (explicit)**:
- All `actual_*` NULL → status='pending'
- Any `actual_*` set, all set → status='confirmed' (with mismatch check)
- Expected set but actual NULL after 45 days from wage_month end → service may report 'gap' (in gaps endpoint); persisted status stays 'pending' until user confirms
- Mismatch check: per component, if |actual - expected| / expected > 0.01 → status='mismatch'
- Zero expected: skip mismatch for that component (avoid divide-by-zero)
- Matched (all within 1%): status='matched'

**Corpus projection**: Requires `accountId` query param (user's EPF/PF account in ledger). Projection = current balance (from account) compounded at 8.25% annual rate, no future contributions assumed. Label clearly: isEstimate:true, rateSource:'last_known_official', assumedAnnualRateBps: 825.

**Decomposition**: +1 table (epfContributions into taxResidents). Count: 76 → 77.

## Scope

### New files
- `apps/api/src/modules/tax/services/epf-contributions.ts` — CRUD + import-from-payslip + gap detection + corpus projection
- `apps/api/src/modules/tax/services/epf-contributions.test.ts`
- `apps/api/src/modules/tax/routes/epf-contributions.ts`

### Modified files
- `apps/api/src/modules/tax/schema.ts` — add `epfContributions` table
- `apps/api/src/modules/tax/plugin.ts` — register routes
- `apps/api/src/db/schema.ts` — re-export
- `packages/shared/src/schemas/tax.ts` — add EpfContribution Zod schemas
- `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES / USER_TABLES
- `apps/api/src/db/schema.decomposition.test.ts` — count update

### Table design
```sql
epf_contributions (
  id                     UUID PK DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL FK → users(id) ON DELETE CASCADE,
  wage_month             TEXT NOT NULL,          -- "2025-06"
  employer_name          TEXT,                   -- display-only
  employer_uan_member_id TEXT,                   -- establishment/member ID as identity key

  -- Expected amounts (from payslip import, source_kind='payslip')
  expected_employee_paise    BIGINT,             -- employee_epf component
  expected_employer_paise    BIGINT,             -- employer_epf component (gross credited to PF, EXCLUDING eps)
  expected_eps_paise         BIGINT,             -- eps diversion
  expected_vpf_paise         BIGINT NOT NULL DEFAULT 0,
  payslip_id             UUID,                   -- source payslip, NULL for manual entries

  -- Actual amounts (from passbook/manual confirmation)
  actual_employee_paise      BIGINT,             -- NULL = not yet confirmed
  actual_employer_paise      BIGINT,
  actual_eps_paise           BIGINT,
  actual_vpf_paise           BIGINT,

  -- Reconciliation
  reconciliation_status  TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'matched' | 'gap' | 'mismatch' | 'confirmed'
  -- gap = payslip exists but actual is NULL after grace period
  -- mismatch = |actual - expected| / expected > 0.01
  gap_reason             TEXT,
  
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, wage_month, employer_uan_member_id)
  -- When employer_uan_member_id IS NULL, fall back to (user_id, wage_month) — handled in service layer
)
```

### Employer EPF/EPS invariant (enforced in service + tests)
- `employer_epf_paise` = employer share CREDITED to member's PF account (goes to corpus)
- `eps_paise` = employer share DIVERTED to pension fund (does NOT go to corpus)
- `gross_employer = employer_epf_paise + eps_paise` (statutory 12% of wage)
- 80C feeds from employee_paise + vpf_paise; employer_epf_paise is recognized PF (NOT 80C)

### Import-from-payslip logic
- Load accepted payslip, verify user ownership
- Read payslip_components: sum canonical_kind='employee_epf' → expected_employee_paise
- sum 'employer_epf' → expected_employer_paise  
- sum 'eps' → expected_eps_paise
- Insert ON CONFLICT (user_id, wage_month, employer_uan_member_id) DO UPDATE SET expected_* = EXCLUDED.*
- Idempotent: re-importing same payslip updates expected values, does not duplicate

### Corpus projection (pure, labelled estimate)
```typescript
interface EpfCorpusProjection {
  currentCorpusPaise: number;  // from account balance
  projectedCorpusPaise: number;
  monthsToRetirement: number;
  retirementDate: string;  // ISO date
  assumedAnnualRateBps: number;  // 825 = 8.25%
  rateApplicableFy: string;  // "2024-25" 
  rateSource: "last_known_official";
  isEstimate: true;
  disclaimer: string;
}
```

### Routes (relative paths in tax plugin)
- `POST /epf-contributions` — manual entry
- `GET /epf-contributions?fy=` — list for FY
- `POST /epf-contributions/import-from-payslip/:payslipId` — derive expected amounts
- `POST /epf-contributions/:id/confirm-actual` — confirm/enter actual deposit amounts
  (coordinator adjudication, review-3 blocker 9: POST, not PUT — matches this tax
  module's consistent convention for every other state-mutating action route)
- `GET /epf-contributions/gaps?fy=` — list gap months (expected set but actual null)
- `GET /epf-contributions/projection` — corpus projection (requires account balance + DOB from profile)

## Dependencies
- 13.2 (payslips, payslip_components) — complete

## Plan
- P1: Add `epfContributions` table to tax schema
- P2: Add Zod schemas to shared/tax.ts
- P3: Create service — manual CRUD, import-from-payslip (idempotent), confirm-actual, gap-detection (pure computed: rows where expected set but actual null), corpus projection (pure math with last-known rate)
- P4: Create routes (6 endpoints)
- P5: Wire plugin, backup, barrel, decomposition test
- P6: Generate migration
- P7: Regenerate route snapshots
- P8: Tests: import idempotency, employer/EPS invariant, gap detection, mismatch detection, corpus projection math, UNIQUE constraint behavior

## Acceptance Criteria
- AC1: Table with expected/actual column pairs; UNIQUE on (user_id, wage_month, employer_uan_member_id)
- AC2: Import-from-payslip is idempotent; correctly maps employee_epf/employer_epf/eps canonical kinds
- AC3: Employer EPF invariant (employer = credited to corpus; EPS = diverted to pension; sum = 12% wage) enforced in service + tested
- AC4: Corpus projection is pure computation with last-known rate, clearly labelled estimate
- AC5: Gap detection: row with expected_* set but actual_* null → reconciliation_status='gap'
- AC6: employee_paise + vpf_paise labelled as 80C-eligible recognized PF; employer_paise excluded
- AC7: Tables in backup arrays
- AC8: typecheck + lint + test green

## Verification
- T1-T8: typecheck, lint, targeted tests, backup static, decomposition, route snapshot, migration

## Non-Goals
- EPS defined-benefit pension projection (requires service history tables not yet modelled)
- Live EPFO portal integration
- UAN transfer reconciliation across employers
- Annual interest credit reconciliation (requires EPFO statements)
- Link to existing ledger EPF transaction (supplementary table only)
- DB-level non-negative/format CHECK constraints on `epf_contributions` columns
  (TASK.md's original table design never specified these, unlike
  `income_events`'s explicit CHECK list — deferred as a plan gap, not an
  implementation defect; low severity per review-3)
- Making `gapReason` settable through the API (persisted/returned but no
  request accepts it — TASK.md never specified a write path for it; deferred)

## Review-3 Blockers (pending fix)

Codex implementation review (`review-3.md`) found real logic defects, not just
gaps — confirmed by the coordinator via direct reads of the current code.

1. **Same-payslip re-import does not refresh corrected expected values.**
   `importFromPayslip` runs a preflight lookup and returns the EXISTING row
   before ever reading current payslip components when a row for
   `(userId, wageMonth, epfoMemberId)` already exists (`epf-contributions.ts:187`).
   The upsert's `onConflictDoUpdate` is correctly built to update `expected_*`
   while preserving `actual_*` (`epf-contributions.ts:263`), but that code path
   is unreachable on a same-key re-import because the preflight short-circuits
   first. TASK.md is explicit: *"Idempotent: re-importing same payslip updates
   expected values, does not duplicate."* Fix: delete the preflight
   short-circuit; let every import attempt reach the upsert, which already has
   the right conflict target and the right preserve-actuals behavior.
2. **`computeStatus` does not implement H4's all-components-confirmed rule,
   and ignores VPF.** Only `actualEmployeePaise === null` yields `pending`
   (`epf-contributions.ts:65`); a row with employee actual set but
   employer/EPS/VPF actuals still null can be reported `matched`
   (`epf-contributions.ts:68`) even though those components were never
   confirmed. VPF is absent from the comparison entirely
   (`epf-contributions.ts:57-74`) — a materially wrong VPF deposit cannot ever
   produce `mismatch`. Fix `computeStatus`: a row stays `pending` while ANY
   component that has a non-null EXPECTED value still has a null ACTUAL value
   (employee, employer, EPS, **and VPF**); once every expected-non-null
   component has its actual set, compute per-component mismatch (skipping a
   component when its expected is null or zero, per the existing
   divide-by-zero guard) and return `mismatch` if any component exceeds 1%,
   else `matched`.

   **Coordinator adjudication carried into this round:** `confirmed` stays
   intentionally unreachable from `computeStatus` in this task — it is
   reserved for a distinct, not-yet-built explicit-user-override action, not
   an automatically computed state. Tighten `ReconciliationStatusSchema`'s
   doc-comment in `tax.ts` to say so explicitly so this is not re-flagged.
3. **Gap detection has no grace period.** `getGaps` reports every row with
   expected-employee-set/actual-employee-null as a gap regardless of how
   recently the wage month ended (`epf-contributions.ts:367-378`). TASK.md's
   H4 rule is explicit: *"after 45 days from wage_month end → service may
   report 'gap'."* Fix: gate `getGaps`'s filter on
   `today >= wageMonthEnd(wageMonth) + 45 days`, implemented as a **pure,
   unit-tested function** taking `wageMonth` and an injectable `asOf` date and
   returning the eligibility boolean — do not embed the date arithmetic
   directly in the DB query.
4. **The employer-EPF/EPS invariant is a no-op.** Import correctly separates
   `employer_epf` and `eps` into their own accumulators
   (`epf-contributions.ts:227`), but the only "check" adds them and logs on
   zero (`epf-contributions.ts:241`) — it asserts nothing and the sum is
   discarded. Fix: expose a computed `grossEmployerContributionPaise` field on
   `EpfContributionSchema`/`buildEpfContributionDto` (= employer + EPS, actual
   preferred over expected exactly like `eligible80cPaise` already does),
   remove the dead log-only check, and add a unit test proving the sum
   invariant. Separately: `PAYSLIP_SYSTEM` in `payslip-parse.ts` (~line 290)
   still asks for "Employer PF (12% basic)" and EPS as if independent,
   preserving the double-counting ambiguity review-2 raised. Add an explicit
   sentence: `employer_epf` must be the amount actually credited to the PF
   corpus, NET of any EPS diversion — not the full statutory employer rate.
5. **No DB-integration tests exist for any I/O path.** The test file covers
   only `computeStatus`/`fyToWageMonthRange`/`buildEpfContributionDto` — none
   of `createManual`, `importFromPayslip`, `confirmActual`, `listContributions`,
   `getGaps`, `getProjection` is exercised. `tasks/TDD.md` requires real-DB
   service-integration coverage repo-wide and explicitly bans mocking Drizzle.
   Follow `apps/api/src/modules/ledger/services/epf-contributions.test.ts`'s
   pattern exactly (`requireDatabaseUrl()` throws loudly rather than skipping;
   each test creates/cleans up its own throwaway rows). At minimum cover:
   ownership + accepted-state checks on import; multi-component summing; the
   re-import-refresh fix from item 1 (write this test FIRST against the
   current buggy code per `tasks/TDD.md`'s watch-it-fail discipline, if the
   worker's environment can reach a real Postgres — note explicitly in the
   report if it cannot, and reason through the trace instead); actual-value
   preservation across re-import; cross-user list/confirm isolation; gap-query
   correctness at/around the 45-day boundary; posted-balance projection
   against real ledger postings.
6. **Corpus projection accepts any owned account, not specifically an EPF
   account.** The ownership query selects only `accounts.id`, never checking
   `type` (`epf-contributions.ts:421`), so a bank/loan/PPF/system account can
   be projected as an "EPF corpus." TASK.md's own route description says
   *"requires accountId query param (user's EPF/PF account in ledger)"*. Fix:
   require `accounts.type = 'epf'`; reject any other type the same way an
   unowned account is already rejected (do not leak whether a same-ID
   different-type account exists).
7. **The corpus-projection response doesn't match TASK.md's interface and has
   no pure seam.** TASK.md's `EpfCorpusProjection` interface specifies
   `monthsToRetirement`, `rateApplicableFy`, and `disclaimer`; the actual
   schema has `yearsToRetirement` instead of `monthsToRetirement` and omits
   the other two fields entirely, and uses `z.boolean()`/`z.string()` where
   the spec implies fixed literals (`tax.ts` `EpfCorpusProjectionSchema`). The
   calculation itself lives inside the DB service and calls `new Date()`
   directly (`epf-contributions.ts:415-475`), so it has no DB-free test. Fix:
   rename to `monthsToRetirement` (matches spec; do not keep both), add
   `rateApplicableFy` and `disclaimer`, tighten `isEstimate` to
   `z.literal(true)` and `rateSource` to `z.literal("last_known_official")`,
   and extract the compounding math into a pure function
   (`currentCorpusPaise`, months/years to retirement, rate bps, → projection)
   that the service calls — unit-test the pure function directly.
8. **Compounding and mismatch arithmetic use floating point on paise.**
   Projection compounds with `Math.pow(..., 0.0825)`-style floating math
   (`epf-contributions.ts:475`) — replace with **year-by-year integer
   compounding**: `corpus = Math.round(corpus * (10000 + assumedAnnualRateBps) / 10000)`
   applied once per elapsed year (not a single `Math.pow` over N years), so
   every intermediate value is an exact integer and rounding happens the same
   way a real bank would compound it. Add a safe-integer check on the FINAL
   `projectedCorpusPaise`, not just the starting aggregate. Mismatch's
   `|actual-expected|/expected > 0.01` (`epf-contributions.ts:67`) should
   become the exactly-equivalent cross-multiplied integer comparison
   `Math.abs(actual - expected) * 100 > expected` — no floating point at all.
9. **Route method mismatch — coordinator adjudication.** TASK.md's route list
   says `PUT /epf-contributions/:id/confirm-actual`; the implementation and
   both snapshots use POST. **Keep POST** — it matches this tax module's own
   convention for every other state-mutating action route (090's
   accept/reject/derive are all POST). Fix TASK.md's stale route line instead
   of the working code/snapshots.
10. **Route-snapshot / typecheck currently red in review-3's snapshot of the
    tree** — attributed by review-3 to concurrent task 13.6 (scheme-compliance)
    work landing mid-review, not to 13.5 itself. Task 13.6 has since completed
    and self-reported both fixed; this fix round's own verification pass must
    independently re-confirm `npm run typecheck`, `npm run lint`, and both
    route-snapshot tests are green in the CURRENT tree before this task can be
    marked complete — do not assume either report's word for it.

## Review-4 Blockers (pending fix)

Codex implementation review (`review-4.md`) confirmed most review-3 fixes
landed, then found the `computeStatus` fix has a real remaining gap and a new
stale-status bug in the re-import path.

1. **`computeStatus`'s zero-expected exception is too broad, and the
   all-actuals-null base case is missing.** The current `needsConfirmation`
   helper skips confirmation for ANY component whose expected is exactly zero
   — but the zero-means-no-component exception is only semantically correct
   for VPF (`expected_vpf_paise` is `NOT NULL DEFAULT 0`, so zero is the only
   way to represent "no VPF"). Employee/employer/EPS are nullable columns —
   `null` already means "not applicable/not extracted" for them, so an
   expected value of exactly zero on one of THOSE columns is a real fact that
   still needs its actual confirmed, not a value to skip. Reviewer also found
   a concrete case where every actual is null and the nullable expecteds
   happen to be null too, and VPF's expected is its zero default — the
   function returns `matched` instead of the spec's unconditional
   "All actual_* NULL → pending". Fix: add an unconditional leading check —
   if all four actuals are null, return `pending` immediately. Then apply the
   zero-skip exception ONLY to VPF; employee/employer/EPS require their
   actual whenever their expected is non-null, including when it is exactly
   zero. The mismatch-calculation zero/null skip (the divide-by-zero guard)
   is unaffected — that one is correct as-is for all four components.
2. **A corrected re-import leaves the persisted `reconciliationStatus`
   stale.** `importFromPayslip`'s upsert (and `createManual`'s upsert)
   updates `expected_*` without recomputing `reconciliationStatus` in the
   same statement. Concretely: employee expected+actual are both 180,000 →
   `matched`; a corrected payslip changes expected to 185,000 (>1% away from
   the still-180,000 actual) → the row stays `matched` after re-import even
   though it is now actually a `mismatch`. Fix: whenever `createManual` or
   `importFromPayslip` upserts `expected_*`, recompute `reconciliationStatus`
   in the SAME statement/transaction using the (possibly still-null) current
   actuals — reuse `computeStatus` (now fixed per item 1) with whatever
   actuals presently exist on the row (existing actuals on conflict, nulls on
   fresh insert). Add a regression test proving status recomputes correctly
   after a corrected re-import changes a `matched` row into a `mismatch`.
3. **Money-precision edge case in `computeEpfProjection`.** `corpus * (10000 +
   assumedAnnualRateBps)` can exceed `Number.MAX_SAFE_INTEGER` even when both
   the starting and final corpus values are individually safe integers, for
   corpus values in the tens-of-billions-of-paise range (reviewer's worked
   example: 8,000,000,000,200 paise compounds to a different, wrong result
   under plain `number` multiplication than under exact integer arithmetic).
   Unrealistic for a real personal EPF balance, but this codebase's money
   arithmetic must not be silently lossy regardless of magnitude. Fix: do the
   per-year compounding step with `BigInt` (`(BigInt(corpus) *
   BigInt(10000 + assumedAnnualRateBps) + 5000n) / 10000n`-style exact
   rounding, converting back to `Number` only after each step, with a
   safe-integer check on every step's result, not just the final one).
4. **Missing-DOB fallback is undocumented.** `getProjection` silently assumes
   a 20-year retirement horizon when DOB is missing. `EpfCorpusProjectionSchema`
   already has a `disclaimer: z.string()` field from the previous round — use
   it: when the DOB fallback fires, the response's `disclaimer` must say so
   explicitly (e.g. "Date of birth not on file — assumed 20 years to
   retirement.") instead of silently stating the same generic disclaimer as
   the DOB-present case.
5. Cheap cleanup while these files are open: the service header comment and
   two other doc comments (`schema.ts`, `tax.ts`) still say gross employer
   share is "12% of basic" — H2 explicitly removed that unconditional check;
   fix the stale wording. The import route's doc comment still describes the
   deleted preflight-return behavior ("a second call returns the existing row
   by payslip_id") — update it to describe the current always-upsert
   behavior.

Accepted, non-blocking: the real-Postgres integration suite cannot execute in
this sandboxed environment (`DATABASE_URL` unset) — an environment limitation
affecting every task in this phase equally. The TASK.md route line above has
already been corrected from PUT to POST by the coordinator directly (no
worker action needed for that item).

## Review-4 Blockers — Resolution Status

All 5 review-4 blockers are fixed across implementation rounds 3, 4, and 5
(implementation-3.md, implementation-4.md, implementation-5.md):

1. `computeStatus` unconditional-pending + zero-skip-only-for-VPF fix — done
   (implementation-3.md).
2. Stale `reconciliationStatus` after re-import: `createManual` and
   `importFromPayslip` now recompute status atomically in the same upsert —
   done (implementation-3.md).
3. BigInt per-step compounding in `computeEpfProjection` — done
   (implementation-3.md).
4. DOB-missing fallback now surfaces an explicit disclaimer in the response —
   done (implementation-3.md).
5. Stale doc-comment cleanup (service header, import route, shared schema) —
   done (implementation-3.md).

**TOCTOU race (found and fixed post review-4):** A follow-up Codex review
found a TOCTOU race in `createManual`/`importFromPayslip`: the status
recompute SELECT and the upsert were not atomic, so a concurrent
`confirmActual` could write actuals between them, and the upsert would
overwrite the persisted `reconciliationStatus` with a stale value (computed
from pre-confirm actuals). Fixed via `db.transaction()` + `.for("update")`
on the preflight SELECT in both functions (implementation-4.md).

The same review also found the symmetric race exists in `confirmActual`: a
concurrent `createManual`/`importFromPayslip` could change `expected_*`
between `confirmActual`'s SELECT and UPDATE, causing it to persist a status
computed against stale expected values. Fixed the same way — `confirmActual`
now also wraps in `db.transaction()` + `.for("update")` (implementation-5.md).

**Accepted residual limitation (coordinator decision):** One exotic race
remains undocumented and NOT fixed, by coordinator decision: if two
`createManual`/`importFromPayslip` calls for a not-yet-existing row race with
an interleaved `confirmActual`, the first call's `ON CONFLICT DO UPDATE` can,
in one specific 4-step interleaving, overwrite a freshly-confirmed status with
its own stale-computed one. The `.for("update")` lock cannot protect a key
that does not yet exist. This requires three concurrent mutating requests for
the same (user, wage_month, epfo_member_id) tuple from a single user, which
is not a realistic scenario for this single-user personal-finance app.
Additionally the status is self-correcting: the next invocation of any of the
three operations on that row will recompute from current data. No fix applied;
acknowledged here as a known, accepted limitation.

**Final doc-accuracy fixes applied (implementation-6.md):**
- `packages/shared/src/schemas/tax.ts` — `ReconciliationStatus` doc comment
  `matched`/`mismatch` lines updated to reference "relevant components (per
  the pending rule above)" rather than the stale "positive-expected
  components" wording, which no longer accurately describes the current
  `computeStatus` logic (zero-expected employee/employer/EPS also require an
  actual).
- `apps/api/src/modules/tax/services/epf-contributions.ts` — `confirmActual`
  doc comment updated: the claim that the status is "always 'matched' or
  'mismatch'" was wrong; `computeStatus` can also return `'pending'` when only
  some actuals are submitted in a single call while other expected components
  still have null actuals.
