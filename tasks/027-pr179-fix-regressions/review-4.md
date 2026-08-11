No findings. The production changes and DB-backed regression test satisfy PE1, B2, B3, AC4, AC5, and AC6.

- `cards.ts`: [lines 326–356](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:326). The only `rawRows` query change is:
  > `and not t.is_opening`

  The sibling `sums` query is untouched; the targeted Git diff contains no other change to `getCardActivity`.

- `sip-installments.ts`: [lines 436–454](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:436). `targetAccountId` is absent from the signature and predicate, while the lateral query now contains:
  > `where p.transaction_id = t.id and a.system_kind is null`  
  > `order by (p.amount_paise > 0) desc, p.id`

  Its sole call site is consistently updated to:
  > `linkedInstallmentRows(db, userId, sipId)`

- SIP regression test: [lines 174–292](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.test.ts:174). The pool/DB/`after(pool.end)` harness mirrors `reconciliation-writes.test.ts`. The test links the transaction while its positive real posting belongs to the SIP target, moves that posting to another real account, and then identifies the linked result by the exact transaction ID.

  Reinstating the old `p.account_id = targetAccountId` predicate would leave the lateral join with no row after the move, exclude the transaction from `linkedInstallmentRows`, and fail the `linked.length === 1`/ID assertions. Thus it genuinely demonstrates B3.

  Fixture constraints are satisfied: all required user, goal, SIP, account, and transaction fields are present; referenced rows exist; the account-target/payroll check passes. Cleanup deletes transactions first—cascading to postings—then SIPs, goals, accounts, and the user, so no fixture rows are orphaned.

- `transfer-classification.ts`: [lines 307–311](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:307). The catch matches the full required shape:
  > `err instanceof HttpError && err.statusCode === 409 && err.message === "Transaction is already part of a transfer"`

  The unrelated ambiguous-candidate 409 at [lines 262–266](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:262) has a different message and cannot be swallowed. The obsolete `isUniqueViolation` import is removed.

- The rewritten comment at [lines 172–183](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:172) no longer mentions the retired unique constraint. Its account of sorted `FOR UPDATE` locks and subsequent `classifyShape` validation matches `linkTransfer` at [lines 115–155](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:115).

No BLOCKING, IMPORTANT, or MINOR production-code findings. Tests were not run, as requested.