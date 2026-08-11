No BLOCKING findings.

## IMPORTANT

1. `acceptRepayment AC4` does not satisfy AC9’s mandatory 8-point assertion pattern.

At [inbox.test.ts:1315](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:1315), the test only verifies:

> `txPostings.length === 2`  
> every `systemKind === null`  
> sum is zero  
> every `categoryId === null`

It never asserts that the accepted draft references `dto.transactionId`, nor that the exact tuples are `[fromAccountId, -500000]` and `[cardAccountId, +500000]`.

Verdict: **real gap; complete the pattern**. Timestamp provenance is this test’s distinguishing purpose, but AC9 explicitly requires the full pattern for every successful transfer. Sibling coverage does not prove this particular result used the intended accounts and amount; two arbitrary opposite postings would satisfy the current checks.

2. `acceptRepayment AC4b` likewise has a real AC9 gap.

At [inbox.test.ts:1414](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:1414), it checks account presence using:

> `aPostings.some((p) => p.accountId === fromAccountId)`  
> `aPostings.some((p) => p.accountId === otherAccountId)`

but never verifies the surviving tuples are exactly `-500000` and `+500000`.

Verdict: **real gap; add exact amount assertions**. The concurrency/rollback behavior is well covered, but AC9 is deliberately stronger: the one committed survivor must also be proven to be the correct transfer, not merely a balanced two-account transaction.

## MINOR

1. Some dormant legacy helper SQL still uses `transfer_links`, despite the updated methodology comments.

In [postings-periods-parity.test.ts:123](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:123), split-category SQL still says:

> `not exists (select 1 from transfer_links tl ...)`

and [postings-periods-parity.test.ts:177](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:177) and line 191 retain the same predicate in `legacySpendByNecessity`.

Similarly, planning helpers retain it at [postings-planning-parity.test.ts:289](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:289), line 442, and line 529.

These are not among TASK.md’s cited replacement locations and do not invalidate the current fixtures, but they conflict with the broad comments that legacy helpers now use structural transfer classification. They are latent future-test hazards.

2. Two fixture comments in the balance parity test still describe the retired column-opening model.

[postings-balance-parity.test.ts:189](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:189) says:

> `Card with a column-based opening balance`

and line 238 says:

> `Zero-activity column-opening account`

The helper now calls real `createAccount`, so nonzero openings are posting-backed. Assertions appear correct; only the descriptions are stale.

## Requested judgments

### D8 redesigned transfer reconstruction

The test at [inbox.test.ts:734](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:734) implements the reviewed six-step D8 design correctly:

1. `acceptTransferPair` at line 754.
2. `hardDeleteTransaction(s1)` and both orphan assertions at lines 767–771.
3. Both `restoreOrphan` calls at lines 774–775.
4. Independent out-draft acceptance and one-real-posting assertion at lines 781–785.
5. Independent in-draft acceptance at line 792.
6. The final survivor/draft/posting/tuple/zero-sum/no-category/zero-link assertions at lines 797–833.

The matching expectation agrees with production. `suggestTransfers` requires one-real-posting ordinary candidates with an Expenses/Income counter, opposite equal amounts, different accounts, and dates within the window ([transfers.ts:61](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:61)). `autoLinkTransfers` links only pairs unique on both sides ([transfers.ts:208](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:208)). Finally, `survivorOf` always preserves the outflow ID ([collapse-transfer.ts:32](/home/udai/common/compass/apps/api/src/modules/ledger/services/collapse-transfer.ts:32)).

Thus T_out cannot link after step 4, becomes the unique match after step 5, and correctly survives as S2. AC10 is satisfied.

### PE5 uncategorized split fixture

Verdict: **keep the case, but explicitly frame it as defensive robustness for an accepted noncanonical/restored shape, not as a normal user-created split**.

Normal writers cannot create it:

- `buildSplitPostings` requires `categoryId: string` and copies it onto every counter posting ([postings.ts:126](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:126)).
- `setSplits` also requires `categoryId: string` and validates every category ([transactions.ts:569](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:569)).
- Category merge rewrites posting category IDs before deleting the source category ([categories.ts:154](/home/udai/common/compass/apps/api/src/modules/ledger/services/categories.ts:154)); it does not null them.

However, the validator genuinely accepts the fixture. `classifyShape` defines a split solely as one real posting plus at least two non-opening system postings; it does not require categories ([postings.ts:299](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings.ts:299)). `findInconsistentPostings` only checks presence, zero-sum, and that classification succeeds ([reconcile-postings.ts:48](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:48)). Backup restoration also inserts archived posting rows verbatim, so malformed or externally supplied archives provide an application ingress path even though ordinary writers do not produce it.

Testing `suggestCategoriesFor` on that accepted shape is therefore legitimate defensive coverage. The current comments at [postings-pr-e-parity.test.ts:372](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:372) already acknowledge the direct insertion, but “split-like” or “validator-accepted noncanonical shape” would be more precise than implying a regular application-created split.

### W4 structural formulas

The exact independent formula—two real postings and zero system postings—appears at both required locations in `postings-periods-parity.test.ts`:

- [line 106](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:106)
- [line 152](/home/udai/common/compass/apps/api/src/lib/postings-periods-parity.test.ts:152)

It also appears at all four cited planning locations:

- [line 179](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:179)
- [line 271](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:271)
- [line 460](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:460)
- [line 618](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:618)

These are not copies of `hasCategoryDimension()`. That production helper instead checks for the existence of an Expenses/Income counter posting ([ledger-sql.ts:26](/home/udai/common/compass/apps/api/src/lib/ledger-sql.ts:26)). The required parity formulas are independently shape-based and non-tautological.

### Backup OLD-style failure count

The `failed === 6` assertion at [backup.test.ts:940](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:940) is correct.

The fixture restores six transaction headers and no postings. `findInconsistentPostings` selects every transaction for the user without any `deleted_at` predicate ([reconcile-postings.ts:43](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:43)), then emits one `"no postings"` problem for each ([reconcile-postings.ts:48](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.ts:48)). Consequently the soft-deleted sixth transaction is included, producing exactly six failures.

## Overall assessment

The reviewed test changes otherwise conform to D8/D9/F6 and the W2–W5 plan. The two partial successful-transfer assertions are the only important acceptance-criteria violations found; both should be completed before approval.