## Review outcome

The production premises are confirmed:

- `carriesOpeningAsTransaction()` unconditionally returns `true` ([accounts.ts:18](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:18)).
- `createAccount()` pins the column to zero, inserts an `is_opening` transaction, and calls `postTransaction(buildOpeningPostings(...))` ([accounts.ts:225](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:225)).
- `assertNoLegacyShapes()` rejects any nonzero `accounts.opening_balance_paise` and any `transfer_links` rows ([reconcile-postings.ts:128](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:128)).
- `linkTransfer()` hard-deletes the absorbed header and writes two real postings to the survivor ([transfers.ts:170](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:170)).
- There is no production insert into `transfer_links` anywhere under `apps/api/src`; the only production reference is the obsolete read in `imports.ts`.

The test-fix direction is broadly correct, but W2, W3, and parts of W4/W5 are not sufficiently specified. W3 contains a blocking conceptual problem: several tests cannot be repaired by merely changing row/link assertions because their reconstruction scenario assumes two independently surviving transaction headers.

## 1. Reconciliation writes — W2/B1

**Finding: IMPORTANT — correct direction, incomplete plan.**

The local helper is definitely stale:

> `.values({ userId, name: "Test card", type: "credit_card", openingBalancePaise })`

([reconciliation-writes.test.ts:52](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:52))

That bypasses the production invariant. The Diners test starts with `-2000000` through this helper ([reconciliation-writes.test.ts:104](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:104)), and both overflow tests do likewise at lines 220–252. Because their readers sum postings, fixing this shared fixture will address those failures.

The plan should specify the exact mechanism: call the real `createAccount(db, userId, {...})`, including the complete required `CreateAccount` fields, and return `account.id`. That is safer than “or an equivalent `postTransaction` call.” Production does several coordinated things:

> `{ ...(seedOpening ? { openingBalancePaise: 0 } : {}) }`  
> `openingBalanceRow(...)`  
> `postTransaction(... buildOpeningPostings(...))`

([accounts.ts:233](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:233))

Allowing an implementer to reproduce only part of that sequence risks inconsistent dates, headers, or system-account setup. The real service is available and should be reused.

The six column assertions are stale, but “posting-based balance” is too broad. Each test should assert its actual contract:

- Where the intended result is the new opening adjustment, directly select the surviving `is_opening` transaction and its real-account posting, assert exactly one such row, the expected amount, and `accounts.opening_balance_paise === 0`.
- In the `listAccounts` test, replace `found.openingBalancePaise` at line 573 with `found.balancePaise`, because that test explicitly claims the account-list balance changed.
- `getCardActivity().totalDuePaise` is appropriate only where total due is the tested observable; it is not an exact substitute for proving the opening posting itself was updated.

There is also an omitted fixture problem. The concurrency test directly performs:

> `.set({ openingBalancePaise: -50000 })`

([reconciliation-writes.test.ts:627](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:627))

Its commentary and expected arithmetic at lines 651–657 still assume the column is authoritative. A later SSI test likewise describes “B’s overwritten −150000” and asserts the old column at line 748. Replacing only the final assertions does not repair these scenarios. They must mutate the opening transaction/postings through `updateAccount` or the same production opening-balance path, then calculate the serial-order expectation from that posted state.

Therefore the stated “fixture plus six assertions” scope is incomplete. The implementer needs explicit instructions to remove all direct nonzero writes to `opening_balance_paise` in this file and update the concurrency narrative and expected balance arithmetic.

## 2. Inbox transfer reconstruction and acceptRepayment — W3

**Finding: BLOCKING — production direction is correct, but the proposed rewrite is materially underspecified.**

The acceptRepayment AC1 assertions encode the retired model:

> `assert.equal(rows.length, 2)`  
> `const outRow = rows.find((r) => r.accountId === fromAccountId)`  
> `const inRow = rows.find((r) => r.accountId === cardAccountId)`  
> `assert.equal(links.length, 1)`

([inbox.test.ts:1046](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:1046))

For the new model, AC1 should assert:

1. Exactly one non-deleted transaction header for the user.
2. The DTO and accepted draft both reference that survivor ID.
3. A direct postings query for that ID returns exactly two postings.
4. Both postings join to real accounts (`system_kind IS NULL`).
5. Their unordered tuples equal:
   - `[fromAccountId, -500000]`
   - `[cardAccountId, +500000]`
6. Their sum is zero.
7. No category-dimension/system posting exists.
8. `transfer_links` has zero rows, as an explicit retirement/invariant assertion.

That pattern is independent and non-tautological: it verifies conservation, account assignment, sign, cardinality, and absence of a counter posting rather than merely observing the current header count.

For reuse tests, additionally assert that the reused candidate ID is the survivor, its header metadata remains unchanged where promised, and its postings were transformed from ordinary shape into the exact two-real-leg transfer shape. Because `linkTransfer()` deliberately updates the survivor’s postings, wording such as “reused untouched” must be narrowed to “header fields remain unchanged”; the ledger shape is necessarily changed.

The SQL eligibility tests need similarly explicit before/after assertions:

- Excluded candidate remains an ordinary shape: one real posting plus an Expenses/Income counter.
- A distinct survivor is created for the repayment and has the exact two-real-posting shape.
- Included candidate becomes the survivor and gets the exact transfer shape.
- Already-linked exclusion should identify a transfer by postings shape, not by `transfer_links`.

There is a larger problem in the “transfer reconstruction” cases. The first test says:

> “Hard-deleting one leg … leaving the surviving leg unlinked”

([inbox.test.ts:762](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:762))

That state no longer exists. After merging, both accepted drafts may reference one survivor; there is no separate leg header to leave behind. Deleting that survivor can orphan both references, depending on reference remapping. Similarly, the “both legs hard-deleted” test calls hard deletion on two result IDs as if they remained independent ([inbox.test.ts:870](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:870)). Merely changing the final expected row count cannot preserve the original scenario.

The plan must first specify the intended reconstruction behavior under the collapsed model:

- Confirm which survivor ID `acceptTransferPair` returns for each draft.
- Assert how both draft references are remapped.
- Delete the single survivor once.
- Assert which drafts become orphans.
- Restore/reaccept the intended drafts and then verify the resulting survivor/postings.

Without that design, the implementer must invent business behavior. This is the highest-risk test rewrite and is not ready to delegate as currently written.

There is also a stale concurrency narrative:

> “`linkTransfer`’s insert — which blocks on A’s held row lock”

([inbox.test.ts:1260](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:1260))

There is no link insert. The test may still validly block on transaction-row locks, but the comments and final assertions at lines 1292–1299 must describe and verify one committed transfer survivor with two real postings and no B-created survivor.

## 3. Periods/planning transfer exclusions — W4

**Finding: IMPORTANT — correct direction, but “mirroring `hasCategoryDimension()` independently” needs a precise independent formula.**

`hasCategoryDimension()` is:

> `exists (...) ac.system_kind in ('expenses', 'income')`

([ledger-sql.ts:26](/home/udai/common/compass/apps/api/src/lib/ledger-sql.ts:26))

Copying that same `EXISTS` into each comparator would make the tests substantially tautological. The periods test explicitly promises:

> “equal a formula computed DIRECTLY from legacy `transactions` / `transaction_splits` tables”

([postings-periods-parity.test.ts:21](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:21))

That promise cannot remain literally true for transfer identification: the collapsed representation has no reliable legacy header marker. Some postings participation is now unavoidable.

A genuinely independent transfer exclusion is shape-based:

```sql
and not (
  (select count(*)
   from postings pr
   join accounts ar on ar.id = pr.account_id
   where pr.transaction_id = t.id
     and ar.system_kind is null) = 2
  and
  (select count(*)
   from postings ps
   join accounts asys on asys.id = ps.account_id
   where ps.transaction_id = t.id
     and asys.system_kind is not null) = 0
)
```

For extra rigor, the transfer predicate can require the two real amounts to sum to zero and have opposite signs. Retain `not t.is_opening` independently for openings. This does not reproduce `hasCategoryDimension()`’s positive Expenses/Income test; it recognizes the transfer’s structural invariant.

That same formula should replace the retired filters at:

- [postings-periods-parity.test.ts:102](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:102)
- [postings-periods-parity.test.ts:143](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:143)
- [postings-planning-parity.test.ts:176](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:176)
- [postings-planning-parity.test.ts:263](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:263)
- [postings-planning-parity.test.ts:447](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:447)
- [postings-planning-parity.test.ts:600](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:600)

The module comments should also be amended to say that amounts/categories are independently derived from legacy columns, while transfer classification uses an independent postings-shape predicate. Otherwise the tests’ stated methodology becomes false.

## 4. Card opening and transfer-destination balance parity — W4

**Finding: IMPORTANT — directions are correct; balance-parity intent needs respecification.**

### card-due-tasks AC15

The local helper performs the same invalid raw insert:

> `.values({ userId, name, type: "credit_card", openingBalancePaise, ... })`

([card-due-tasks.test.ts:156](/home/udai/common/compass/apps/api/src/modules/credit/services/card-due-tasks.test.ts:156))

The plan should require switching this helper to the real `createAccount`, not offer an unspecified equivalent. That is sufficiently safe once made explicit. Only AC15 currently passes a nonzero opening amount, so the fixture change is narrow.

### postings-balance-parity

The existing comparator explicitly promises not to use postings:

> “computed directly from `accounts`/`transactions` (NOT `postings`)”

([postings-balance-parity.test.ts:91](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:91))

But its SQL groups by `transactions.account_id` ([postings-balance-parity.test.ts:96](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:96)), which cannot represent an incoming transfer leg after collapse.

“Sum postings” fixes the number but invalidates the file’s claimed parity proof. The plan must choose and document a new test purpose. The best available approach is:

- Use a direct postings aggregate written independently from each production helper.
- Also assert literal fixture-derived balances for both transfer source and destination accounts.
- Retain `findInconsistentPostings` checks.
- Update the module comment so it no longer claims transactions-only comparison.

Literal expected balances prevent “production postings helper versus equivalent postings SQL” from becoming a vacuous same-source comparison.

### planning parity test #9

The same issue exists at:

> `select coalesce(sum(t.amount_paise), 0)`  
> `and t.account_id = any(...)`

([postings-planning-parity.test.ts:771](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:771))

Changing this to direct postings SQL is correct because transfer destinations and opening balances are intentionally counted. However, the comparator should assert the known literal total from the fixture—ordinary `50000`, transfer-in `30000`, opening `20000`, for `100000` total—in addition to parity with production. That preserves independent value.

## 5. Backup tests — W5

**Finding: IMPORTANT — AC5 direction is confirmed; OLD-style test requires a much larger rewrite than the plan states.**

### A6 AC5

The proposed failure/rollback direction is correct. Restore inserts every posting without filtering:

> `await insertRow(client, table, firstPassRow(table, rewritten));`

([restore-user.ts:153](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:153))

Any error is handled by:

> `await client.query("rollback");`  
> `throw error;`

([restore-user.ts:187](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:187))

The outer catch also rethrows after blob cleanup ([restore-user.ts:195](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:195)). Therefore a foreign `account_id` produces a hard FK failure, rolls back, and is not swallowed by post-commit validation.

The rewritten test should assert rejection and then query that the destination has:

- no restored real account,
- no restored transaction,
- no restored posting,
- only any pre-existing seeded system accounts.

It should not depend tightly on a driver-specific error message; SQLSTATE `23503` or a general rejection plus rollback-state proof is safer.

### A6 AC3 OLD-style

The direction `repaired === 0` is correct, but the plan substantially understates the required rewrite. This test currently contains all of the following obsolete expectations:

- `repaired > 0` and `failed === 0` ([backup.test.ts:931](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:931))
- `findInconsistentPostings(...) === []` ([backup.test.ts:950](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:950))
- lookup of nonexistent Clearing account ([backup.test.ts:955](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:955))
- six synthesized-posting multiset assertions ([backup.test.ts:963](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:963))
- summary-count comments claiming archived postings are discarded ([backup.test.ts:1010](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:1010))

Current restore intentionally commits an archive with `postings=[]`, then read-only validation reports failures:

> `repaired: 0, failures: await findInconsistentPostings(...)`

([restore-user.ts:96](/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts:96))

Thus every synthesized-leg assertion must be removed or inverted, not merely the Clearing lookup. The test should be renamed to reflect its true contract: an old archive is restored without synthesis and post-commit validation reports missing posting shapes. It should assert `repaired === 0`, the exact or at least deliberately specified `failed` count, zero restored postings, and preservation of the archived non-posting rows.

The plan says “rewrite for the real output shape,” but it does not give the expected failure count or identify all dependent assertions. That leaves too much judgment to the implementer.

## 6. postings-pr-e-parity PE5 — W5/F1

**Finding: IMPORTANT — call the real function; do not copy its SQL.**

The current test says:

> “Run the same SQL as suggestCategoriesFor”

([postings-pr-e-parity.test.ts:392](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:392))

That copy is already stale. It excludes only Clearing/Opening postings ([postings-pr-e-parity.test.ts:401](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:401)), whereas production now:

- excludes a transaction if any system posting has a nonnull category ([categorize.ts:57](/home/udai/common/compass/apps/api/src/modules/automation/services/categorize.ts:57));
- requires `hasCategoryDimension()` ([categorize.ts:63](/home/udai/common/compass/apps/api/src/modules/automation/services/categorize.ts:63)).

The file’s purpose is to prove the converted reader behavior, not to prove two SQL copies agree:

> “reader files converted … to postings-based queries”

([postings-pr-e-parity.test.ts:38](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:38))

Therefore the test should call `suggestCategoriesFor` with a capturing fake `AiProvider`. The fake should record the transactions passed to `ai.suggestCategories` and return valid suggestions for those IDs. Assertions should independently verify the captured set and amounts:

- uncategorized ordinary is included with its real posting amount;
- uncategorized split is included with the parent real posting amount;
- categorized ordinary is excluded;
- transfer is excluded;
- opening is excluded;
- newly added categorized split is excluded because its category counter postings have nonnull `category_id`.

This directly tests the real query and avoids another stale SQL duplicate. Calling the real function requires at least one available expense/income category—which the fixture already creates—and a complete enough provider stub.

The plan’s “either call the function or update the copy” leaves open the inferior option and is not specific enough. It should mandate the real function plus a capturing provider.

## 7. New SIP-installments regression test

**Finding: MINOR/IMPORTANT — correct domain, but not structurally consistent with the existing file.**

The proposed behavioral case is correct and would cover the production bug: link an installment, move its transaction to another account, and verify it remains in the linked candidate set.

The named file is the natural domain location, but it is currently a pure unit-test file. It imports only pure helpers and has no database setup:

> `import { accountInstallmentSipIssue, candidateDateBounds, installmentDateError, linkInstallmentIssue }`

([sip-installments.test.ts:1](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.test.ts:1))

All current cases are synchronous pure-function tests. Adding the proposed case requires a real Postgres harness, user/system-account/SIP/account setup, cleanup, and calls to ledger services. That is not structurally consistent without a sizeable expansion.

A DB-backed test is still reasonable in this domain file, but the plan should explicitly say to add the established `DATABASE_URL`/pool harness and cleanup pattern. Alternatively, extending the existing DB-backed PE4 coverage in `postings-pr-e-parity.test.ts` would be more economical, though that would conflict with the declared “New test (1 file)” scope.

At minimum, the assertion must identify the linked candidate by transaction ID and assert `linked === true` after the transaction’s real leg is moved away from the SIP target account. Merely asserting that some linked candidate exists could pass because of unrelated fixture data.

## Required plan corrections before implementation

- **BLOCKING:** Redesign the two transfer-reconstruction scenarios around one survivor; specify reference/orphan behavior after deleting that single header.
- **IMPORTANT:** Provide the exact two-real-postings assertion pattern for every successful transfer and ordinary-shape assertions for excluded candidates.
- **IMPORTANT:** In W2, mandate `createAccount` and remove all direct nonzero `opening_balance_paise` writes, including concurrency fixtures.
- **IMPORTANT:** Define independent shape-based transfer SQL for parity tests and update their methodology comments.
- **IMPORTANT:** Update postings-balance parity’s stated purpose and add literal fixture totals.
- **IMPORTANT:** Fully respecify the OLD-style backup test; almost all of its post-restore assertions are obsolete.
- **IMPORTANT:** Mandate calling `suggestCategoriesFor` with a capturing fake provider rather than permitting another SQL copy.
- **MINOR/IMPORTANT:** Specify the DB harness required for the new SIP test or place it in an already DB-backed suite.