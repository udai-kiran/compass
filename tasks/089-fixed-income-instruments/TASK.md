# Task: 13.3 — First-Class Fixed-Income & Small-Savings Instruments

## Status
COMPLETE (2026-08-23)

## Completion record
- Plan P1-P10 + fix rounds F1-F5, R1-R5 all implemented; review-5 delta confirmation verdict: **COMPLETE-ready** (M-NEW3 resolved; reviewer independently reproduced the reinvest BigInt derivation).
- Verification: verification-4.md — typecheck/lint exit 0; deposit suites 34/34 incl. M-NEW1 exact-rational regression (…281) and M-NEW3 payout regression (9_000_000_000_000_003); shared 352/352 (MAX_RD_INSTALLMENTS=600 enforced); full api suite 1140 pass / 33 ECONNREFUSED-only / 0 genuine failures.
- Interest AND balance arithmetic now exact BigInt end-to-end with one half-up round per period and safe-integer post-condition.
- Evidence chain: implementation-{2,3}.md (iteration-1 worker never reported), fix-{1,2,3}.md, verification-{1,2,3,4}.md, review-{2..5}.md.

## Codex re-review (review-3) — verdict BLOCKING
H1/M1/M2/M4/L1 RESOLVED with evidence; stub follow-up verified resolved. Three residues:
- **M-NEW1 (BLOCKING)**: RD computes `installment × bps × days` in float BEFORE division — at accepted safe-integer inputs (e.g. installment 955,173,831,910,025; totalInstallments 3; 1184bps; 2024-01-01→2024-04-01) intermediate products exceed 2^53 and half-up rounds to the WRONG paise (impl 56,391,369,504,282 vs exact 56,391,369,504,281.497→…281). Same latent risk exists in FD/periodInterest path. Aggregates can exceed safe range unchecked.
- **M-NEW2 (BLOCKING)**: `totalInstallments` unbounded in shared schema; redesign eagerly builds one string per installment and scans it per period → billions of allocations for an absurd-but-valid count.
- **M5 residue (BLOCKING)**: "property" suite is a fixed table, not generated coverage; missed both new defects. Missing: high-value RD inputs, aggregate overflow, payout-mode RD direct test, EOM drift assertion too weak (`>= 3` instead of === 3).
Scope-creep check clean; 29/29 still green.

## Fix round 2 (approved)
- R1 (M-NEW1): exact-interest refactor — compute ALL raw interest contributions (FD/NSC periodInterest full+stub AND RD opening + per-installment terms) in BigInt; sum raw terms exactly; ONE half-up round at the end ((2r >= d) style on BigInt); convert to Number after rounding. Post-condition: every emitted period field and schedule total must be a safe integer — throw a descriptive Error otherwise (defensive, tested). Keep public AccrualPeriod/Schedule shapes unchanged.
- R2 (M-NEW2): cap `totalInstallments` at 600 in packages/shared/src/schemas/wealth.ts UpsertDepositDetailsSchema (+ .int().positive() retained) — 50-year monthly RD ceiling; export constant; schema-level rejection test.
- R3 (M5): replace fixed-table property test with deterministic generated coverage (seeded LCG over kind/principal/installment/rate/frequency/disposition/date matrix) asserting: balance identity, period continuity, totals reconciliation, maturity=closing, non-negativity, safe-integer post-condition, payout-mode RD direct regression, EOM Jan-31 anchor asserts EXACTLY 3 periods for Jan31→Apr30 monthly.
- R4: add M-NEW1's reproduction as a regression test asserting the exact-rational result …281 (BigInt oracle inline in test).

## Codex re-review round 2 (review-4) — verdict BLOCKING on one new item
M-NEW1/M-NEW2/M5 residue RESOLVED with evidence; BigInt audit clean (halfUp semantics, common-denominator equivalence, no float interest math left, no narrow Number() window); prior expected values unchanged; 41/41 targeted pass.
- **M-NEW3 (BLOCKING)**: balance arithmetic still float — `closing = opening + deposit + interest − payout` can exceed 2^53 mid-expression before cancellation loses a paise. Repro: RD installment 3_000_000_000_000_001, count 3, 1184bps, PAYOUT, 2024-01-01→2024-04-01 → actual closing 9_000_000_000_000_002 vs correct 9_000_000_000_000_003. assertSafeIntegers can't see it (result stays "safe").

## Fix round 3 (approved)
- R5: perform ALL balance arithmetic in BigInt — per-period base, closing (both paths), runningBalance carry, totalInterest/totalDeposit reductions, maturityValue — converting each emitted value to Number exactly once; keep assertSafeIntegers as the final gate. Add review-4's reproduction as a regression test (expected closing 9_000_000_000_000_003) plus a high-value REINVEST case.

## Objective
FD, RD and NSC modelled with structured deposit details: principal/installment, rate, compounding, start/maturity, payout, premature-closure penalty. Interest accrual schedule computed on demand (not stored).

## Root Cause
An FD is merely `holdings.assetClass = "fd"` — no principal, rate, compounding, maturity, or penalty. RD and NSC have no typed model at all. Blocks maturity calendar, deduction basket, advance tax, and rebalancing.

## Codex Review Findings (review-1)
- **H1 (no kind discriminator)**: Accepted. Add `depositKind: 'fd' | 'rd' | 'nsc' | 'tax_saver_fd'` column. Drop separate `isTaxSaver` boolean — derive from `depositKind === 'tax_saver_fd'`.
- **H2 (RD needs installment fields)**: Accepted. Add `installmentPaise` and `totalInstallments` for RD. `principalPaise` remains for FD/NSC (lump-sum).
- **H3 (financial calc spec)**: Accepted. Specify: nominal rate, Actual/365 Fixed day-count for stub periods, nominal periodic rate for regular intervals. Rounding: round each period to nearest paise, half-up. Payout FD: paid interest not reinvested.
- **H4 (ownership/auth)**: Accepted. Service loads holding by ID + userId, verifies asset class before read/write. 404 for wrong user. Reject non-deposit holdings.
- **H5 (TDS contradiction)**: Accepted. Rename to `tdsSectionApplicable` as advisory flag. Actual TDS recording deferred to 13.4/13.10. Fix AC4 wording.
- **M6 (USER_TABLE not LINKED)**: Accepted. `deposit_details` has `userId`, goes in USER_TABLES. Matches `nps_details` and `gold_details` pattern.
- **M7 (computed schedule)**: Accepted. Schedule computed on demand, never stored. Expose via GET endpoint.
- **M8 (frequency enums)**: Accepted. Separate `interestDisposition: 'reinvest' | 'payout'` from `payoutFrequency`. `compoundingFrequency` stays.
- **M11 (holder)**: Accepted. Use `jointHolderName` as simple text field, not FK to family_members. Sufficient for this task.
- **M14 (annualRateBps)**: Confirmed complementary with `retirementDetails.annualRateBps` — same unit, no conflict.

## Scope

### Modified files
- `apps/api/src/modules/investments/schema.ts` — add `deposit_details` table + `depositKind` and `compoundingFrequency` pgEnums
- `apps/api/src/modules/investments/plugin.ts` — register deposit-details routes
- `apps/api/src/db/schema.ts` — re-export `depositDetails`, enums
- `apps/api/src/modules/system/services/backup.ts` — add to ALL_TABLES + USER_TABLES
- `packages/shared/src/schemas/wealth.ts` — add deposit Zod schemas

### New files
- `apps/api/src/modules/investments/services/deposit-details.ts` — CRUD + ownership validation
- `apps/api/src/modules/investments/services/deposit-accrual.ts` — pure schedule computation
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — property + example tests
- `apps/api/src/modules/investments/services/deposit-details.test.ts` — service tests
- `apps/api/src/modules/investments/routes/deposit-details.ts` — routes

### Table design: `deposit_details`
```
deposit_details (
  holding_id UUID PK FK → holdings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL FK → users(id),
  deposit_kind TEXT NOT NULL,  -- 'fd' | 'rd' | 'nsc' | 'tax_saver_fd'
  principal_paise BIGINT,       -- FD/NSC: lump-sum amount. NULL for RD.
  installment_paise BIGINT,     -- RD: monthly installment. NULL for FD/NSC.
  total_installments INTEGER,   -- RD: number of monthly deposits. NULL for FD/NSC.
  annual_rate_bps INTEGER NOT NULL,  -- basis points (710 = 7.10%)
  compounding_frequency TEXT NOT NULL,  -- 'monthly' | 'quarterly' | 'half_yearly' | 'annually'
  interest_disposition TEXT NOT NULL DEFAULT 'reinvest',  -- 'reinvest' | 'payout'
  payout_frequency TEXT,         -- 'monthly' | 'quarterly' | 'half_yearly' | 'annually' | NULL (cumulative/reinvest)
  start_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  auto_renewal BOOLEAN NOT NULL DEFAULT false,
  premature_closure_penalty_bps INTEGER,  -- rate reduction on premature closure
  joint_holder_name TEXT,
  tds_section_applicable BOOLEAN NOT NULL DEFAULT true,  -- 194A advisory flag
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (maturity_date > start_date),
  CHECK (principal_paise > 0 OR installment_paise > 0),
  CHECK (deposit_kind != 'rd' OR installment_paise IS NOT NULL),
  CHECK (deposit_kind != 'rd' OR total_installments IS NOT NULL),
  CHECK (deposit_kind = 'rd' OR principal_paise IS NOT NULL)
)
```

### Accrual computation rules
- **Day-count**: Actual/365 Fixed for stub periods. Regular periods use nominal periodic rate.
- **Periodic rate**: `annualRateBps / (100 * periodsPerYear)` where periodsPerYear = 12/4/2/1
- **Rounding**: Round each period's interest to nearest paise (half-up)
- **Payout FD**: Paid interest NOT reinvested into principal. Only reinvest mode compounds.
- **NSC**: Annual compounding, reinvested, taxable each year. 5-year fixed.
- **RD**: Monthly deposits + quarterly compounding (standard). Each deposit contributes from its date.
- **Tax-saver FD**: 5-year lock-in, validated by service.

### Schedule output
```typescript
interface AccrualPeriod {
  periodStart: string;    // ISO date
  periodEnd: string;      // ISO date
  openingPaise: number;
  depositPaise: number;   // RD: installment. FD/NSC: 0 after first.
  interestPaise: number;  // gross interest for this period
  payoutPaise: number;    // payout-mode: interest paid out. reinvest: 0.
  closingPaise: number;
  taxableInterestPaise: number;  // for income ledger (13.4)
}
```

## Dependencies
- 5.2 (instrument rules registry) — done. `fd`, `rd`, `nsc`, `tax_saver_fd` categories already defined.

## Plan
- P1: Write characterization tests for existing holding-details pattern (ownership, asset-class validation)
- P2: Add `deposit_details` table to investments schema with `depositKind` enum, constraints
- P3: Create deposit-accrual pure module — FD, RD, NSC schedule computation with Actual/365 Fixed day-count
- P4: Write comprehensive accrual tests first (TDD): FD quarterly compound, FD monthly payout, RD 12-month, NSC 5-year, paise rounding, leap year, stub periods
- P5: Create deposit-details service — CRUD with ownership validation (load holding by ID + userId, verify asset class)
- P6: Create routes — `GET /api/holdings/:id/deposit`, `PUT /api/holdings/:id/deposit`, `GET /api/holdings/:id/deposit/schedule`
- P7: Wire into plugin, schema barrel, backup.ts (USER_TABLES after `holdings`)
- P8: Extend wealth.ts Zod schemas
- P9: Generate migration
- P10: Update route snapshots

## Acceptance Criteria
- AC1: FD, RD, NSC and tax-saver FD distinguished by `depositKind` enum
- AC2: RD modelled with `installmentPaise` + `totalInstallments`; FD/NSC with `principalPaise`
- AC3: Premature-closure penalty captured as advisory `prematureClosurePenaltyBps`
- AC4: TDS applicability flagged (advisory only — actual TDS deferred to 13.4/13.10)
- AC5: Interest accrual schedule computed on demand, never stored
- AC6: Payout FD: interest not reinvested. Reinvest/cumulative: interest compounds.
- AC7: Tax-saver validated as 5-year FD. NSC enforced as 5-year annual-compound reinvest.
- AC8: Integer paise throughout; Actual/365 Fixed day-count; half-up rounding per period
- AC9: Table in ALL_TABLES + USER_TABLES (not LINKED_TABLES — has userId)
- AC10: Ownership validation matches existing holding-details pattern (load by holdingId + userId)
- AC11: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` passes
- T2: `npm run lint` passes
- T3: `npm run test` passes
- T4: 1-year FD at 710 bps quarterly compounding: correct paise
- T5: 12-month RD schedule: correct maturity value
- T6: NSC 5-year annual reinvest: correct taxable interest per year
- T7: Payout FD: interest paid out each period, principal unchanged
- T8: Migration SQL reviewed
- T9: `backup.test.ts` passes
- T10: Route snapshots updated

## Non-Goals
- UI for deposit details (later UI task)
- Maturity calendar (14.3)
- Actual TDS on interest computation (13.4/13.10)
- Linking deposits to income ledger (13.4)
- Auto-renewal behaviour beyond boolean flag

## Coordinator findings (own read, 2026-08-23, pre-review)
Implementing worker never filed implementation-N.md; work exists uncommitted in tree. Findings from my own read:
- C1 (spec conflict, HIGH): `computeRdSchedule` credits ALL installments of a quarter as if deposited at period START ("standard simplified model", per file header). TASK.md Accrual rules say "Each deposit contributes from its date." Current model overstates RD interest. Needs redesign: per-installment accrual from deposit date (proportional within period or day-count based). High-thinking work.
- C2 (AC gap): NSC enforced as annual-compound + reinvest ✓ but NOT enforced as 5-year term; AC7 requires NSC 5-year enforcement (only tax_saver_fd checks term).
- C3 (edge, related to C1): RD accrual stops entirely once `installmentsUsed >= total` — any stub between last installment and maturityDate earns no interest; conversely periods are quantized to whole compounding intervals.
- C4 (low): tax-saver FD 5-year check tolerates 1825–1832 days (~1 week slop beyond real 1826/1827); tighten or justify.
- Verified non-issue: `assetClass` has no rd/nsc members (enum: stock/mutual_fund/etf/gold/silver/fd/nps/real_estate/other), so gating all deposit kinds behind `assetClass === 'fd'` is correct; depositKind distinguishes. Full-path route URLs match investments-module convention (sub-plugins registered without prefix); tax module's prefix style is the newer pattern — both coexist legitimately.

## Codex review findings (review-2) — verdict BLOCKING
- **H1 BLOCKING (=C1)**: RD credits all quarterly installments at period START. Example: 3×₹10k @7% Q1 → impl 52,500 paise vs per-date Actual/365F ≈ 34,900 paise (~50% overstated). Existing test codifies the shortcut.
- **M2 BLOCKING (=C3)**: RD loop stops when installments exhausted — post-final-installment stub earns nothing even if maturityDate later.
- **M3 BLOCKING**: period boundaries chain from previously CLAMPED dates → end-of-month anchors drift (Jan31→Feb28→Mar28…), creating spurious stub periods. Boundaries must derive from startDate + n periods (anchored).
- **M4 BLOCKING**: RD quarterly compounding not enforced by service (any frequency accepted).
- **M1 BLOCKING (=C2)**: NSC term not validated as 5 years (only annual+reinvest checked). Enforce exact calendar 5-year span.
- **M5 BLOCKING**: missing property coverage (balance coherence across generated inputs, period continuity, totals reconciliation, rounding boundaries) and regression tests (NSC non-5-year rejection, RD installment-date accrual, maturity-after-final-installment, non-quarterly RD rejection, tax-saver exact boundaries).
- **L1 (=C4)**: tax-saver tolerance 1825–1832 days sloppy → use exact calendar comparison (startDate + 5y), which handles leap years naturally.
- Confirmed good: FD/NSC math, payout semantics, daysDiff, ownership pattern, upsert target/completeness, all five CHECK constraints in schema+migration, backup placement, shared schemas/routes/snapshots, demo safety, conventions.

## Fix round (approved plan addition)
- F1 (H1+M2+M3): redesign `computeRdSchedule`: installment dates anchored at `addMonths(startDate, k)`; per period, opening balance earns nominal periodic rate; each installment accrues from ITS deposit date to period end at Actual/365F (`installment × bps × days / (10000×365)`); aggregate raw contributions then ONE half-up round per period. Loop until `maturityDate` (deposit 0 after last installment). All period boundaries derived as `addMonths(startDate, n×monthsPerPeriod)` — never chained from clamped dates (applies to FD/NSC path too).
- F2 (M1+L1): NSC AND tax_saver_fd enforce `maturityDate === addMonths(startDate, 60)` exactly (calendar-exact, leap-safe; delete day-count tolerance).
- F3 (M4): service rejects RD unless `compoundingFrequency === "quarterly"` (400) + negative test.
- F4 (M5): property-style tests (generated terms): closing=opening+deposit+interest−payout, period continuity, totals reconcile, half-up rounding boundary cases, safe-integer/non-negativity; regression tests for every rejected shape above and RD per-installment accrual example (3×₹10k @7% ≈34,900 paise Q1).
- F5: update header comment (remove "simplified model" language); keep pure-module design.
