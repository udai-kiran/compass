## Verdict

The core patch is correct and narrowly scoped: remove the duplicate at `origin/main:308-364` and change the surviving component’s total-opening reference to `openingTransactionPaise`. This fixes the compile failure and the normal EPF round-trip path.

However, TASK.md overstates “exactly three reads,” “sufficient,” and “introduces no regression” without component-level or DB-backed tests.

## Claim-by-claim review

1. **Verified.** `origin/main` has one call at [`AccountDetailPage.tsx` line 110](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:110) and two top-level declarations at lines [308](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:308) and [439](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:439).

2. **Verified.** The block at lines [308-364](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:308) is the single-field implementation from `0da6688`: it has no retirement query or `epsText`. The later block is the EPS-aware implementation from `f19b152`, using `useRetirementDetails` and `epsText` at lines [441-447](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:441).

3. **Substantively verified, but the count is misstated.** The survivor has four textual reads of `account.openingBalancePaise`, not three:

   - initializer: line [445](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:445)
   - effect body: line [452](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:452)
   - dependency array: line [453](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:453)
   - dirty comparison: line [502](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:502)

   It contains no `openingTransactionPaise`. The plan correctly identifies the three semantic locations, but P3’s wording “replace the three reads” is inaccurate.

4. **Verified with a qualification.** All supported writes pin `accounts.opening_balance_paise` to zero because `carriesOpeningAsTransaction` always returns true at [`accounts.ts` lines 19-24](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:19), creation writes zero at line [245](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:245), and updates use the same invariant at lines [475-486](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:475). Startup rejects databases containing nonzero values at [`reconcile-postings.ts` lines 128-150](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:128).

   “Always 0 at runtime” should therefore mean “in a successfully started, invariant-conforming application.” Raw test setup, direct SQL, or code running before the boot gate can still create nonzero values.

5. **Verified.** `listAccounts` aggregates non-deleted opening postings at [`accounts.ts` line 200](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:200), converts and safe-integer-checks the result at lines [219-222](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:219), and returns it as `openingTransactionPaise` at line [226](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:226).

   One relevant edge case remains: the aggregate sums every active opening transaction, while `updateAccount` only selects and updates the earliest one at [`accounts.ts` lines 441-457](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:441). With duplicate opening rows, the UI cannot round-trip cleanly. TASK.md explicitly defers that invariant to task 040, so it is not hidden scope, but claim 5 is only true under that invariant.

6. **Mostly verified, but too absolute.** The edit is sufficient for AC1, AC5, and AC6 by inspection, and should restore typechecking by eliminating TS2393. It cannot by itself guarantee AC2-AC4, CI, release publication, or “no regression”; those require execution and tests. There is no direct automated coverage of the component’s combined total/EPS state machine.

## Deletion fallout and unused symbols

Deleting lines 308-364 does not leave anything unused:

- `openingBalanceToInput` remains used by `OpeningBalanceSection` at lines [367 and 371](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:367), and by the survivor after the planned edit.
- `openingBalanceFromInput` remains used at lines [373](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:373) and [467](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:467).
- `editsOpeningBalanceAsAmount` remains used at line [388](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:388).
- `DerivedRow` remains used by `OpeningBalanceSection`, the surviving EPF component, and overdraft UI; its declaration is at line [849](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:849).
- `formatINR`, `isLiabilityAccount`, `useEffect`, `useState`, `useRetirementDetails`, and `useRetirementDetailsMutation` all retain other uses.
- No import or helper should become lint-unused.

Nothing else in the file depends on the deleted component’s local `text`, `parsed`, `error`, or `submit`.

## Dirty-state and save analysis

The EPS-aware dirty formula remains logically correct after changing line 502 to compare against `openingTransactionPaise`:

- While retirement data is loading, `retData === undefined`, so `retResolved` is false at lines [497-503](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:497). Dirty is intentionally false and Save disabled. The loading early return at lines [543-549](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:543) prevents interaction.
- A stored opening amount of zero is rendered as an empty string because [`opening-balance.ts` lines 8-11](/home/udai/common/compass/apps/web/src/routes/settings/opening-balance.ts:8) maps zero to `""`. Parsing blank returns zero at lines [19-22](/home/udai/common/compass/apps/web/src/routes/settings/opening-balance.ts:19), so dirty is correctly false.
- Clearing a nonzero stored total parses as zero, which differs from `openingTransactionPaise`; dirty correctly becomes true and saving deletes the opening row through the backend plan.
- The liability sign path is not applicable to this component because it is rendered only for `account.type === "epf"` at lines [109-113](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:109), and EPF is not a liability. The shared helper’s liability behavior remains unchanged and is tested separately.
- EPS blank maps to zero at lines [469-478](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:469). A missing retirement row resolves as `null`, and comparison against `retData?.epsBalancePaise ?? 0` correctly treats blank/zero as clean.
- Invalid totals, invalid EPS values, and EPS exceeding total force `hasError`, making dirty false and disabling Save. That is intentional validation, not a stuck-false condition.

The two-step update-then-retirement save remains functionally correct:

1. account opening transaction is updated at lines [511-514](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:511);
2. EPS is then saved at lines [515-531](origin/main:apps/web/src/routes/settings/AccountDetailPage.tsx:515);
3. account mutation invalidates both account and retirement caches at [`queries.ts` lines 68-78](origin/main:apps/web/src/lib/queries.ts:68);
4. retirement mutation invalidates its cache again at [`account-detail-queries.ts` lines 50-56](origin/main:apps/web/src/lib/account-detail-queries.ts:50).

If EPS saving fails after the total succeeds, the total becomes clean after account refetch while EPS remains dirty, allowing retry. That behavior is correct, though non-atomic.

Dirty can remain true after a successful save if the subsequent query invalidation/refetch fails, because neither mutation directly updates the query cache. It should not become permanently false for an actual unsaved valid difference. A transient stale dirty state can also exist between mutation completion and refetch. These are existing query/error-handling limitations, not regressions introduced by the proposed field change.

## Risks and missing scope

- No new security or authorization risk: the patch only changes which already-validated response property seeds client state. Backend ownership checks and mutation routes are unchanged.
- No schema compatibility issue: `openingTransactionPaise` is required by `AccountWithBalanceSchema` at [`ledger.ts` lines 200-205](/home/udai/common/compass/packages/shared/src/schemas/ledger.ts:200).
- The two-step save is non-transactional. A successful total update followed by a failed EPS update leaves partial state. The component explicitly reports this and supports retry, so it need not block this repair.
- Inputs remain enabled while saving. A refetch can overwrite text typed during the save. This is pre-existing behavior and outside the proposed change.
- Multiple active opening rows prevent reliable round-trip because listing sums them while updating changes only one. The task acknowledges and defers this.
- `openingTxnPaise` includes future-dated opening transactions, unlike current `balancePaise`. That is appropriate for an opening-value editor, but should be captured in tests.

## Missing tests

Deferring all relevant tests is the weakest part of the plan. At minimum, this task should add coverage for:

- an EPF account with nonzero `openingTransactionPaise` and zero `openingBalancePaise` seeds the total field correctly;
- Save starts disabled when total and EPS match stored data;
- changing and clearing total toggles dirty correctly;
- loading, missing retirement details, and stored EPS zero;
- EPS greater than total blocks saving;
- successful total save followed by EPS save;
- EPS failure leaves the form retryable;
- a DB-backed `listAccounts` test proving an EPF opening posting becomes `openingTransactionPaise`;
- ideally a regression check that the module contains only one `EpfOpeningSection`, although typecheck already detects the current duplication.

The existing opening-balance tests cover parsing and liability signs, not this React component or the combined total/EPS workflow.

## Complexity and conventions

The implementation plan itself is appropriately small. P1 and the CI/release steps are operational workflow rather than source complexity. AC7 and AC8 are reasonable release gates, but they should not be presented as consequences guaranteed by the two-line semantic fix.

No clear repository convention is violated by the proposed edit. The larger convention concern is declaring a release-critical UI regression fixed while explicitly deferring all regression coverage. This repository already uses `node:test`, and the API has DB-backed service tests, so at least the API round-trip test belongs naturally in this task.

## Recommended changes to the plan

I would:

1. Keep the deletion and property replacements exactly as proposed.
2. Change “three reads” to “four occurrences across three semantic locations.”
3. Qualify “always 0 at runtime” as applying to invariant-conforming databases after the boot gate.
4. Replace “introduces no regression” with a testable statement about unchanged EPS behavior.
5. Add at least one DB-backed `listAccounts` EPF test and one component/state regression test rather than deferring both.
6. Explicitly document the duplicate-opening-row precondition in the round-trip claim.
7. Verify the final diff contains exactly the deletion plus four property-token replacements; the effect dependency is a separate occurrence that is easy to miss.