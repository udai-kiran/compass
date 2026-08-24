# Implementation Round 6 — Doc-comment accuracy fixes + TASK.md resolution record

## Files changed

- `packages/shared/src/schemas/tax.ts` — Fix A: updated `matched`/`mismatch` lines in `ReconciliationStatus` doc comment.
- `apps/api/src/modules/tax/services/epf-contributions.ts` — Fix B: updated `confirmActual` doc comment to accurately state `'pending'` is also a possible outcome.
- `tasks/091-epf-passbook/TASK.md` — Fix C: `## Status` changed from `IMPLEMENTING` to `COMPLETE`; new `## Review-4 Blockers — Resolution Status` section appended.

No logic was changed. No tests were modified. No other files were touched.

---

## Fix A — Complete diff (packages/shared/src/schemas/tax.ts)

```diff
-  * matched:   all positive-expected components have actuals within 1% of expected.
-  * mismatch:  all positive-expected components have actuals; ≥1 differs by >1%.
+  * matched:   all relevant components (per the pending rule above) have actuals within 1% of expected.
+  * mismatch:  all relevant components (per the pending rule above) have actuals; ≥1 differs by >1%.
```

Context (surrounding lines, unchanged):
```
 * pending:   any component with a non-null expected value (including zero, except VPF's zero-skip exception) still has a null actual, OR all four actuals are null.
 * matched:   all relevant components (per the pending rule above) have actuals within 1% of expected.
 * mismatch:  all relevant components (per the pending rule above) have actuals; ≥1 differs by >1%.
 * confirmed: RESERVED — set only by a future explicit user-override action, never
```

---

## Fix B — Complete diff (apps/api/src/modules/tax/services/epf-contributions.ts)

```diff
-  * The computed status is always 'matched' or 'mismatch' after this call
-  * (never 'confirmed' — that label is reserved for a future explicit-confirm flow).
+  * The computed status can be 'pending' (if some expected component still lacks
+  * an actual after this call), 'matched', or 'mismatch'
+  * (never 'confirmed' — that label is reserved for a future explicit-confirm flow).
```

Context (surrounding lines, unchanged):
```
 * Confirm actual EPF passbook values for a contribution row.
 * Computes reconciliationStatus via computeStatus() and persists it atomically.
 *
 * The computed status can be 'pending' (if some expected component still lacks
 * an actual after this call), 'matched', or 'mismatch'
 * (never 'confirmed' — that label is reserved for a future explicit-confirm flow).
 * Returns the updated row.
```

---

## Fix C — TASK.md changes

### Status field change

```diff
 ## Status
-IMPLEMENTING
+COMPLETE
```

### New section appended (exact text)

```
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
```

---

## Commands run and literal output

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```

### 2. `npm run typecheck -w packages/shared`

```
> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```

### 3. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```

### 4. `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`

```
TAP version 13
# Subtest: computeStatus
    ok 1 - returns pending when actual employee is null and expected employee is positive
    ok 2 - returns pending even when some actuals are set but employee is null
    ok 3 - returns pending when eps actual is null and expected eps is positive (new H4 rule)
    ok 4 - returns pending when employer actual is null and expected employer is positive
    ok 5 - returns pending when vpf actual is null and expected vpf is positive
    ok 6 - returns matched on exact match across all three columns (vpf=0, no vpf expected)
    ok 7 - returns matched when the difference is within the 1% tolerance
    ok 8 - returns matched at exactly 1% difference (boundary — not a mismatch)
    ok 9 - returns mismatch when employee differs by more than 1%
    ok 10 - returns mismatch when employer differs by more than 1%
    ok 11 - returns mismatch when eps differs by more than 1%
    ok 12 - returns mismatch when vpf actual differs from expected by more than 1%
    ok 13 - returns matched when vpf actual matches expected within 1%
    ok 14 - treats a null expected column as not a pending trigger and not comparable (no mismatch)
    ok 15 - a zero expected EPS with a null actual now needs confirmation (blocker 1 — EPS/employer/employee lost their zero exception)
    ok 16 - a zero expected employee with a null actual needs confirmation (no zero exception for employee)
    ok 17 - a zero expected employer with a null actual needs confirmation (no zero exception for employer)
    ok 18 - treats a zero expected column as not comparable for mismatch (avoids divide-by-zero)
    ok 19 - returns pending when all four actuals are null, even with all expected null/zero (fresh unconfirmed row)
    ok 20 - flags a mismatch when actual is lower than expected by more than 1%
    ok 21 - returns matched when all expected are null (or zero vpf) but actuals are set
    1..21
ok 1 - computeStatus
# Subtest: isGapEligible
    ok 1 - returns false on the day the wage month ends (day 0 of grace)
    ok 2 - returns false on day 44 of grace (one day before threshold)
    ok 3 - returns true on day 45 of grace (exactly at threshold)
    ok 4 - returns true well after the grace period
    ok 5 - handles month-end rollover correctly for month with 31 days
    ok 6 - handles February edge case (non-leap year)
    1..6
ok 2 - isGapEligible
# Subtest: computeEpfProjection
    ok 1 - returns currentCorpusPaise unchanged when monthsToRetirement is 0
    ok 2 - compounds once for 12 months (one year)
    ok 3 - compounds twice for 24 months (two years, integer at each step)
    ok 4 - uses only whole years (13 months = 1 full year, not 1.08 years)
    ok 5 - uses only whole years (23 months = 1 full year)
    ok 6 - returns zero when currentCorpusPaise is zero
    ok 7 - produces integer results (no fractional paise)
    ok 8 - produces an exact BigInt result for a corpus where the intermediate product exceeds Number.MAX_SAFE_INTEGER
    ok 9 - throws HttpError 500 when a compounding step produces a result exceeding Number.MAX_SAFE_INTEGER
    1..9
ok 3 - computeEpfProjection
# Subtest: fyToWageMonthRange
    ok 1 - maps FY 2025-26 to April 2025 → March 2026
    ok 2 - maps FY 2024-25 to April 2024 → March 2025
    ok 3 - handles a century rollover FY 2099-00
    ok 4 - produces a range that string-orders correctly for wage_month comparison
    1..4
ok 4 - fyToWageMonthRange
# Subtest: buildEpfContributionDto
    ok 1 - converts an unconfirmed payslip-derived row
    ok 2 - computes 80C eligibility from expected values when unconfirmed
    ok 3 - excludes employer EPF and EPS from 80C eligibility
    ok 4 - prefers actual over expected for 80C eligibility once confirmed
    ok 5 - mixes actual employee with expected vpf when only vpf is unconfirmed
    ok 6 - treats a fully null expected/actual row as zero 80C eligibility
    ok 7 - carries a null payslipId for manual entries
    ok 8 - carries a null employerName
    ok 9 - carries gapReason through
    ok 10 - carries the matched status through
    ok 11 - grossEmployerContributionPaise = expected employer + expected eps when no actuals
    ok 12 - grossEmployerContributionPaise uses actual values when confirmed
    ok 13 - grossEmployerContributionPaise mixes actual employer + expected eps when only employer confirmed
    ok 14 - grossEmployerContributionPaise is zero when all employer/eps values are null
    1..14
ok 5 - buildEpfContributionDto
1..5
# tests 54
# suites 5
# pass 54
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 382.792866
EXIT: 0
```

### 5. `git status --short` and `git diff --stat`

```
M apps/api/src/modules/tax/routes/epf-contributions.ts
 M apps/api/src/modules/tax/schema.ts
 M apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.ts
 M packages/shared/src/schemas/tax.ts
 M tasks/091-epf-passbook/TASK.md
?? tasks/091-epf-passbook/implementation-3.md
?? tasks/091-epf-passbook/implementation-4.md
?? tasks/091-epf-passbook/implementation-5.md

 apps/api/src/modules/tax/routes/epf-contributions.ts      |   3 +-
 apps/api/src/modules/tax/schema.ts                        |   2 +-
 apps/api/src/modules/tax/services/epf-contributions.integration.test.ts | 109 +++++-
 apps/api/src/modules/tax/services/epf-contributions.test.ts |  66 +++-
 apps/api/src/modules/tax/services/epf-contributions.ts   | 415 +++++++++++++--------
 packages/shared/src/schemas/tax.ts                        |   8 +-
 tasks/091-epf-passbook/TASK.md                            |  59 ++-
 7 files changed, 499 insertions(+), 163 deletions(-)
```

The modifications to `epf-contributions.ts`, `epf-contributions.test.ts`,
`epf-contributions.integration.test.ts`, `routes/epf-contributions.ts`, and
`schema.ts` are all pre-existing uncommitted changes from earlier rounds —
this round touched ONLY `packages/shared/src/schemas/tax.ts` (Fix A),
`apps/api/src/modules/tax/services/epf-contributions.ts` (Fix B, 3-line doc
comment), and `tasks/091-epf-passbook/TASK.md` (Fix C). No logic was touched.

---

## Assumptions

None beyond what the brief stated.

## Unresolved risks

None. The accepted no-row-exists race is documented in TASK.md per coordinator
decision and not fixed.
