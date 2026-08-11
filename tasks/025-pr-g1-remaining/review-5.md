## Review result: BLOCKED

### Blocking defects

1. **AC5 still fails: `transactions.account_id` is read in reconciliation production code.**

   [reconciliation-writes.ts:96](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:96), [reconciliation-writes.ts:138](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:138), and [reconciliation-writes.ts:149](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:149) use `transactions.accountId` as a filter.

   This is both an explicit AC5 violation and a functional postings-native regression: a collapsed transfer/repayment has two real postings but only one projected header `account_id`, so card reconciliation may reject a valid transaction posting on the card account.

2. **AC5 also fails elsewhere in branch production code.**

   - [periods.ts:141](/home/udai/common/compass/apps/api/src/lib/periods.ts:141) and [periods.ts:152](/home/udai/common/compass/apps/api/src/lib/periods.ts:152) read `transactions.necessity`.
   - [transactions.ts:671](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:671) reads `transactions.categoryId`.
   - [imports.ts:671](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:671) reads `transactions.accountId`.
   - [imports.ts:877](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:877)–[891](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts:891) reads `transfer_links`.
   - [backup.ts:32](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:32)–[49](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:49), combined with the generic reads at [backup.ts:92](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:92)–[113](/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts:113), exports `transfer_links`.

   None are within the stated AC5 allowlist.

### Requested inspection results

- `accounts.ts` correctly selects `p.amount_paise`: [accounts.ts:436](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:436).
- The stale `5000 +` cross-check is removed: [postings-pr-e-parity.test.ts:138](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:138).
- Carryover real-leg lookup is constrained by `p.account_id = accountId`: [reconciliation-writes.ts:315](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:315)–[319](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:319).
- `carriesOpeningAsTransaction` returns true for every type: [accounts.ts:21](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:21).
- Non-zero openings create an Opening transaction for every account type: [accounts.ts:233](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:233)–[260](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:260).
- `ledgerDuesAtDates` has exactly four parameters: [reconciliation-reads.ts:110](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:110)–[115](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:115).
- `absorbCarryover` updates/inserts/deletes an Opening transaction and does not update `accounts.opening_balance_paise`.
- `reconcile-postings.test.ts` correctly imports and tests `findInconsistentPostings` and `reprojectAllLegacyColumns`; no `reconcileUserPostings` remains.
- `backup.test.ts` no longer imports `reconcileUserPostings`.
- Primary-real-leg projections are correct:
  - `user-tasks.ts`: negative-first, then posting ID.
  - `backup.ts`: negative-first, then posting ID.
  - `sip-installments.ts`: constrained to the SIP target account.
- The repayment candidate query in `transfer-classification.ts` uses postings for account, amount, Opening exclusion, and real-posting shape; it does not read the forbidden transaction columns or `transfer_links`.

### Acceptance status

- AC1 typecheck: **PASS**, exit 0.
- AC2 lint: **PASS**, exit 0.
- AC3 API tests: **NOT VERIFIED**, exit 1 because `DATABASE_URL` is absent. Reported 668 pass, 25 DB-bootstrap failures, 1 skipped.
- AC4 extractor tests: **NOT VERIFIED**, exit 1 because `DATABASE_URL` is absent. Reported 62 pass, 1 DB-bootstrap failure.
- AC5 forbidden reads: **FAIL**.
- AC6 carryover adjusts Opening transaction: **PASS by inspection**.
- AC7 all types create Opening transactions: **PASS by inspection and pure tests**.
- AC8 four-parameter `ledgerDuesAtDates`: **PASS**.

### Advisories

- Several comments still describe the obsolete split storage model, notably [accounts.ts:30](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:30), [accounts.ts:230](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:230), and [average-balance.ts:154](/home/udai/common/compass/apps/api/src/modules/ledger/services/average-balance.ts:154).
- `transfer-classification.ts` still catches and describes the removed `transfer_links_out_transaction_id_unique` constraint; this appears to be dead legacy handling.