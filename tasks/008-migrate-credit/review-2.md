# Follow-up plan review — revision 2

## Verdict

Not implementation-ready yet.

Of the 10 required changes from `review-1.md`:

- 8 are resolved.
- 1 is partially resolved because the required exports are correctly specified later but contradicted by the split table.
- 1 is partially resolved because safe-integer behavior remains unspecified.

The 49-test accounting matches the current `apps/api/src/services/cards.test.ts`, and the full-DB-harness placement in `reconciliation-writes.test.ts` is structurally sound.

## 1. Explicit 49-test accounting

**Status: resolved**

The plan replaces the former six-way mechanical test split with an explicit three-file accounting:

> “Direct review of all 49 top-level test blocks found they concentrate in only 3 of the 6 production seams:”  
> — `TASK.md:58`

> “`cycle-math.test.ts` — 11 tests”  
> — `TASK.md:60`

> “`reconciliation-reads.test.ts` — 12 tests”  
> — `TASK.md:61`

> “`reconciliation-writes.test.ts` — 26 tests”  
> — `TASK.md:62`

The arithmetic is correct: 11 + 12 + 26 = 49.

The current `cards.test.ts` confirms this breakdown:

- 11 cycle-math tests: 7 tests from `cardCycle` through `lastOccurrence`/`nextOccurrence`, plus 2 `activityWindow` and 2 `splitByCycle` tests.
- 12 reconciliation-read tests: 6 `summarizeStatementLines` and 6 `dueDrift`/`driftPresentation`.
- 26 DB-backed tests: 8 list/recompute tests and 18 `absorbCarryover` tests.

The missing coverage is also stated explicitly:

> “No pre-existing tests exist for card/issuer CRUD, alert evaluation, or the reward ledger”  
> — `TASK.md:63`

> “No `cards.test.ts` or `alerts.test.ts` test file is created — no pre-existing test case belongs in either”  
> — `TASK.md:109`

This genuinely resolves item 1.

## 2. Shared DB fixtures after splitting tests

**Status: resolved**

The plan makes an explicit fixture decision:

> “`reconciliation-reads.test.ts` — 12 tests, all pure functions, no DB needed”  
> — `TASK.md:61`

> “`reconciliation-writes.test.ts` — 26 tests, DB-backed … inherits the entire DB test harness (pool setup, fixtures, teardown hooks) from the original `cards.test.ts`, since it is the only new file that needs one (moved, not duplicated).”  
> — `TASK.md:62`

This is consistent with the current file. All 23 pure tests occur before the DB section. The shared DB setup begins later with:

- `requireDatabaseUrl`
- `pool`
- `db`
- the `after` teardown hook
- fixture helpers such as `createUser`, `createCardAccount`, `createTxn`, `createIngestion`, `createReconciliation`, and `cleanupUser`

All 26 tests following that harness are the tests assigned to `reconciliation-writes.test.ts`. Therefore, moving the entire harness into that one file is coherent; no duplication or shared helper extraction is required.

## 3. Cross-seam integration tests remain whole

**Status: resolved**

The objective establishes the overall rule:

> “cross-seam integration tests kept whole with cross-file imports rather than cut”  
> — `TASK.md:22`

The detailed test plan makes it explicit:

> “several of the 26 `reconciliation-writes.test.ts` tests call functions from other seams as part of verifying integration behavior”  
> — `TASK.md:66`

> “These test cases are not split across files — each stays as one complete test block in the file matching its primary write-side seam, importing whatever sibling functions it needs.”  
> — `TASK.md:66`

It also preserves assertions:

> “Every relocated test's assertions are byte-for-byte unchanged”  
> — `TASK.md:68`

This resolves item 3.

## 4. Reconciliation dependency graph and internal exports

**Status: partially resolved**

The detailed dependency section correctly names all required dependencies:

> “`reconciliation-writes.ts` needs … `ownedCardAccount` … `toReconciliationDto` … `ledgerDuesAtDates` … `dueDrift` and `summarizeStatementLines`”  
> — `TASK.md:51`

The call graph repeats the complete set:

> “`reconciliation-writes.ts` calls `ownedCardAccount` … and `dueDrift`/`toReconciliationDto`/`ledgerDuesAtDates`/`summarizeStatementLines`”  
> — `TASK.md:53`

It also correctly identifies the three presently private helpers that must become exports:

> “These three newly-exported functions (`ownedCardAccount`, `toReconciliationDto`, `ledgerDuesAtDates`) are internal cross-module-file exports required by the split”  
> — `TASK.md:51`

P4 repeats that implementation requirement:

> “exporting the 3 newly-required cross-file functions (`ownedCardAccount`, `toReconciliationDto`, `ledgerDuesAtDates`) that are private today”  
> — `TASK.md:131`

However, the split table contradicts this by still classifying `ownedCardAccount` as private:

> “`cards.ts` … (+ private `toDetails`, `toIssuerSettings`, `issuerKey`, `ownedCardAccount`, `utilization`)”  
> — `TASK.md:45`

That contradiction matters because this table purports to define the resulting file’s exports. `ownedCardAccount` cannot simultaneously remain private and be imported by `reconciliation-writes.ts`.

Required correction: remove `ownedCardAccount` from the table’s private-helper parenthetical and list it as an internal exported function. The rest of item 4 is resolved.

## 5. Seven `accounts.id` foreign keys

**Status: resolved**

The revision summary states:

> “FK count corrected: 7 `accounts.id` references, not 8 — `card_issuer_settings` has no `account_id`”  
> — `TASK.md:14`

The full inventory names all seven:

> “7 columns → `accounts.id` … `card_details.account_id`, `card_statements.account_id`, `reward_entries.account_id`, `statement_reconciliations.account_id`, `emi_details.loan_account_id`, `bank_details.account_id`, `overdraft_details.account_id`”  
> — `TASK.md:88`

It also explains the missing eighth reference:

> “`card_issuer_settings` has no `account_id` column at all; it is keyed by the composite `(user_id, institution)`”  
> — `TASK.md:88`

This resolves item 5.

## 6. Name the two owned enums

**Status: resolved**

The two enums are named explicitly in both the revision summary and implementation scope:

> “`cardNetwork` (`card_details.network`), `bankAccountSubtype` (`bank_details.subtype`)”  
> — `TASK.md:15`

> “8 tables + exactly 2 owned enums … `cardNetwork` … and `bankAccountSubtype`”  
> — `TASK.md:102`

P3 also requires the schema to contain the named pair:

> “Create `apps/api/src/modules/credit/schema.ts` (8 tables + the 2 named enums, re-verified against the current file)”  
> — `TASK.md:130`

The implementation-time check is framed as drift detection, not deferral of the decision. This resolves item 6.

## 7. Real lookup plus pure reward calculator

**Status: resolved**

The plan explicitly acknowledges and repairs the original lookup/calculator mismatch:

> “Revision 1's single `earnedRewardPoints(spendPaise, earnRatePer100)` function was a calculator, not a ‘lookup’”  
> — `TASK.md:77`

It defines a DB-backed owned lookup:

> “`getCardEarnRate(db, userId, accountId): Promise<number | null>` — the lookup half: verifies the account belongs to the user … and is a credit card, and returns the configured `earn_rate_per_100` integer”  
> — `TASK.md:78`

It separately defines the pure calculator:

> “`earnedRewardPoints(spendPaise: number, earnRatePer100: number): number` — the pure calculator half”  
> — `TASK.md:79`

AC6 requires both:

> “`getCardEarnRate` and `earnedRewardPoints` exist in `rewards.ts`”  
> — `TASK.md:149`

There is one minor stale omission in the split table:

> “`rewards.ts` … plus a new `earnedRewardPoints(...)`”  
> — `TASK.md:47`

That row should ideally list `getCardEarnRate` too, but unlike the `ownedCardAccount` contradiction, it does not classify the lookup as private or exclude it. The detailed design, P5, scope list, and AC6 consistently require both functions, so the substantive requirement is resolved.

## 8. Reward arithmetic and safe-integer behavior

**Status: partially resolved**

The plan now specifies units and flooring:

> “`points = Math.floor(spendPaise * earnRatePer100 / 10_000)` (₹100 = 10,000 paise)”  
> — `TASK.md:79`

It specifies sign handling and input validation:

> “Must reject (throw, not silently coerce) negative `spendPaise`, negative `earnRatePer100`, and non-integer inputs”  
> — `TASK.md:79`

It explains the signed-ledger boundary:

> “ledger `transactions.amountPaise` stores spend as negative and a caller must pass the non-negative magnitude explicitly”  
> — `TASK.md:79`

It also requires relevant ordinary arithmetic tests:

> “zero spend, zero rate, exactly ₹100, spend below ₹100, multiple complete ₹100 units, a remainder above a complete unit, rejection of negative spend, rejection of negative rate, rejection of non-integer inputs”  
> — `TASK.md:81`

However, safe-integer behavior is not actually defined. The plan says:

> “a realistic large-spend sanity case (no literal integer-overflow test required, but confirm the multiplication stays within `Number.isSafeInteger` bounds for realistic card-spend magnitudes)”  
> — `TASK.md:81`

This only tests one realistic value that happens to remain safe. It does not define what the function must do when:

- either argument is an integer but not a safe integer;
- `spendPaise * earnRatePer100` is not a safe integer;
- the resulting points value is not a safe integer.

The phrase “already-validated integer inputs” at line 79 does not solve this because `Number.isInteger` and `Number.isSafeInteger` are different guarantees. JavaScript can report an unsafe numeric value as an integer.

Required correction: specify and test deterministic unsafe-number behavior, preferably rejection when either input or the intermediate product is not a safe integer. If a different arithmetic strategy is intended to avoid unsafe intermediate multiplication, that algorithm and its output-safety rule must be stated instead.

## 9. Three distinct job-wiring locations

**Status: resolved**

AC5 clearly distinguishes the three execution contexts:

> “`evaluateCardDueReminders` … in the `system` worker's `"cards.remind"` scheduled handler”  
> — `TASK.md:148`

> “`materializeCardDueTasks` … in that same `"cards.remind"` handler and again in the boot catch-up path”  
> — `TASK.md:148`

> “`evaluateCardUtilization` … in the per-user `alertsWorker`”  
> — `TASK.md:148`

It also requires direct call-site verification:

> “Proven by a direct read of `jobs/index.ts`'s post-move import lines and all of its call sites”  
> — `TASK.md:148`

This correctly separates the system worker, alerts worker, and boot catch-up path rather than treating them as one alerts-worker location. Item 9 is resolved.

## 10. Stale source and line references

**Status: resolved**

The plan names all three requested categories:

> “`card-due-tasks.ts` has a doc comment citing `cards.ts:526-530`/`cards.ts:525` by line number … must be updated to name the new file/function”  
> — `TASK.md:72`

> “`cards.test.ts`'s own comments naming `cards.ts` directly … need the same treatment when relocated”  
> — `TASK.md:72`

> “The ledger module's `recurring.ts`/`recurring.test.ts` comments that generically reference `services/emis.ts` should be updated to the new path.”  
> — `TASK.md:72`

The preservation constraint is also explicit:

> “Every relocated test's assertions are byte-for-byte unchanged”  
> — `TASK.md:68`

P4 and the ledger-file scope repeat these requirements:

> “stale file/line-reference comments updated”  
> — `TASK.md:131`

> “plus any comment generically referencing `services/emis.ts` updated to the new path”  
> — `TASK.md:114`

This resolves item 10.

## Required plan changes before implementation

Two corrections remain:

1. Fix the split-table contradiction at `TASK.md:45`. `ownedCardAccount` must be listed as an internal export, not as a private helper. For completeness, the `rewards.ts` row at line 47 should also list `getCardEarnRate`.

2. Define safe-integer behavior for `earnedRewardPoints` and require boundary tests. The plan must say what happens when inputs or arithmetic exceed safe-integer bounds; a single realistic large-value sanity case is not sufficient.

Once those two points are corrected, all 10 requirements from `review-1.md` will be genuinely resolved and the plan will be implementation-ready.