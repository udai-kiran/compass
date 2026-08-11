## Blocking findings

1. The proposed replacement text for `review-actions.ts` is still inaccurate. Under PR-G1, both drafts accepted by `acceptTransfer` point to the same surviving transaction header. Deleting that header nulls both drafts’ `transaction_id` values and removes both postings. There is no separate “partner transaction” that may survive.

   Correct description: both accepted drafts become orphans simultaneously; restoring one makes only that draft pending, while the other remains an orphaned accepted draft until separately restored. Once both are restored, `pickTransferPairs` may pair them again.

2. `legacy-projection.ts`’s header is not literally accurate. It claims to be the only module permitted to write legacy transaction columns, but `imports.ts` directly writes `transactions.amountPaise` during reconciliation around line 660 before calling `applyShapePatch`. Either:

   - correct that writer as part of a separate tracked task, or
   - soften the header’s exclusivity claim.

   This need not necessarily expand task 030, but the plan cannot state that the header was confirmed fully accurate without acknowledging this exception.

## Important findings

- `survivingPartners` is unquestionably dead. It is constructed and populated at `imports.ts:875-896`, but never read afterward. Removing it cannot alter behavior except eliminating its database query.

- `transferLinks.outTransactionId` and `.inTransactionId` occur nowhere else in `imports.ts`; all four references are inside this block.

- `assertNoLegacyShapes()` in `reconcile-postings.ts` counts all `transfer_links` rows and prevents application startup when any exist. Normal PR-G1 runtime code has no production insert into `transfer_links`. Thus the table is guaranteed empty at successful boot and remains empty under normal writers. This is a boot/runtime invariant, not a database constraint against out-of-band insertion after startup.

- The `review-actions.ts:136` cascade statement is factually wrong under PR-G1. A transfer is one header with two postings; deleting it cascades the postings and nulls both extracted-draft references.

- No other production `transfer_links` runtime query exists in the ingest module. The only remaining production ingest occurrences are:

  - the dead block;
  - the stale `review-actions.ts` comment;
  - an accurate explanatory comment around `imports.ts:686`.

  `inbox.test.ts` contains read-only invariant assertions, which are valid tests rather than dead production references.

- Removing the block has no data-correctness risk. Even if rows somehow existed, `survivingPartners` currently influences nothing. There is no later code that was intended to consume it: the post-transaction `autoLinkTransfers` call is gated only by `snapshots.length` and receives no partner IDs.

- The comment at `imports.ts:928-929` should be updated, not left as-is. “Rebuild auto transfer links” and “Manual links were never touched” describe the retired link-row model and conflict with the preceding reconciliation behavior, which explicitly says manual and automatic transfers are no longer distinguishable. Suggested meaning: restored corrected transactions may again form eligible ordinary pairs, so rerun `autoLinkTransfers`.

## Regression risks

- Runtime risk from deleting the block is negligible: only an unused query and unused allocations disappear.
- Ensure `or` is not removed from the Drizzle import; it is used elsewhere in `imports.ts`.
- Remove only `transferLinks` from the schema import.
- Comment edits must accurately distinguish transaction headers, postings, and extracted drafts.
- No test changes are required, but existing rollback and orphan-transfer reconstruction tests provide useful coverage.

## Test scope

AC7’s command is valid:

```sh
npm run test -w apps/api
```

It runs the entire API test suite, not merely ingest tests. Therefore the parenthetical “ingest tests pass” should be corrected to “API tests pass.” For focused verification, the plan may additionally run the imports and inbox test files, but the full API workspace suite is an appropriate acceptance gate alongside root typecheck and lint.

## Required plan corrections

- Rewrite the planned `review-actions.ts` explanation using the actual shared-header/orphan behavior.
- Require updating the stale `imports.ts:928-929` comment instead of making it optional.
- Amend the claim that `legacy-projection.ts` was confirmed fully accurate, documenting the direct legacy-column write in `imports.ts`.
- Change AC7’s description from “ingest tests pass” to “API tests pass.”

Subject to those corrections, removal of the dead block is safe and appropriately scoped.