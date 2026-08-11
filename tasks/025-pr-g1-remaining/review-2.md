## Blocking defects

1. [accounts.ts:436](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:436) still reads `transactions.amount_paise` when discovering the existing Opening amount:

   ```sql
   select t.id, t.amount_paise
   ```

   This violates TASK.md AC5 and makes `updateAccount` depend on a legacy projection rather than authoritative postings. Select the posting on `account_id = id` instead.

2. [reconciliation-writes.ts:292](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:292) updates/inserts the Opening transaction without ensuring its date precedes the reconciled statement date. If the existing Opening transaction is dated on/after `statementDate`, updating its postings cannot change `ledgerDuesAtDates`, which uses `t.date < statementDate`. With no Opening transaction, `planOpeningBalanceChange` may insert it today or before the earliest activity—also potentially after the statement. `absorbCarryover` then succeeds but returns the original drift instead of absorbing it.

3. [postings-pr-e-parity.test.ts:138](/home/udai/common/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:138) retains a stale opening-balance addend in PE1:

   ```ts
   assert.equal(balancePaise, 5000 + Number(legRow.total));
   ```

   `legRow.total` already includes the credit card’s 5000 Opening posting after R4. The preceding assertion expects `-10000`, while this one expects `-5000`, so the test must fail.

## Advisories

- [transfer-classification.ts:253](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:253) implements “not a transfer” as fewer than two real postings rather than the specified `classifyShape(...) !== "transfer"` semantics. It works for all valid posting shapes, but is an implicit structural shortcut and rejects malformed two-real-plus-system shapes rather than letting normal shape validation report corruption.

- [reconciliation-writes.ts:316](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:316) reads an arbitrary real posting with `LIMIT 1`. The query should constrain `p.account_id = accountId`; otherwise malformed Opening data could produce a nondeterministic amount. Missing real-leg data is also silently treated as zero instead of reported as inconsistent.

- Several comments remain legacy-oriented: [accounts.ts:30](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:30), [accounts.ts:69](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:69), [reconciliation-reads.ts:89](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-reads.ts:89), and [reconciliation-writes.ts:214](/home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.ts:214) still describe bank/cash-only or column-plus-sum behavior.

## Verified

- R4’s all-account-type opening behavior and postings-based existence/date/delete predicates are otherwise present.
- R5 removes the specified legacy `accountId`, `amountPaise`, `isOpening`, and `transferLinks` reads.
- `absorbCarryover` locks the account before ledger/reconciliation reads, reads the current amount from postings, computes `currentOpeningPaise - drift`, and passes the plan result to `postTransaction`.
- `ledgerDuesAtDates` has four parameters and returns `-sum`.
- PE3 uses four arguments and `-Number(r.s)`.
- API TypeScript typecheck passes with no errors.