# Worker Delegation

## Task
089 — 13.3 Fixed-Income & Small-Savings Instruments

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: Financial calculation design (compound interest with multiple conventions), domain modelling (FD vs RD vs NSC with different accrual patterns), integration with existing holdings/investments module patterns (ownership validation, schema barrel, backup), and Indian bank product rules. Requires choosing among plausible designs and preserving subtle invariants.

## Approved Plan
- P1: Write characterization tests for existing holding-details ownership pattern
- P2: Add `deposit_details` table to investments schema with `depositKind` enum, constraints, check constraints
- P3: Create `deposit-accrual.ts` pure module — FD, RD, NSC schedule computation with Actual/365 Fixed
- P4: Write comprehensive accrual tests first (TDD): FD quarterly compound, FD monthly payout, RD 12-month, NSC 5-year, paise rounding, leap year
- P5: Create `deposit-details.ts` service — CRUD with ownership validation
- P6: Create routes — `GET /api/holdings/:id/deposit`, `PUT /api/holdings/:id/deposit`, `GET /api/holdings/:id/deposit/schedule`
- P7: Wire into plugin, schema barrel, backup.ts (USER_TABLES)
- P8: Extend wealth.ts Zod schemas
- P9: Generate Drizzle migration
- P10: Update route snapshots

## Files and Symbols
### New
- `apps/api/src/modules/investments/services/deposit-accrual.ts`
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts`
- `apps/api/src/modules/investments/services/deposit-details.ts`
- `apps/api/src/modules/investments/services/deposit-details.test.ts`
- `apps/api/src/modules/investments/routes/deposit-details.ts`

### Modified
- `apps/api/src/modules/investments/schema.ts` — add `depositDetails` table, `depositKind` enum, `compoundingFrequency` enum
- `apps/api/src/modules/investments/plugin.ts` — register deposit-details routes
- `apps/api/src/db/schema.ts` — re-export `depositDetails`, `depositKind`, `compoundingFrequency`
- `apps/api/src/modules/system/services/backup.ts` — add `deposit_details` to ALL_TABLES + USER_TABLES
- `packages/shared/src/schemas/wealth.ts` — add deposit Zod schemas

## Required Changes
See Plan above. Key design points:
- `depositKind: 'fd' | 'rd' | 'nsc' | 'tax_saver_fd'` — no separate `isTaxSaver` boolean
- `installmentPaise` + `totalInstallments` for RD; `principalPaise` for FD/NSC
- `interestDisposition: 'reinvest' | 'payout'` separate from compounding
- Accrual schedule is computed, never stored
- Ownership: load holding by holdingId + userId, verify asset class before read/write
- All amounts in integer paise, rates in basis points
- Accrual math: nominal periodic rate, Actual/365 Fixed for stubs, half-up rounding per period

## Must Not Change
- `apps/api/src/db/shared/spines.ts` — holdings table stays as-is
- `apps/api/src/lib/instrument-rules.ts` — existing rules already have fd/rd/nsc/tax_saver_fd
- Existing holding-details services/routes — deposit is a new subtype alongside nps_details/gold_details

## Acceptance Criteria
- AC1-AC11 from TASK.md

## Commands
1. Run tests: `node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts`
2. Run tests: `node --test apps/api/src/modules/investments/services/deposit-details.test.ts`
3. Full suite: `npm run typecheck && npm run lint && npm run test`
4. Generate migration: `npm run db:generate`

## Required Evidence
- files changed
- complete diff
- all commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 2 — Independent Verification

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic gate runs and evidence collection against already-defined pass/fail criteria (T1-T10). The implementing worker never filed its implementation report, so this verification also establishes what actually exists in the tree vs the P1-P10 plan. Read-only apart from the verification report file.

## Approved Plan
Same shared verification run as 087 iteration 2 (one working tree, both approved implementations co-resident): repo status, diff inventory, gates, targeted deposit-accrual/deposit-details tests, snapshot/schema-decomposition/backup-static checks, migration content check (`deposit_details` present), plugin registration check, full api suite with failure classification.

## Required Evidence
- repository status, modified + untracked file lists
- exact commands, literal outputs, pass/fail counts, exit codes
- per-check verdict mapped to T1-T10 of TASK.md
- existence check for every New file in Files and Symbols
- skipped commands and why

---

## Iteration 3 — Fix typecheck blocker (follow-up)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: verification-1 identified an exact mechanical fix — TS2769 at deposit-details.test.ts lines 58/98/131, users inserts missing required `displayName`. Deterministic single-file edit plus gate re-run.

## Approved Plan
Add `displayName` (any short literal) to all three user-insert objects in `apps/api/src/modules/investments/services/deposit-details.test.ts`. Change nothing else. Then re-run typecheck and the two targeted deposit test files.

## Files and Symbols
- `apps/api/src/modules/investments/services/deposit-details.test.ts` — three `db.insert(users).values({...})` objects

## Must Not Change
- Any other file, including schema, services, snapshots, migrations

## Acceptance Criteria
- `npm run typecheck` exits 0 across all workspaces
- `node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts` still passes

## Commands
1. `npm run typecheck`
2. `node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts`

## Required Evidence
- complete diff of the edited file
- literal command output + exit codes

---

## Iteration 4 — Fix round (review-2 blockers)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: RD accrual redesign (per-installment date-based accrual, anchored boundaries), exact-calendar term enforcement, and property-test generation for money invariants. Subtle financial-math invariants, not mechanical.

## Approved Plan
TASK.md "Fix round" F1–F5 exactly, driven by review-2 H1/M1-M5/L1. Tests written before code per TDD. Read tasks/089-fixed-income-instruments/review-2.md for full evidence.

## Files and Symbols
- `apps/api/src/modules/investments/services/deposit-accrual.ts` + `.test.ts` — F1 (redesign), F4 (property+regression tests), F5 (comment)
- `apps/api/src/modules/investments/services/deposit-details.ts` + `.test.ts` — F2 (NSC + tax-saver exact calendar 5-year), F3 (RD quarterly enforcement) + negative tests

## Must Not Change
- `modules/investments/schema.ts`, `plugin.ts`, routes, db barrel, backup.ts, shared wealth schemas, snapshots, migrations (schema/migration unchanged by this round)
- Anything under modules/tax/**, lib/tax-rules.ts, lib/financial-year.ts (co-resident task 087 owns those this round)
- FD/NSC interest formula semantics beyond boundary anchoring (nominal periodic rate + Actual/365F stubs stay)

## Acceptance Criteria
AC5-AC8 now genuinely satisfied; AC7 NSC enforcement complete; review-2 H1/M1-M5 resolved.

## Commands
1. `node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts`
2. `npm run typecheck`
3. `npm run lint`

## Required Evidence
- files changed + complete diff
- literal command output + exit codes
- explicit note of any plan deviation or ambiguity encountered

---

## Iteration 5 — RD stub-period day-count consistency

## Worker
`codex-worker`

## Routing Reason
Low-thinking: coordinator-identified follow-up with fully specified mechanics — mirror the FD path's stub handling inside computeRdSchedule and adjust one test expectation.

## Approved Plan
In `computeRdSchedule` (apps/api/src/modules/investments/services/deposit-accrual.ts): compute `isFullPeriod` exactly as the FD path does (`!isLastPeriod || standardEnd === terms.maturityDate`). When NOT a full period, the OPENING balance contribution must use Actual/365 Fixed day-count — `(opening * annualRateBps * daysDiff(periodStart, periodEnd)) / (10_000 * 365)` — instead of the nominal periodic rate. Installment contributions are unchanged (already day-count based). Update the header comment accordingly. Update/add the maturity-beyond-final-installment stub test to assert the pro-rated opening contribution (compute expected by hand from the formula and show the arithmetic in the report).

## Files and Symbols
- `apps/api/src/modules/investments/services/deposit-accrual.ts` — computeRdSchedule only
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — RD stub test expectation(s)

## Must Not Change
- FD/NSC path, service validation, schema, routes, snapshots, migrations

## Acceptance Criteria
RD stub final period accrues opening balance pro-rata by Actual/365F; full periods unchanged (existing 28 tests stay green except the intentionally updated stub expectation).

## Commands
1. node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
2. npm run typecheck

## Required Evidence
- complete diff, literal outputs, exit codes, hand-computed stub arithmetic

---

## Iteration 6 — Independent Verification (round 2)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: same deterministic combined gate run as 087 Iteration 4 (one shared tree), reporting the 089 subset.

## Approved Plan
Same commands as 087 iteration 4; verify F1-F5 + stub fix landed, 29 deposit tests pass, T1-T10 verdicts, P1-P10 still satisfied, no unapproved files touched.

## Required Evidence
- literal outputs, counts, exit codes, per-T verdicts, report file (verification-2.md here)

---

## Iteration 7 — Fix round 2 (review-3 blockers)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: exact-integer (BigInt) interest refactor across both accrual paths with half-up semantics preserved, safe-integer post-condition design, generated property coverage. Financial-math subtlety, not mechanical.

## Approved Plan
TASK.md "Fix round 2" R1–R4 exactly, driven by review-3 M-NEW1/M-NEW2/M5-residue + low-severity residues. TDD: encode the reviewer's reproduction (…281 exact result) and the EOM/payout regressions as failing tests first where possible.

## Files and Symbols
- `apps/api/src/modules/investments/services/deposit-accrual.ts` — R1 BigInt refactor (both paths), unchanged public shapes
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — R3 generated coverage, R4 regression, EOM === 3 periods, RD payout regression
- `packages/shared/src/schemas/wealth.ts` — R2 totalInstallments max 600 (+ exported constant)
- `packages/shared` schema test if one exists for wealth schemas — add rejection case

## Must Not Change
- deposit-details service/routes, schema.ts, plugin.ts, backup.ts, db barrel, snapshots, migrations
- Anything under modules/tax/** or lib/tax-rules.ts / financial-year.ts / db/schema.decomposition.test.ts (co-resident 087 round 3 owns those)

## Acceptance Criteria
AC8 genuinely holds at accepted input extremes; review-3 M-NEW1/M-NEW2/M5 resolved; all prior green tests remain green except intentional expectation updates.

## Commands
1. node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
2. npm run test -w packages/shared
3. npm run typecheck
4. npm run lint

## Required Evidence
- files changed + complete diff, literal outputs, exit codes, deviations

---

## Iteration 8 — Independent Verification (round 3, final)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: same combined final gate run as 087 Iteration 6, reporting the 089 subset (R1-R4 landed).

## Required Evidence
- literal outputs, counts, exit codes, T1-T10 verdicts, report file verification-3.md

---

## Iteration 9 — Fix round 3 (review-4 M-NEW3)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: coordinator-specified mechanical refactor — move remaining balance arithmetic from float to BigInt in one module, plus two regression tests. The reviewer's reproduction gives the exact expected value.

## Approved Plan
TASK.md "Fix round 3" R5 exactly: in apps/api/src/modules/investments/services/deposit-accrual.ts compute per-period base, closing (FD/NSC and RD paths), runningBalance carry, totalInterestPaise/totalDepositPaise reductions and maturityValuePaise in BigInt; convert each emitted value to Number once; assertSafeIntegers stays the final gate. Tests: add review-4's payout reproduction (RD installment 3_000_000_000_000_001, totalInstallments 3, annualRateBps 1184, payout, 2024-01-01→2024-04-01) asserting Q1 closing === 9_000_000_000_000_003, and one high-value REINVEST case. All existing expected values must remain identical.

## Files and Symbols
- `apps/api/src/modules/investments/services/deposit-accrual.ts` — balance arithmetic only
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — two new regressions

## Must Not Change
- Interest math (already exact), public shapes, service/schema/shared files

## Commands
1. node --experimental-test-module-mocks --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
2. npm run typecheck

## Required Evidence
- complete diff, literal outputs, exit codes

---

## Iteration 10 — Independent Verification (round 4, FINAL)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: same final combined gate run as 087 Iteration 8, reporting the 089 subset incl. R5 landed and 34/34 deposit tests.

## Required Evidence
- literal outputs, counts, exit codes, T1-T10 verdicts, report file verification-4.md

---

## Joint commit & release with 087 — see tasks/087-tax-rule-data/DELEGATION.md Iteration 9 (explicit file list includes this task's files).
