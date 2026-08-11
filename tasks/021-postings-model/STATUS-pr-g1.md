# PR-G1 build status — branch `feat/postings-pr-g1`

Working notes for resuming. The plan is `PLAN-pr-g.md` (iteration 6, Codex
APPROVED). Four commits so far, each green on `npm run typecheck` and
`npm run lint`.

```
319a316 fix(ledger): filter and total the transaction list from postings
f5686b1 fix(ledger): stop detecting transfers by their Clearing posting
8aa509d feat(ledger): PR-G1 the authority flip — postings own the ledger
4e90f23 feat(ledger): PR-G1 shape core — postings classify, project, own truth
f2b6c9d docs(tasks): finalize the PR-G plan — recreate-from-scratch, two PRs
```

## Done

**Shape core** (`postings.ts`, `legacy-projection.ts`) — `classifyShape` is
exact-count and rejects Clearing; `primaryRealLeg` (not "the negative posting" —
income and asset openings have a positive real leg); `legForAccount`;
`rebuildDrafts` as the pure patch→postings function with the transfer and
split-sum guards moved into it. `legacy-projection.ts` is the single module that
writes the doomed columns, so PR-G2 deletes it whole. 45 pure unit tests.

**Authority flip** (`post-entry.ts` `postTransaction`, `transactions.ts`
`applyShapePatch`) — writers build postings from the request and project the
columns from them. `computePostingDraftsForTransaction` and
`rebuildPostingsForTransaction` are gone. Converted: createTransaction,
updateTransaction, setSplits, bulkAction, transfers, accounts' opening writers,
categories merge (now one posting UPDATE instead of two column updates plus a
per-row rebuild), recurring incl. both EMI families, import commit/reconcile/
rollback, demo seed, restore.

**Transfers are one header** — `createTransfer` and `linkTransfer` produce one
transaction with two real postings; `transfer_links` is no longer written.
`collapse-transfer.ts` remaps attachments, transaction links, user tasks,
extracted transactions and the FK-less `import_rows` references onto the
survivor before the absorbed header is deleted, and 409s when both legs hold a
different single-valued identity. `unlinkTransfer` takes a transaction id and
splits into two transactions.

**Boot** — `assertNoLegacyShapes` refuses to start on a pre-recreate database
(Clearing postings, `transfer_links` rows, or non-zero `opening_balance_paise`);
`findInconsistentPostings` reports non-zero-sum or unclassifiable sets without
touching them. Restore no longer discards archived postings.

**DTO/web** — `transferLinkId` → `isTransfer`; account-scoped reads project that
account's leg; unlink is "split into two". `TransferResult` is `{ transactionId }`.

**Readers** — the eleven Clearing-predicate aggregates now use
`hasCategoryDimension()` (`lib/ledger-sql.ts`); search and AI categorize too.
`filterWhere` and the list totals are postings-based.

## Remaining

1. **`absorbCarryover`** (`credit/services/reconciliation-writes.ts:296-305`) —
   still writes `accounts.opening_balance_paise` directly, and
   `ledgerDuesAtDates` takes the column as a parameter. Must adjust the
   account's Opening TRANSACTION instead. Deliberately left rather than rushed:
   it is correctness-sensitive, has its own SSI dependency-cycle test
   (`tasks/cc-recon-02-carryover-seed`), and needs a database to verify.
2. **Remaining `opening_balance_paise` readers** — `balances.ts:37`,
   `accounts.ts:166,217`, `average-balance.ts`, `cards.ts`,
   `reconciliation-reads.ts`. These are the addend arms; they read a column the
   boot check now forces to zero, so they are dead weight rather than wrong, but
   they must go before the gate can pass.
3. **Posting-grain projection** — `user-tasks.ts:99`, `backup.ts:157`,
   `sip-installments.ts:442` still pick a leg with `order by p.id limit 1`.
   Harmless for one-real-posting shapes, arbitrary for a transfer.
4. **Legacy-column readers still to convert** — `transfer-classification.ts`
   repayment matching, `review-queue.ts` / `bills.ts` / `categorize.ts`
   `t.category_id`, the account-delete guard and opening reconciliation in
   `accounts.ts`.
5. **The CI gate** (plan item 4) — assert zero READS of the legacy columns
   outside the allowlist (schema files, `legacy-projection.ts`, the boot check).
   Write it last: it is the proof that 1–4 are complete.
6. **Tests** — 6 files, 14 type errors, all mechanical (removed exports, changed
   result shapes): `postings-periods-parity`, `reconcile-postings`, `inbox`,
   `backup`, `postings-pr-e-parity`, `epf-contributions`. New DB-backed tests
   are still owed for the merge/unmerge contract, the account-perspective DTO,
   and list cardinality across a cursor boundary (plan item 6).
7. **Nothing has run against a database.** No `DATABASE_URL` is configured here
   and the repo has no `.env`. Every DB-backed assertion in this branch is
   unverified — the pure unit tests are all that has actually executed.

## Note on verification

`npm run typecheck`, `npm run lint` and the 45 pure unit tests are green. That
is a real but narrow guarantee: it proves the code compiles and the shape
functions behave, not that a transaction round-trips through Postgres. Point
`DATABASE_URL` at a scratch database and run `npm run test -w apps/api` before
trusting any of this.
