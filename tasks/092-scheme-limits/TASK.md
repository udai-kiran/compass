# Task: 13.6 — PPF / SSY / NPS Contribution-Limit & Eligibility Checks

## Status
COMPLETE

## Review-5 Blockers (pending fix — first implementation-code review)

Codex code review found one severe data-quality bug plus a systemic test-mocking
violation and several smaller correctness/robustness gaps. Confirmed by the
coordinator via the review's own file:line citations, cross-corroborated by
task 13.7's independent plan review flagging the SAME root defect from the
consumer side.

1. **SEVERE: lifecycle/data-quality gaps erase real contribution totals.**
   Every branch that hits `data_missing`/`data_invalid`/`outside_deposit_window`
   (missing `schemeOpenedDate`, missing SSY holder/DOB, SSY age invalid, SSY
   outside deposit window, missing NPS detail) returns `annualContributedPaise: 0`
   **without ever querying postings** — so an account with real, ledger-verified
   contributions reports zero the moment its lifecycle metadata has a gap, and
   `eligible80CPaise`/deficit/headroom are then all computed from that
   fabricated zero. Task 13.7's plan review independently found the exact same
   defect from the consumer side ("real ledger contributions can be silently
   omitted from the deduction basket"). Fix: **always** compute the real FY
   aggregate from postings first, regardless of lifecycle-metadata status; the
   metadata gap should only affect `statusCode` and the notes explaining why
   lifecycle judgment isn't possible — never the raw contributed-amount input
   that AC6/eligible80CPaise/npsEmployeeContributionPaise derive from.
2. **The mandatory P8 persistence/security tests are mocked away.** Same
   systemic issue as tasks 13.4/13.5: `scheme-compliance.test.ts` uses a fake
   Drizzle interface that ignores every SQL predicate and returns a preset
   result, so the "different user owns the NPS detail" test, the
   cross-user-transaction test, the soft-delete-exclusion test, and the
   opening-balance-exclusion test never actually exercise the real query —
   `tasks/TDD.md` forbids this ("do not mock the database"). Add real-Postgres
   integration tests for: a wrong-user NPS detail row (same accountId,
   different userId on `accountNpsDetails`) correctly falling through to
   `data_missing`; a real Tier II account excluded from the list; a posting on
   another user's transaction excluded; a soft-deleted transaction excluded; an
   opening-balance posting excluded via the real `NOT EXISTS`; SSY holder
   ownership through a real `family_members` row. Follow
   `apps/api/src/modules/ledger/services/epf-contributions.test.ts`'s
   established pattern (`requireDatabaseUrl()` throws loudly rather than
   skipping). Extract the pure status/arithmetic decision logic (given plain
   inputs, not DB rows) into its own DB-free, unit-testable functions where
   that isn't already the case, per `tasks/TDD.md`'s functional-core rule.
3. **`fy` query validation uses a bare `z.string()`.** `GetSchemeComplianceQuerySchema`
   (or equivalent) should use the existing canonical `FySchema` (already used
   elsewhere in `packages/shared/src/schemas/tax.ts`), not an unrestricted
   string — otherwise a malformed `?fy=` value reaches `fyRange()` and throws
   a plain error instead of a validated 400.
4. **PPF lifecycle status is wall-clock-dependent instead of FY-dependent.**
   Maturity/lifecycle comparisons use "today" rather than the REQUESTED `fy`,
   so a report for a fixed historical FY (e.g. 2023-24) changes its answer
   depending on when you ask, once the account's real-world maturity date
   passes. Fix: derive the evaluation date from the requested `fy` (e.g. its
   end date, `fyRange(fy)[1]`) rather than `new Date()`, so a historical FY's
   compliance result is deterministic and stable over time. This also makes
   the classification function pure and testable without a clock, per
   `tasks/TDD.md`.
5. **SSY aggregation doesn't clamp to the deposit-window end within a
   straddling FY.** The window-end check only compares `fyStart > windowEnd`;
   when the 15-year window ends midway through the requested FY, the
   aggregate still sums postings through the FY's full end date. Fix: when
   `windowEnd` falls inside `[fyStart, fyEnd]`, clamp the aggregation's upper
   date bound to `windowEnd` instead of `fyEnd`.
6. **SSY revival penalty incorrectly reuses PPF's ₹55,000 constant.**
   TASK.md's SSY rules never specified a revival amount (only PPF's ₹50 fee +
   ₹500 arrears is specified). Remove the specific ₹55,000/"₹500 arrears" claim
   from SSY's notes and `scheme-limits.ts`'s SSY rule data — state only that a
   discontinued SSY account can be revived for a fee without asserting an
   unverified number, or add a distinctly-named, separately justified SSY
   constant if one can be sourced; do not reuse the PPF value.
7. **The opening-account structural subquery isn't user-scoped.** The
   `NOT EXISTS` subquery's join checks only `a2.system_kind = 'opening'`,
   omitting `a2.user_id = userId`. Under normal application invariants no
   cross-user postings exist, but the canonical query design in this file
   always scopes by user defensively — add the same scoping here.
8. **No shared-schema tests for the new scheme-compliance contracts.** Add
   tests in `packages/shared/src/schemas/tax.test.ts` (or wherever this
   file's existing pattern lives) for the exact 9-value `statusCode` enum,
   the required-but-nullable `eligible80CPaise`/`npsEmployeeContributionPaise`
   pair, `isEstimate` as a true literal, absence of any CCD field, and
   `FySchema`-based query validation (from item 3).
9. Tests that hardcode "today" as a fixed FY-is-open reference will age into
   false failures once real time passes that FY's end — inject an evaluation
   date into tests rather than relying on the ambient clock (this follows
   naturally from fixing item 4).

Not required this round (explicitly non-blocking per the review itself): the
N+1 per-account contribution query pattern in the list endpoint is
unnecessary complexity but not an acceptance-criterion failure — leave it
unless it's cheap to fix as a side effect of the other changes.

## Objective
FY-aware per-account contribution limit checks for PPF, SSY, and NPS: annual min/max enforcement, dormancy risk flagging, and deductible-amount reporting for each scheme — providing the data layer that 13.7 (80C basket) consumes.

## Root Cause
Compass records PPF/SSY/NPS contributions as transactions but draws no compliance conclusion. Statutory limits matter: a PPF account below ₹500/FY becomes discontinued and needs ₹50 + ₹500/year arrears to revive. No existing code checks any of these.

## Design Decisions (reviews 1 + 2 addressed)

**H1 fix (review-1)**: Add `scheme_opened_date DATE NULL` to accounts. Null → statusCode='data_missing'.
**H1 fix (review-2)**: Expand statusCode enum to include: `ok`, `below_min`, `above_max`, `discontinued_risk`, `discontinued`, `data_missing`, `data_invalid`, `outside_deposit_window`, `lifecycle_unknown`.

**H2 fix**: NPS 80CCD(1) salary-based cap deferred to 13.8. This task exposes raw `npsEmployeeContributionPaise` only. No `eligibleNpsCcd1Paise` or `eligibleNpsCcd1bPaise` (those would double-count from review-2 H4 and overclaim from H5). NPS Tier II excluded (join accountNpsDetails, require tier='tier_i' — review-2 H7).

**H3 fix**: Per-account `eligible80CPaise` = min(annualContributedPaise, 15_000_000) paise for PPF/SSY. Cross-account PPF cap descoped. Claim allocation deferred to 13.7. Do NOT claim double-counting detection.

**H4/H5 (review-2) fix (review-4 wording)**: NPS result carries `npsEmployeeContributionPaise` (= annualContributedPaise). `eligible80CPaise` EXISTS on every result but is `null` for NPS and populated for PPF/SSY. No CCD(1)/(1B) allocation fields anywhere in this task.

**H3 postings query (review-3 canonical — supersedes any earlier description)**: Must include:
- `transactions.user_id = userId` (mandatory user scoping)
- `transactions.deleted_at IS NULL` (exclude soft-deleted)
- Opening-balance exclusion is STRUCTURAL via NOT EXISTS on a posting from the same transaction to an account with `systemKind='opening'` — there is NO `transactions.type` column
- Any positive posting that passes all of the above is counted. Labeled `isEstimate: true`.

**H2 (review-2) PPF maturity**: PPF matures 15 years from the END of the opening FY (not opening date). E.g., opened June 2010 → opening FY = 2010-11 → matures March 31, 2026. Post-maturity without extension mode: return statusCode='lifecycle_unknown' with note. Extension mode is out of scope.

**H6 (review-2) paise values**: All amounts in paise. ₹1.5L = 15_000_000 paise. ₹50,000 = 5_000_000 paise. ₹500 = 50_000 paise. ₹250 = 25_000 paise. ₹1,000 = 100_000 paise. Implementation must use these correctly.

**H7 (review-3 canonical)**: Load owned NPS accounts with LEFT JOIN `accountNpsDetails` ON accountId AND detail.userId = userId; then classify after retrieval: null detail → 'data_missing'; tier='tier_ii' → exclude silently; tier='tier_i' → include. Never a WHERE filter on tier (it would drop missing-detail rows).

**M1 (review-2)**: scheme_opened_date goes into `packages/shared/src/schemas/ledger.ts` (NOT wealth.ts) — in AccountSchema, CreateAccountSchema, UpdateAccountSchema. Also expose via `toAccount()` in accounts service. The DB column is in `db/shared/hubs.ts`.

**Gender (SSY)**: Cannot verify — noted in `notes[]`. Age on opening date from family_members.date_of_birth (join must require `family_members.user_id = userId`). Missing DOB → statusCode='data_missing'.

**NPS exit**: Fully descoped.

**M6**: CCD(2) (employer NPS) is out of scope for 13.6. Remove from plan.

## Scope

### New files
- `apps/api/src/lib/scheme-limits.ts` — pure FY-aware limit data (min/max/rules per scheme kind)
- `apps/api/src/lib/scheme-limits.test.ts`
- `apps/api/src/modules/tax/services/scheme-compliance.ts` — reads accounts + postings, applies limits
- `apps/api/src/modules/tax/services/scheme-compliance.test.ts`
- `apps/api/src/modules/tax/routes/scheme-compliance.ts`

### Modified files
- `apps/api/src/db/shared/hubs.ts` — add `schemeOpenedDate` column to accounts table
- `apps/api/src/modules/tax/plugin.ts` — register routes
- `packages/shared/src/schemas/tax.ts` — add SchemeCompliance Zod schemas
- `packages/shared/src/schemas/ledger.ts` — add `schemeOpenedDate` to AccountSchema, CreateAccountSchema, UpdateAccountSchema (NOT wealth.ts)
- `apps/api/src/modules/ledger/services/accounts.ts` — expose schemeOpenedDate in toAccount() mapper

### Migration
- New migration: ALTER TABLE accounts ADD COLUMN scheme_opened_date DATE NULL

### Scheme rules (in scheme-limits.ts, data-driven by FY)
```typescript
interface SchemeRules {
  minAnnualPaise: number;         // ₹500 PPF, ₹250 SSY, ₹1000 NPS
  maxAnnualPaise: number | null;  // null = no statutory max (NPS)
  minDepositMultiple: number;     // ₹50 for PPF/SSY, ₹500 for NPS
  discontinuedBelowMin: boolean;  // true for PPF/SSY
  revivalPenaltyPerYear: number;  // 55_000 paise for PPF (₹50 fee + ₹500 arrears per default year)
  deductionSection: '80C' | null; // null for NPS — CCD allocation deferred to 13.7/13.8
}
```

**PPF (paise values):** minPaise=50_000, maxPaise=15_000_000, deposits in multiples of ₹50. Discontinued if < ₹500 (50_000 paise) credited in a COMPLETED FY; current FY shortfall is 'discontinued_risk'. Revival = ₹50 fee + ₹500 arrears per default year (service notes only; not computed). Maturity = 15 years from END of opening FY (e.g., opened Jun 2010 → opening FY 2010-11 → matures 31 Mar 2026). Post-maturity without extension mode → statusCode='lifecycle_unknown'. 80C eligible via `eligible80CPaise`.

**SSY (paise values):** minPaise=25_000, maxPaise=15_000_000, deposits in multiples of ₹50. Deposit window = 15 years from scheme_opened_date. Check: holder DOB from family_members via holder_id (join requires family_members.userId = userId). Age at opening > 10 years → statusCode='data_invalid'. Gender check: skipped — noted in notes[]. Outside deposit window → statusCode='outside_deposit_window'. 80C eligible via `eligible80CPaise`.

**NPS Tier I (paise values):** minPaise=100_000, maxPaise=null (no statutory max). Must join accountNpsDetails and require tier='tier_i'. Expose only `npsEmployeeContributionPaise` = annualContributedPaise. Salary cap (10%/20% of income) deferred to 13.8. CCD(2) employer contribution: OUT OF SCOPE for 13.6. No `eligible80CPaise` field for NPS (uses npsEmployeeContributionPaise instead).

### Compliance result per account
```typescript
interface AccountComplianceResult {
  accountId: string;
  schemeKind: 'ppf' | 'ssy' | 'nps_tier1';
  fy: string;
  annualContributedPaise: number;   // sum of positive non-opening-balance postings (estimate)
  minPaise: number;
  maxPaise: number | null;          // null for NPS (no statutory max)
  statusCode: 'ok' | 'below_min' | 'above_max' | 'discontinued_risk' | 'discontinued' 
            | 'data_missing' | 'data_invalid' | 'outside_deposit_window' | 'lifecycle_unknown';
  deficitPaise: number;             // max(0, minPaise - annualContributedPaise)
  headroomPaise: number | null;     // null when maxPaise is null
  // PPF / SSY only:
  eligible80CPaise: number | null;  // min(annualContributedPaise, 15_000_000 paise). Null for NPS.
  // NPS Tier I only:
  npsEmployeeContributionPaise: number | null; // raw employee contribution; salary cap applied by 13.8. Null for PPF/SSY.
  isEstimate: true;
  notes: string[];                  // data gaps, gender check skipped, lifecycle_unknown reason, etc.
}
```

### Routes (relative paths in tax plugin)
- `GET /scheme-compliance?fy=` — all eligible accounts for authenticated user
- `GET /scheme-compliance/:accountId?fy=` — single account

### How contributions are computed (review-3 corrected)
`transactions` has NO `type` column. Opening balances are structural: a transaction with a posting to an account whose `systemKind='opening'` (see accounts.ts:199 pattern). Exclude via NOT EXISTS:
```typescript
const [fyStart, fyEnd] = fyRange(fy); // returns [string, string] inclusive ISO dates
const openingAccountIds = /* select accounts.id where userId and systemKind='opening' */;
const contributions = await db.select({ total: sum(postings.amountPaise) })
  .from(postings)
  .innerJoin(transactions, eq(transactions.id, postings.transactionId))
  .where(and(
    eq(postings.accountId, accountId),
    eq(transactions.userId, userId),        // mandatory user scoping
    isNull(transactions.deletedAt),         // exclude soft-deleted
    notExists(/* posting from same transaction to an opening account */),
    gt(postings.amountPaise, 0),
    gte(transactions.date, fyStart),
    lte(transactions.date, fyEnd)
  ));
```

### NPS Tier I query (review-3 corrected: LEFT JOIN + detail user-scoping)
```typescript
const npsAccounts = await db.select({ account: accounts, detail: accountNpsDetails })
  .from(accounts)
  .leftJoin(accountNpsDetails, and(
    eq(accountNpsDetails.accountId, accounts.id),
    eq(accountNpsDetails.userId, userId)   // detail table has own userId — scope it too
  ))
  .where(and(eq(accounts.userId, userId), eq(accounts.type, 'nps')));
// detail null          → statusCode='data_missing'
// detail.tier='tier_ii' → EXCLUDE silently
// detail.tier='tier_i'  → include as nps_tier1
```

## Dependencies
- 13.1 (FY helpers, tax-rules.ts for NPS employer rates) — complete
- 4.1 (person model — family_members.date_of_birth for SSY) — complete

## Plan
- P1: Create `apps/api/src/lib/scheme-limits.ts` — pure limit data for PPF/SSY/NPS. Tests first for boundary values.
- P2: Add `schemeOpenedDate` to `accounts` table in `db/shared/hubs.ts`. Update `packages/shared/src/schemas/ledger.ts` account schemas. Generate migration.
- P3: Add Zod schemas to shared/tax.ts (AccountComplianceResult, GetSchemeComplianceQuery)
- P4: Create `scheme-compliance.ts` service — loads accounts by scheme type, queries postings for FY contributions, applies limits from scheme-limits.ts
- P5: Create routes (2 endpoints)
- P6: Wire plugin
- P7: Regenerate route snapshots
- P8: Tests: PPF discontinued boundary (49_999 vs 50_000 paise), SSY age gate incl. exact 10th birthday, NPS minimum, NPS result has NO CCD allocation fields and eligible80CPaise null, PPF maturity end-of-opening-FY + post-maturity lifecycle_unknown, missing schemeOpenedDate → data_missing, Tier II excluded, missing NPS detail → data_missing, NPS detail row owned by DIFFERENT user than account → data_missing (accountId/userId are independent columns), cross-user transaction excluded, soft-deleted transaction excluded, opening-balance transaction excluded

## Acceptance Criteria
- AC1: scheme-limits.ts is a pure library with correct min/max for PPF/SSY/NPS per FY
- AC2: accounts table gains scheme_opened_date (nullable); ledger.ts account schemas expose it; existing accounts unaffected
- AC3: SSY age gate checks holder DOB from family_members; gender gap noted in result notes
- AC4: NPS: npsEmployeeContributionPaise === annualContributedPaise; NO 80CCD(1)/(1B) allocation fields exist on the NPS result; eligible80CPaise is null for NPS (salary cap deferred to 13.8)
- AC5: PPF discontinued risk flagged when < 50_000 paise contributed; revival penalty correctly stated (₹50 fee + ₹500 arrears/default year)
- AC6: Headroom and deficit correct at boundary values; unit tested
- AC7: isEstimate=true on all results; notes[] explains data gaps
- AC8: Opening-balance exclusion via NOT EXISTS structural check (no transactions.type column exists)
- AC9: typecheck + lint + test green; route snapshots updated

## Verification
- T1-T8: typecheck, lint, scheme-limits boundary tests, service tests, route snapshot, migration exists

## Non-Goals
- NPS 80CCD(1) salary cap (deferred to 13.8 which has salary context)
- Double-counting detection/claim model (deferred to 13.7 allocator)
- PPF extension mode (needs more schema)
- SSY gender verification (no sex field in family_members)
- NPS exit compliance
- Interest credit classification on postings
