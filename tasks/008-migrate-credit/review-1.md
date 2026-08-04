# Plan review — task 1.2 “Migrate credit module”

## Verdict

Not implementation-ready yet.

The production `cards.ts` decomposition is feasible, and the general migration scope is sound. However, the plan contains four material inaccuracies that should be corrected before implementation:

1. The existing `cards.test.ts` cannot truthfully be described as a mechanical six-way split matching all six production files. It contains tests for only three of the proposed seams, plus several intentional cross-seam integration tests.
2. The proposed reconciliation read/write boundary has more dependencies than the plan records. Implementing it as written requires newly exporting several current private helpers or choosing a different internal boundary.
3. The FK count is wrong: there are seven `accounts.id` FKs, not eight and not one per table.
4. The proposed `earnedRewardPoints` calculator is not itself an “earn-rate lookup,” and its rounding, sign, overflow, and lookup semantics are unspecified.

The owned enums are known now: `cardNetwork` and `bankAccountSubtype`. The implementation should not defer that check.

## 1. `cards.ts` production split

The claimed natural seams are real, and a six-file production split is reasonable:

- `cycle-math.ts`
- `cards.ts`
- `alerts.ts`
- `rewards.ts`
- `reconciliation-reads.ts`
- `reconciliation-writes.ts`

The source locations in the investigation are broadly accurate:

- Cycle math: lines 66–180, with `shiftDays` at 424–429.
- Card/issuer operations: lines 35–64, 182–422, and 437–514.
- Alerts: lines 516–573.
- Rewards: lines 577–585 and 748–776.
- Reconciliation: lines 587–746 and 778–1182.

The non-contiguous ranges matter: this is not six contiguous slices. It is an extraction by symbol and dependency.

### Missing cross-file dependencies

The plan’s proposed call graph is incomplete.

`reconciliation-writes.ts` needs all of the following from other proposed files:

- From `cards.ts`:
  - `ownedCardAccount`, for `recomputeReconciliation`
- From reconciliation shared/read code:
  - `dueDrift`
  - `toReconciliationDto`
  - `ledgerDuesAtDates`
  - `summarizeStatementLines`

Currently:

- `ownedCardAccount` is private.
- `toReconciliationDto` is private.
- `ledgerDuesAtDates` is private.
- `summarizeStatementLines` is already exported.

The plan mentions only `ownedCardAccount`, `dueDrift`, and `toReconciliationDto`; it omits `ledgerDuesAtDates` and `summarizeStatementLines`.

That does not make the split impossible, but P4 must explicitly define the internal API. The least disruptive six-file design is to export the necessary helpers from their owning files, marking non-route-facing helpers as internal in documentation. Adding another shared reconciliation file would be structurally cleaner in isolation, but would contradict the explicitly planned six-file result. Duplicating ownership or ledger-due logic would be worse.

The approximate size claims are plausible, but actual post-split counts will depend on duplicated/imported comments and formatting. The planned `wc -l` verification remains necessary.

## 2. `cards.test.ts` is not a clean six-way test split

There are 49 top-level test blocks in the current 1068-line file. They are not spread over the six production seams.

The existing coverage breaks down approximately as follows:

- Cycle math: 11 tests
- Reconciliation pure/read helpers: 12 tests
  - 6 `summarizeStatementLines` tests
  - 6 `dueDrift`/`driftPresentation` tests
- DB-backed reconciliation: 26 tests
  - 8 list/recompute tests
  - 18 absorb-carryover tests
- Card/issuer CRUD and holder/activity service behavior: no dedicated tests
- Alert evaluation: no tests
- Reward ledger: no existing tests

Therefore, mechanically creating six matching test files from the old file is not accurate. At most three non-empty characterization files naturally result:

- `cycle-math.test.ts`
- `reconciliation-reads.test.ts`
- `reconciliation-writes.test.ts`

`rewards.test.ts` becomes a fourth non-empty file only because this task adds new `earnedRewardPoints` tests. There is no existing material for `cards.test.ts` or `alerts.test.ts`.

The plan should not require empty test files merely to make the test filenames mirror production. It should instead require an explicit accounting of all 49 old test blocks across the three characterization files, plus the new reward tests.

### Cross-seam test cases

A whole test case never needs to be physically cut in half. Placement by the primary operation under test works, but several files will need cross-seam imports. This must be acknowledged instead of claiming a clean one-file-per-seam correspondence.

Spot-check of more than ten individual blocks:

| Test block | Natural owner | Cross-seam behavior |
|---|---|---|
| `cardCycle: a cycle starts...` | `cycle-math.test.ts` | None |
| `isBilledIn: ... first day...` | `cycle-math.test.ts` | Uses `cardCycle` in the same seam |
| `cardCycle: consecutive cycles...` | `cycle-math.test.ts` | None |
| `lastOccurrence / nextOccurrence...` | `cycle-math.test.ts` | None |
| `activityWindow: ... first billed day` | `cycle-math.test.ts` | Uses `cardCycle`, same seam |
| `splitByCycle: every row bills exactly once...` | `cycle-math.test.ts` | Uses `cardCycle`, same seam |
| `summarizeStatementLines: ... live ledger transaction...` | `reconciliation-reads.test.ts` | None |
| `dueDrift: totalDue − ledgerDue...` | `reconciliation-reads.test.ts` | None |
| `driftPresentation: negative ledger due...` | `reconciliation-reads.test.ts` | None |
| `listReconciliations/recomputeReconciliation: Diners-shaped...` | Crosses read and write seams | Must remain one block; best owned by `reconciliation-writes.test.ts` because it verifies recompute parity |
| `listReconciliations/recomputeReconciliation: a soft-deleted transaction...` | Crosses read and write seams | Same treatment |
| `listReconciliations: boundary — close−1...` | `reconciliation-reads.test.ts` | None |
| `recomputeReconciliation: ... overflow...` | `reconciliation-writes.test.ts` | Calls the write API, whose implementation uses read helpers |
| `absorbCarryover: Diners numbers...` | `reconciliation-writes.test.ts` | Also calls `getCardActivity` from the card/activity seam; must retain that import |
| `absorbCarryover: absorbing one reconciliation shifts every other row's drift...` | `reconciliation-writes.test.ts` | Also calls `listReconciliations` from the read seam |
| `absorbCarryover: listAccounts reflects...` | `reconciliation-writes.test.ts` | Also calls a ledger-module read API |
| `absorbCarryover: ... net-worth snapshot repair...` | `reconciliation-writes.test.ts` | Verifies a still-flat net-worth integration |
| Both SSI/retry tests | `reconciliation-writes.test.ts` | Depend on `AbsorbCarryoverHooks` and shared DB fixtures |

A zero-assertion-change relocation remains achievable. A zero-cross-import or six-non-empty-file split does not.

### Shared fixture issue

All DB-backed tests currently share one pool, database handle, lifecycle hook, and fixture/helper section. Splitting read and write tests requires either:

- mechanically duplicating the harness and helpers into both files, or
- extracting a test helper module.

Extracting helpers is cleaner, but it is more than moving test cases and import paths. Duplicating them is mechanical but increases code and maintenance. The plan should choose one explicitly and state that no assertions or test bodies change.

Also update comments that name `cards.ts` or cite its old line numbers. “Unmodified beyond import paths” would otherwise leave misleading documentation, particularly in `card-due-tasks.ts` and tests.

## 3. `emis.ts`

The decision not to split `emis.ts` is reasonable.

Direct inspection shows four internal sections:

- date and amortization helpers
- the shared account-locking/validation machinery
- EMI create/delete/update operations
- EMI summary/installment reads

Although this could theoretically become a math file plus a persistence file, the pieces are tightly connected:

- `createEmi` uses `standardEmiPaise`, `addMonths`, and `lockAccountPair`.
- `listEmis` uses `monthsSince`, `amortize`, and `addMonths`.
- `listEmiInstallments` uses `splitInstallments`.
- Ledger recurring materialization intentionally shares `lockAccountPair` and `stepAmortization`.

At 493 lines it is close to 500, but the size requirement specifically concerns decomposing `cards.ts`. Moving it will change import paths and may move it slightly above 500 through formatting, but that is not a reason to introduce an additional task-specific decomposition. The plan should avoid presenting 500 as a universal hard ceiling for every credit service.

The reverse-direction imports are confirmed:

- `modules/ledger/services/recurring.ts` imports `lockAccountPair` and `stepAmortization`.
- `modules/ledger/services/recurring.test.ts` imports `createEmi`, `listEmiInstallments`, and `upsertEmiDetails`.

Both imports must be repointed.

## 4. `card-due-tasks.ts` and `card-statements.ts` scope

### `card-statements.ts`

Including it is correct and necessary.

It owns all service behavior for the in-scope `card_statements` table and is consumed only by the cards route. Leaving it flat would split one route’s card-statement surface away from the rest of its domain for no benefit.

The move retains ledger dependencies on attachment validation and size policy. Those imports must be depth-adjusted, but they do not make the file ledger-owned.

A pre-existing reliability issue remains: `saveCardStatement` stores the object before inserting the database row, so a failed insert can orphan storage. That is not introduced by this migration and does not need to be fixed here, but it should remain outside the refactor rather than being accidentally changed.

### `card-due-tasks.ts`

Including it is also a sound scope decision.

Its behavior is credit-specific:

- It enumerates configured cards.
- It consumes `listCardHolders`.
- It uses card due dates, amounts, and issuer reminder settings.
- It runs alongside card reminder evaluation in the `cards.remind` scheduled handler.
- It also runs during boot catch-up.

Writing `user_tasks` does not make it ledger-owned; it is a credit-domain producer writing through a transitional direct table dependency. Keeping it with credit is consistent with the classification already made during task 1.1.

The plan should expand AC5 and the direct wiring check. The current AC wording focuses on `evaluateCardDueReminders` and `evaluateCardUtilization`, but moving `card-due-tasks.ts` also requires proving that both `materializeCardDueTasks` call sites remain wired:

- the `cards.remind` system worker
- the boot catch-up path

The full test suite alone is weak evidence for job wiring. A source-level import/call inventory or an existing jobs test should cover all three functions and both materialization call sites.

The comments in `card-due-tasks.ts` refer to `cards.ts` line numbers that will cease to be meaningful after the split. Those should be updated without changing behavior.

## 5. FK inventory and enums

### Correct outbound FK inventory

The plan’s account-FK count is incorrect.

There are seven columns referencing `accounts.id`, not eight:

- `card_details.account_id`
- `card_statements.account_id`
- `reward_entries.account_id`
- `statement_reconciliations.account_id`
- `emi_details.loan_account_id`
- `bank_details.account_id`
- `overdraft_details.account_id`

`card_issuer_settings` has no `account_id`; it is keyed by `(user_id, institution)`. Therefore, “one per table” is false.

The remaining counts are correct:

- 1 FK to `recurring_templates.id`
  - `emi_details.template_id`
- 8 FKs to `users.id`
  - one for each table
- 2 FKs to `email_ingestions.id`
  - `reward_entries.ingestion_id`
  - `statement_reconciliations.ingestion_id`

The reverse inventory is correct:

- `transactions.reconciled_statement_id → statement_reconciliations.id`
- `onDelete: set null`

No other outside table references one of the eight credit tables.

The direct cross-module table access is also correctly identified:

- Reconciliation recomputation reads `extractedTransactions` directly.
- Several credit services read ledger-owned tables directly.
- `card-due-tasks.ts` writes `userTasks` and `alertLedger` directly.

### Owned enums

The “verify at implementation time” item can be resolved now. The thin credit schema should re-export two enums in addition to the eight tables:

- `cardNetwork`, used by `card_details.network`
- `bankAccountSubtype`, used by `bank_details.subtype`

No enum is used by the other six tables.

The plan, schema smoke test, and acceptance criteria should name these two bindings explicitly.

## 6. Reward earn-rate interface

The present design guidance is underspecified and does not fully satisfy the roadmap wording.

### What the schema actually supports

The only current base earn-rate field is:

- `card_details.earn_rate_per_100`
- integer
- non-null
- default `0`
- documented as reward points per ₹100 spent

`reward_entries` is a point-movement ledger. It does not define a rate.

`card_issuer_settings` contains limit, utilization threshold, reminder lead time, and mobile number. It does not define a reward rate.

The plan is therefore correct not to invent a rate from `reward_entries` or `card_issuer_settings`.

It is also correct that current data cannot support truthful future “best card” recommendations. Task 10.5 explicitly plans product-level reward rules, point valuation, exclusions, accelerated caps, milestones, and expiry. A base-rate helper introduced here must be described as a narrow estimate based solely on the legacy flat rate, not as a complete reward model.

### Calculator versus lookup

A function such as:

```ts
earnedRewardPoints(spendPaise, earnRatePer100)
```

is a calculator, not a lookup. It does not retrieve a card’s configured rate and does not enforce card ownership.

The acceptance criterion says “Reward earn-rate lookup exposed as a documented interface.” A more faithful interface would separate retrieval from arithmetic:

```ts
getCardEarnRate(db, userId, accountId): Promise<number | null>
earnedRewardPoints(spendPaise, earnRatePer100): number
```

Possible semantics:

- `getCardEarnRate` verifies that the account belongs to the user and is a credit card.
- It returns the configured integer rate, or `null` when there is no `card_details` row.
- A stored `0` remains distinguishable from no details if that distinction is useful.
- `earnedRewardPoints` is pure and operates only on already validated integer inputs.

Alternatively, one documented object-valued lookup could return:

```ts
interface CardEarnRate {
  accountId: string;
  pointsPer100Rupees: number;
}
```

That is more extensible than returning an unlabelled number and avoids confusing the rate with points, percentages, or basis points.

### Required arithmetic semantics

The formula implied by the schema is:

```text
points = spendPaise × earnRatePer100 ÷ 10_000
```

because ₹100 is 10,000 paise.

The plan must decide and document how fractional points are handled. This is not a minor test detail:

- `Math.floor` models points awarded only for complete earn units.
- `Math.round` can award a point before a full threshold is reached.
- Returning a fractional number conflicts with `reward_entries.points`, which is an integer.

Given the current integer ledger, flooring non-negative calculated points is the least surprising generic rule, but the schema comment does not prove actual issuer behavior. The function must identify this as a simplified base-rate estimate.

Tests should cover at least:

- zero spend
- zero rate
- exactly ₹100
- below ₹100
- multiple complete ₹100 units
- a remainder above complete units
- invalid negative spend
- negative rate
- non-integer inputs
- unsafe-integer multiplication or result overflow

The API’s transaction convention also needs attention: card purchases are stored as negative `amountPaise`, while the proposed parameter is described as a positive “spend amount.” Do not silently call `Math.abs`, because a refund or positive ledger entry could then be treated as spend. Name the parameter `spendPaise`, require a non-negative magnitude, and reject invalid signs.

`packages/shared/src/money.ts` establishes the relevant conventions:

- money is integer paise
- rounding behavior is explicit in documentation
- shared pure financial calculations document their units

The new function should follow those conventions. If it is intended for later reuse by multiple workspaces, `packages/shared` may eventually be the more natural home for the pure arithmetic. For task 1.2, keeping it in `modules/credit/services/rewards.ts` is acceptable because the requested interface is currently API/domain-owned and there is no present cross-workspace consumer.

A production doc comment should document semantics and model limitations. Referring directly to a task filename in production code is less durable; a concise limitation such as “base flat rate only; does not model category rules, caps, or point value” is more useful. The task evidence can separately cite the 10.5/10.6 discrepancy.

## 7. Additional task-specific risks and missing checks

### New internal exports

The plan must state which helpers become cross-file exports. Otherwise the implementer will discover mid-split that the proposed read/write boundary does not compile.

At minimum:

- `ownedCardAccount`
- `toReconciliationDto`
- `ledgerDuesAtDates`

These should not be confused with public HTTP or package API commitments merely because TypeScript requires an export between files.

### Job-wiring evidence

AC5 incorrectly groups all behavior under “alerts worker”:

- `evaluateCardUtilization` runs in `alertsWorker`.
- `evaluateCardDueReminders` runs in the `system` worker’s `cards.remind` handler.
- `materializeCardDueTasks` runs in that same system job and again during boot.

The acceptance criterion should name the correct execution paths.

### New reward tests and test-count accounting

The existing file has 49 test blocks. The post-split accounting should require:

```text
relocated characterization test blocks = 49
total after adding reward tests > 49
```

It should not require six relocated test files to each contain tests. Test count equality alone is insufficient if test cases are accidentally duplicated, so the evidence should map all old test names to new files or compare a normalized list of test names.

### Pre-existing coverage gaps relevant to the move

Preserving existing gaps is acceptable for a pure move, but two new structural risks deserve narrow checks:

- The cards route will import from several new service files. Typecheck proves symbol resolution, while the existing route-surface gate proves registration. That is sufficient without adding handler tests.
- `jobs/index.ts` changes imports to both `alerts.ts` and `card-due-tasks.ts`. The plan should explicitly verify both target paths and every call site because route snapshots do not cover workers.

### Import comments and source references

Several comments hard-code old locations or line references:

- `card-due-tasks.ts` cites `cards.ts:526-530` and `cards.ts:525`.
- `cards.test.ts` names `cards.ts` in the database error and generation-lag comments.
- Ledger recurring comments refer generically to `services/emis.ts`.

The move should update these references. This does not violate the prohibition on assertion changes.

### Scope wording

The objective says “5 tables’ worth of services” while the task explicitly owns eight tables and moves five already-separate supporting service files in addition to the six-way cards split. That phrase is confusing and should be corrected.

## Required plan changes before implementation

1. Replace the claimed six-way mechanical test split with an explicit 49-test accounting:
   - 11 cycle tests
   - reconciliation read/pure and DB read tests
   - reconciliation write/integration tests
   - no pre-existing card CRUD, alert, or reward tests
2. State how shared DB test fixtures are handled after splitting read/write tests.
3. Record that some integration tests import across the new seams and remain whole with zero assertion changes.
4. Add `ledgerDuesAtDates` and `summarizeStatementLines` to the reconciliation dependency graph, and explicitly define the internal exports required by the split.
5. Correct the FK inventory from eight to seven `accounts.id` references.
6. Name `cardNetwork` and `bankAccountSubtype` as the two owned enums now.
7. Redesign the reward interface as a real owned lookup plus a pure calculator, or change the acceptance-criterion wording if only a calculator is intended.
8. Specify reward arithmetic units, flooring/rounding, sign handling, validation, and safe-integer behavior.
9. Expand job-wiring verification to distinguish the system worker, alerts worker, and boot catch-up call sites.
10. Update stale source/line references while preserving all test assertions and service behavior.

Once those corrections are incorporated, the plan should be implementation-ready.