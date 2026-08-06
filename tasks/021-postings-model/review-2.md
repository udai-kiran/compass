# Re-review: task 2.1 — Postings model & balance invariant

## Verdict

**STILL-BLOCKING.**

Iteration 2 resolves most of the original conceptual objections, but it is not implementation-ready as written. The remaining blockers are:

1. D1 does not define how two existing transaction headers are collapsed when manually linking/suggesting a transfer, including what happens to attachments, transaction links, extracted-transaction references, reconciliation references, and other header metadata.
2. The web Scope omits the principal transfer-suggestion/link/unlink consumer, `TransactionDrawer.tsx`.
3. D9 does not resolve whether `"system"` is also added to the public `AccountTypeSchema`. Either choice has consequences that the Scope does not cover.
4. D8 and D9 conflict with the current user-restore precondition and do not specify the concrete system-account ID remapping algorithm.
5. D13’s claimed exhaustive single-writer Scope omits transaction-mutating services, notably `merchants.ts` and `sip-lifecycle.ts`, and does not distinguish harmless header-only writes from posting mutations.
6. D4 is correct for the three common period helpers, but the plan does not define equivalent shape-sensitive rules for several direct SQL consumers, especially large-transaction notifications and recurring EMI semantics.

---

# Prior 12 required changes

## 1. Define projection separately for ordinary, split, opening, and transfer shapes

**RESOLVED.**

The revised plan now distinguishes the relevant shapes:

- Ordinary transactions project their single real-account posting and system counter-posting: [TASK.md:20](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:20).
- Split amounts are negated back to legacy signed semantics: [TASK.md:20](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:20).
- Opening transactions are identified by an Opening Balances posting: [TASK.md:20](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:20), [TASK.md:25](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:25).
- Transfers use a new one-header DTO rather than being projected as two synthetic legacy rows: [TASK.md:19](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:19).

This resolves the original ambiguity in `hydrate()` for ordinary and split transactions and avoids the impossible two-ID projection for transfers.

The implementation still needs a concrete transfer DTO schema, but that is part of issue 2 below rather than a remaining shape-projection gap.

## 2. Resolve transfer API/DTO identity

**PARTIAL.**

D1 correctly chooses one transaction/header and rejects synthetic leg projection: [TASK.md:19](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:19). That resolves the central identity decision.

However, D1 only says to retire or rewrite the existing link/suggestion APIs. It does not define what manual linking now does to two existing transaction headers. Today:

- `suggestTransfers` returns two existing IDs: [transfers.ts:37](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:37), [ledger.ts:539](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:539).
- `linkTransfer` links two already-existing rows: [transfers.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:68).
- `acceptTransfer` creates two rows and stores each resulting ID on its corresponding extracted draft: [transfer-classification.ts:90](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:90), [transfer-classification.ts:101](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:101), [transfer-classification.ts:114](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:114), [transfer-classification.ts:120](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:120).

Collapsing two existing rows into one requires an explicit merge policy:

- Which header ID survives?
- Which date, timestamp, merchant, notes, tags, source and category metadata survive?
- Are references to the discarded header remapped?
- How are two extracted drafts represented if both currently point to separate transaction IDs?
- What does “unlink” mean after two postings have been consolidated into one transfer header—split the header back into two ordinary transactions, or reject unlink?

That is blocking because it changes both persisted identity and public behavior.

## 3. Add posting notes or remove split-note compatibility

**RESOLVED.**

D3 adds `postings.note text NOT NULL DEFAULT ''`: [TASK.md:21](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:21).

That preserves the current split note contract, which exposes `note`: [ledger.ts:370](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:370), [ledger.ts:374](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:374).

D2 also explicitly hydrates split notes from postings: [TASK.md:20](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:20).

## 4. Preserve liability-inflow exclusions in every income aggregation

**RESOLVED for the stated rule; broader direct-query coverage remains a new issue.**

D4 now accurately states current semantics:

- Negative real-account posting counts as expense.
- Positive real-account posting counts as income only on non-liability accounts.
- Transfers and openings are excluded.
- Reported income is not simply the Income system-account balance.

See [TASK.md:22](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:22).

This matches current `incomeExpense`:

- Liability types are excluded only from positive income: [periods.ts:193](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:193).
- Every negative ordinary row counts as expense: [periods.ts:195](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:195).
- Openings and transfers are excluded: [periods.ts:200](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:200), [periods.ts:201](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:201).

The proposed shape predicates are sufficient for the intended posting shapes:

- Ordinary: one real posting plus one or more system postings.
- Split: one real posting plus multiple Expenses postings.
- Transfer: two real postings and no system posting.
- Opening: one real posting plus an Opening Balances posting.

No current `incomeExpense`, `spentByCategory`, or `spendByNecessity` row would inherently slip through those predicates if writers enforce those exact shapes.

## 5. Add omitted consumers and fixtures to Scope

**RESOLVED for every consumer specifically named in review-1.**

The revised Scope now includes:

- Category merge: [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).
- Review queue: [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).
- Import reconciliation: [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).
- Extractor SQL: [TASK.md:40](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:40).
- Backup CSV and user restore: [TASK.md:39](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:39).
- Full-database restore: [TASK.md:39](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:39).
- Legacy API and extractor fixtures: [TASK.md:43](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:43).
- Account deletion is covered through `accounts.ts` and explicitly mentioned in D9: [TASK.md:27](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:27), [TASK.md:37](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:37).

This resolves the original required change, though new omissions are identified below.

## 6. Make SP0 schema/data-neutral

**RESOLVED.**

SP0 is now pure TypeScript helpers and property tests, with no schema, seed, or behavior change: [TASK.md:32](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:32), [TASK.md:46](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:46).

All database and seeded-data changes are deferred to atomic SP1: [TASK.md:47](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:47).

## 7. Resolve the one-migration/SP0-SP1 contradiction

**RESOLVED.**

The plan now has:

- Schema-neutral SP0: [TASK.md:46](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:46).
- One atomic `0067_*` migration in SP1: [TASK.md:47](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:47).
- Verification expecting exactly one new migration: [TASK.md:54](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:54).

Those statements are consistent.

## 8. Use LINKED_TABLES or enforce denormalized ownership

**RESOLVED at the design level.**

D8 selects parent-transaction scoping, no `postings.user_id`, and registration in both `ALL_TABLES` and `LINKED_TABLES`: [TASK.md:26](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:26).

This follows the existing child-table convention:

- `transaction_splits`, attachments and transaction links are scoped through transactions: [backup.ts:66](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:66).
- Per-user export joins linked children to their parent’s `user_id`: [backup.ts:92](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:92).

The restore/remapping interaction is still incomplete and discussed under new blocking issues.

## 9. Add system-account uniqueness and complete guards

**PARTIAL.**

D9 adds the previously missing essentials:

- Dedicated `"system"` database enum value.
- Nullable `system_kind`.
- Partial unique index per user and kind.
- Exclusion from generic account queries.
- Rejection through the simple transaction API.
- Edit/delete/archive guards.
- Idempotent seeding.
- Restore regeneration/remapping.

See [TASK.md:27](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:27).

The gap is type-boundary design. The current PostgreSQL enum and public `AccountTypeSchema` represent the same set:

- PostgreSQL account types: [hubs.ts:21](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:21).
- Public schema: [ledger.ts:5](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:5).

If `"system"` is added to `AccountTypeSchema`, exhaustive consumers require changes:

- Net-worth bucket map: [networth.ts:30](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:30).
- Goal-return map: [goal-returns.ts:49](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goal-returns.ts:49).
- Web account labels: [account-meta.ts:21](/home/udai/PennyPilot/apps/web/src/lib/account-meta.ts:21).
- The net-worth exhaustiveness test iterates every public option: [networth.test.ts:30](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.test.ts:30).

If `"system"` is not added publicly, code using Drizzle’s inferred database account type can no longer be assumed to satisfy public `AccountType`, and service projections/casts must explicitly reject or narrow system accounts. `accountBalancesAtDate` currently casts arbitrary database strings to `AccountType`: [accounts.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:173).

The plan must explicitly choose one:

- Keep `"system"` internal to the database and narrow it out before any public `AccountType` boundary; or
- Add it publicly and update all exhaustive maps/components with an explicit non-user-facing branch.

## 10. Specify transactional enforcement for every posting writer

**PARTIAL.**

D13 now requires:

- One invariant-enforcing `postEntry`.
- One DB transaction for header plus postings.
- BigInt zero-sum assertion immediately before persistence.
- No direct posting writer outside the helper.

See [TASK.md:31](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:31).

It also names the major writers, and Scope includes the principal direct insert sites:

- Recurring bulk inserts currently bypass `createTransaction`: [recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303), [recurring.ts:330](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:330).
- Import bulk insert/update: [imports.ts:643](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:643), [imports.ts:704](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:704).
- Demo bulk insert: [demo.ts:209](/home/udai/PennyPilot/apps/api/src/modules/system/services/demo.ts:209).
- Account opening-row inserts: [accounts.ts:225](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:225), [accounts.ts:426](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:426).
- Reconciliation opening-balance write: [reconciliation-writes.ts:302](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:302).

But “EVERY writer” and “no posting write outside it” are not yet backed by exhaustive Scope. Current transaction mutations also exist in files not listed:

- Merchant merge/rename updates transactions: [merchants.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:57).
- SIP lifecycle updates transaction linkage: [sip-lifecycle.ts:501](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:501), [sip-lifecycle.ts:515](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:515).

Those may be header-only mutations and need not rewrite postings, but the plan must say so and include them in the conversion/audit. `sip-lifecycle.ts` is especially relevant because its transaction predicates may still depend on removed account/amount columns even if the final mutation changes only a header foreign key.

## 11. Add safe-integer/BigInt rules and boundary tests

**RESOLVED.**

D12 now requires:

- BigInt zero-sum computation.
- Safe-integer validation for money inputs.
- Safe checks after derived arithmetic.
- SQL aggregate range checking before conversion.
- Boundary property tests near `±Number.MAX_SAFE_INTEGER`.
- No proportional split rescaling.

See [TASK.md:30](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:30), [TASK.md:56](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:56).

Adding `.safe()` or equivalent will not reject any large-but-safe integer. It rejects only integers outside JavaScript’s exact integer range. Repository tests already treat unsafe amounts as invalid in relevant financial paths, for example EPF contribution validation expects rejection above `MAX_SAFE_INTEGER`: [epf-contributions.test.ts:352](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/epf-contributions.test.ts:352). Reconciliation already refuses unsafe derived arithmetic: [reconciliation-writes.ts:297](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:297).

One existing test deliberately demonstrates unsafe aggregate conversion—`9007199254740993` is converted through `Number(...)`: [account-balances.test.ts:16](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:16), [account-balances.test.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:27). That test will need to change from accepting rounded output to expecting refusal. This is correcting invalid precision behavior, not breaking valid large-but-safe data.

## 12. Expand parity verification

**RESOLVED.**

T6 now includes all requested parity fixtures:

- Liability inflows and refunds.
- Negative liability transaction.
- Linked bank/card transfer.
- Split categories and necessity override.
- Opening balances across account types.
- Account type changes.
- Reconciliation idempotency.
- Merchant cardinality.
- Transaction-list totals and account-ledger visibility.
- CSV.
- Extractor matching.

See [TASK.md:57](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:57).

---

# New blocking issues

## A. D1 transfer consumers and identity migration are incomplete

The web Scope only names `TransactionsPage.tsx` and `AccountLedgerPage.tsx`: [TASK.md:42](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:42).

That misses `TransactionDrawer.tsx`, which is the actual interactive manual transfer UI:

- Loads transfer suggestions: [TransactionDrawer.tsx:44](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:44).
- Matches suggestions using two transaction IDs: [TransactionDrawer.tsx:79](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:79).
- Displays and unlinks using `transferLinkId`: [TransactionDrawer.tsx:210](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:210), [TransactionDrawer.tsx:215](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:215).
- Submits the two-ID link operation: [TransactionDrawer.tsx:220](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:220), [TransactionDrawer.tsx:226](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:226).

The generic query hooks also retain the old contracts:

- Suggestions endpoint/schema: [queries.ts:228](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:228).
- Link mutation: [queries.ts:241](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:241).
- Unlink mutation: [queries.ts:245](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:245).
- Record-transfer result schema: [queries.ts:250](/home/udai/PennyPilot/apps/web/src/lib/queries.ts:250).

`queries.ts` should therefore also be explicit in Scope.

Attachments and transaction links expose a deeper identity issue. The drawer loads both by the current transaction ID: [TransactionDrawer.tsx:45](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:45), [TransactionDrawer.tsx:47](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionDrawer.tsx:47). Their tables are parented directly to one transaction: [backup.ts:68](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:68), [backup.ts:69](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:69).

When two existing transactions are converted into one transfer, the plan must remap both sets of children to the surviving header or define a different result. Similar care is required for extracted drafts, which currently preserve a distinct transaction ID for each side: [transfer-classification.ts:114](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:114), [transfer-classification.ts:120](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:120).

The review/inbox transfer-classification file is in Scope, which is good, but its required one-ID behavior is not decided. Card-repayment acceptance also searches for and reuses an existing paying-side transaction before linking it: [transfer-classification.ts:233](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:233), [transfer-classification.ts:248](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:248). That cannot be remodeled merely by changing `createTransfer`.

There are no other production callers of `createTransfer`; the only direct caller is the transfer route: [transfers.ts:42](/home/udai/PennyPilot/apps/api/src/modules/ledger/routes/transfers.ts:42). EMI flows do not call it. They directly create source and loan principal rows inside recurring materialization: [recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303). Those semantics still need preservation but are covered by the recurring writer conversion, not by D1.

**Required fix:** add `TransactionDrawer.tsx` and `apps/web/src/lib/queries.ts` to Scope and specify merge/unlink/reference-remapping semantics for already-existing two-row transfers.

## B. D4 is sufficient for period helpers, but direct consumers need explicit shape rules

For `incomeExpense`, `spentByCategory`, and `spendByNecessity`, D4/D5 can reproduce current behavior exactly:

- Expense/category functions only count negative ordinary/split values and exclude openings/transfers: [periods.ts:58](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:58), [periods.ts:70](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:70), [periods.ts:138](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:138), [periods.ts:152](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:152).
- Necessity override precedence is preserved if copied onto every expense posting: [periods.ts:115](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:115), [periods.ts:153](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:153).
- Tenant-scoped category joins remain necessary: [periods.ts:142](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:142), [periods.ts:157](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:157).

The named callers—dashboard, reports, insights, goals, budgets and anomaly detection—are covered either through those helpers or explicit files in Scope. Dashboard trends and cashflow have duplicate direct liability-aware SQL and are also listed: [dashboard.ts:65](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:65), [cashflow.ts:68](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:68).

There is no actual salary-income detector in `prefs.ts`; the salary mention concerns future-dated credits in low-balance calculation: [prefs.ts:131](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:131). `bankCashBalances` is already in the read-conversion scope through balances/prefs.

However, `prefs.ts` does have a large-transaction detector whose semantics cannot be implemented by simply aggregating system postings:

- It produces one alert per transaction.
- It uses the signed real-account amount.
- It supports an account filter.
- It excludes openings and transfers.

See [prefs.ts:85](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:85), [prefs.ts:92](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:92), [prefs.ts:96](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:96), [prefs.ts:98](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:98), [prefs.ts:99](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:99).

D4/D6 should state that transaction-level consumers select the relevant real posting rather than joining every posting. Otherwise split transactions multiply rows and transfers could produce two alerts.

Recurring EMI behavior is also important. Current materialization creates:

- A negative source-account installment that counts as expense.
- A positive liability-account principal row that counts as neither income nor expense.

See [recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303), and the existing parity expectation in [recurring.test.ts:546](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.test.ts:546).

These must remain two ordinary posting-backed entries, not be accidentally consolidated as a transfer solely because two real accounts are involved in the business event.

**Required fix:** explicitly preserve transaction-level real-posting semantics for prefs/search/list/detail consumers and add recurring EMI source/principal parity to T6.

## C. D9’s `"system"` enum value needs a public/internal type decision

D9’s query exclusions are directionally correct. In particular, excluding system accounts in `accountBalancesAtDate` prevents them from reaching net-worth classification, which currently throws on unknown types: [accounts.ts:157](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:157), [networth.ts:70](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:70), [networth.ts:74](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:74).

But the plan cannot simply add `"system"` to the PostgreSQL enum without deciding its relationship to `AccountTypeSchema`.

If public:

- `ACCOUNT_BUCKET` needs `system: null` or an explicit forbidden branch: [networth.ts:30](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:30).
- `ACCOUNT_RETURN_BPS` needs a branch: [goal-returns.ts:49](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goal-returns.ts:49).
- `ACCOUNT_TYPE_LABELS` needs a branch: [account-meta.ts:21](/home/udai/PennyPilot/apps/web/src/lib/account-meta.ts:21).
- Account-type option/exhaustiveness tests change: [networth.test.ts:30](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.test.ts:30).
- Account detail pages and dropdown helpers must not expose the type.

If internal only, all database-to-public projections need explicit narrowing after filtering, rather than unchecked `as AccountType` casts such as [accounts.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:173).

**Required fix:** state that `"system"` is DB-internal and add a narrowing rule, or include every exhaustive public consumer in Scope with an explicit exclusion/branch.

## D. D13 Scope is not exhaustive enough to justify “single writer”

The major direct inserts are covered, including recurring, imports, demo and account openings. But the Scope omits current transaction-mutating files:

- `modules/ledger/services/merchants.ts`: transaction merchant updates at [merchants.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:57).
- `modules/investments/services/sip-lifecycle.ts`: transaction linkage updates at [sip-lifecycle.ts:501](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:501) and [sip-lifecycle.ts:515](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:515).

Reconciliation’s header-only `reconciledStatementId` updates are listed through `reconciliation-writes.ts`: [reconciliation-writes.ts:129](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:129), [reconciliation-writes.ts:140](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:140).

Not every header-only update needs `postEntry`, and forcing metadata-only changes through full posting replacement would be unnecessary. The invariant rule should instead be:

- Every insertion, deletion, or monetary/account/category/necessity mutation of postings routes through `postEntry`.
- Header-only metadata/FK changes may use a clearly named header-only helper and must not touch postings.
- Every file that currently mutates transactions is audited and listed.

**Required fix:** add `merchants.ts` and `sip-lifecycle.ts` to Scope and refine D13 so “single writer” applies to posting-affecting writes, while explicitly permitting audited header-only mutations.

## E. Backup/restore system-account remapping is underspecified and currently contradictory

Ordering itself is straightforward: postings must be placed after accounts and transactions in `ALL_TABLES`. The current array puts accounts before transactions: [backup.ts:28](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:28). Both restore implementations follow that order:

- Full restore: [restore.ts:67](/home/udai/PennyPilot/apps/api/src/db/restore.ts:67).
- User restore: [restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118).

Therefore inserting postings immediately after transactions would satisfy both FKs. There is no postings-before-account ordering hazard if D8 is followed.

The blocker is user restore plus D9 seeding:

- User restore currently requires `accounts` to be entirely empty: [restore-user.ts:13](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:13), [restore-user.ts:68](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:68).
- D9 says registration seeds system accounts: [TASK.md:27](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:27).

A freshly registered user would therefore fail the precondition unless the guard ignores system accounts.

The restore then deletes user-scoped seeded rows in reverse order: [restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105). Because accounts are in `USER_TABLES`, naïve deletion would delete the freshly seeded system accounts before insertion. Meanwhile D9 says archived system account IDs are not restored and postings must be remapped, but D8 says postings have no `user_id`, so the generic row rewrite at [restore-user.ts:122](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:122) cannot perform this remapping automatically.

The plan needs a concrete sequence:

1. Fresh-account guard ignores `system_kind IS NOT NULL`.
2. Delete or retain seeded system accounts deliberately.
3. Regenerate/find exactly one system account for each kind.
4. Build old archived system-account ID → new account ID by `system_kind`.
5. Rewrite each posting’s `account_id` before insertion.
6. Restore real accounts before postings.
7. Ensure system-account rows from the archive are not inserted as ordinary accounts.

Also, the current transactions CSV is export-only; it is not a database restore format: [backup.ts:121](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:121). “Add postings to CSV export/restore” at [TASK.md:26](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:26) is misleading. The JSON/encrypted archive round-trips table rows; the CSV endpoint only exports a human-readable transaction projection. T6 should separately test:

- User archive export/restore with postings and system-ID remapping.
- Full dump restore ordering.
- Transactions CSV projection.

**Required fix:** specify this restore algorithm and split the three verification cases.

---

# Integer-paise compatibility assessment

D12’s safe-integer requirement is appropriate and should not break valid large-but-safe values. Every integer from `-Number.MAX_SAFE_INTEGER` through `Number.MAX_SAFE_INTEGER` remains accepted.

Expected changes are limited to values that are not exactly representable in JavaScript. Such values cannot satisfy “integer paise, provably” through a `number` boundary. The current code already recognizes this in reconciliation: [reconciliation-writes.ts:297](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:297).

The one notable fixture is the account-balance test that deliberately converts the unsafe SQL value `9007199254740993`: [account-balances.test.ts:16](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:16), [account-balances.test.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/account-balances.test.ts:27). That fixture should now assert an overflow refusal. It is not valid safe-number data.

One minor wording correction: `z.number().int()` plus a separate safe refinement is acceptable, but the plan should standardize one reusable `SafePaiseSchema` rather than depending on every schema author remembering the refinement.

---

# Final disposition

**STILL-BLOCKING.**

Required plan amendments before approval:

1. Define transfer merge and unlink semantics for two existing headers, including child/reference remapping.
2. Add `TransactionDrawer.tsx` and `apps/web/src/lib/queries.ts` to transfer Scope.
3. Decide whether `"system"` is public or DB-internal; cover all exhaustive enum consumers or define explicit narrowing.
4. Specify user-restore system-account precondition, regeneration and old-ID remapping.
5. Separate archive round-trip, full-dump restore and human-readable CSV verification.
6. Add `merchants.ts` and `sip-lifecycle.ts` to the writer audit and distinguish posting-affecting writes from header-only mutations.
7. Add explicit parity for recurring EMI source/principal entries and transaction-level real-posting consumers such as large-transaction alerts.

Once those are incorporated, the revised core design—posting shapes, liability semantics, SP0/SP1 sequencing, linked-table ownership, zero-sum enforcement, safe integers and parity coverage—will be implementation-ready.