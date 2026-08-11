# PR-G staging plan — review-1 (Codex, plan iteration 1)

# CHANGES REQUIRED

## Blockers

1. **The G1 validator/precondition is internally impossible, and G1 does not define when transfer writers switch to Shape B.**

   G1 says the inverted reconciler will “assert the G3 invariant” ([PLAN-pr-g.md:111](tasks/021-postings-model/PLAN-pr-g.md:111)), while G2 requires that validator to be empty ([PLAN-pr-g.md:171](tasks/021-postings-model/PLAN-pr-g.md:171)). But G3 rejects Clearing and requires transfers to be exactly two real postings. Therefore every valid pre-G2 Shape-A transfer makes G2’s precondition fail.

   Separately, the plan says `transfer_links` remains written for pre-G2 shapes ([PLAN-pr-g.md:120](tasks/021-postings-model/PLAN-pr-g.md:120)). Current `linkTransfer` inserts `transfer_links` and rebuilds both Clearing legs ([transfers.ts:133](apps/api/src/modules/ledger/services/transfers.ts:133)). Unless G1b explicitly switches `createTransfer`, `linkTransfer`, auto-linking and unlinking to Shape-B semantics—or uses a G2-flipped durable feature marker—the unchanged G1b binary will recreate Shape A immediately after G2.

   Required: separate a G1 bi-shape validator from the strict post-collapse G3 validator, and specify exactly when all transfer writers switch to Shape B.

2. **The “all eight readers” inventory is materially incomplete; many current readers recognize transfers only by Clearing. G2 would create an immediate wrong-answer window.**

   Examples:

   - `incomeExpense` would count a collapsed transfer’s negative real posting as expense and positive real posting as income ([periods.ts:218](apps/api/src/lib/periods.ts:218)).
   - Cashflow would do the same ([cashflow.ts:80](apps/api/src/modules/planning/services/cashflow.ts:80)).
   - Large-transaction alerts would alert on a transfer ([prefs.ts:102](apps/api/src/modules/system/services/prefs.ts:102)).
   - Search would return duplicate rows for the two real postings ([search.ts:13](apps/api/src/modules/ledger/services/search.ts:13)).
   - AI categorization would offer collapsed transfers for categorization and still reads `t.category_id` ([categorize.ts:55](apps/api/src/modules/automation/services/categorize.ts:55)).
   - Subscription detection would treat a transfer outflow as recurring spend ([bills.ts:94](apps/api/src/modules/planning/services/bills.ts:94)).
   - Largest-spend/top-merchant/trends/report queries have the same Clearing-only exclusion ([insights.ts:144](apps/api/src/modules/planning/services/insights.ts:144), [dashboard.ts:74](apps/api/src/modules/planning/services/dashboard.ts:74), [reports.ts:113](apps/api/src/modules/planning/services/reports.ts:113)).

   The DTO also needs account perspective defined. A collapsed transfer has one canonical negative/source projection, but `AccountLedgerPage` renders `txn.amountPaise` directly ([AccountLedgerPage.tsx:148](apps/web/src/routes/accounts/AccountLedgerPage.tsx:148)); the destination account ledger would otherwise display an inflow as an outflow.

   Required: inventory and convert every Clearing/transfer predicate, not only the carve-out’s eight legacy-column readers, and define global totals versus account-filtered totals and account-relative display.

3. **The postings-authority writer conversion is not sufficiently enumerated, and opening authority misses a direct production writer.**

   Current legacy-first derivation remains in:

   - recurring and both EMI families ([recurring.ts:288](apps/api/src/modules/ledger/services/recurring.ts:288), [recurring.ts:358](apps/api/src/modules/ledger/services/recurring.ts:358));
   - import reconciliation and rollback ([imports.ts:656](apps/api/src/modules/ingest/services/imports.ts:656), [imports.ts:933](apps/api/src/modules/ingest/services/imports.ts:933));
   - category merge ([categories.ts:172](apps/api/src/modules/ledger/services/categories.ts:172));
   - demo population ([demo.ts:216](apps/api/src/modules/system/services/demo.ts:216));
   - transfers, accounts, bulk edits and boot reconciliation.

   More seriously, `absorbCarryover` directly recalculates and writes `accounts.opening_balance_paise` ([reconciliation-writes.ts:297](apps/api/src/modules/credit/services/reconciliation-writes.ts:297), [reconciliation-writes.ts:304](apps/api/src/modules/credit/services/reconciliation-writes.ts:304)). After G2, that would recreate a non-zero column alongside the synthesized Opening posting, causing the exact double-count D-G1 intends to prevent.

   Required: a mandatory mutation graph covering these paths, especially rewriting `absorbCarryover` to update the Opening posting transaction.

4. **G2’s “delete the IN header” step can silently lose references and children.**

   Current `linkTransfer` rejects only sign/account/opening/link conflicts; it does not reject splits or header domain references ([transfers.ts:108](apps/api/src/modules/ledger/services/transfers.ts:108)). Existing IN legs can therefore carry:

   - `sip_id`, `reconciled_statement_id`, `policy_id`, `resource_id`, or `recurring_template_id`;
   - splits;
   - attachments and transaction links, whose FKs cascade ([ledger/schema.ts:84](apps/api/src/modules/ledger/schema.ts:84), [ledger/schema.ts:156](apps/api/src/modules/ledger/schema.ts:156));
   - user tasks and extracted-transaction links, whose FKs become null ([ledger/schema.ts:117](apps/api/src/modules/ledger/schema.ts:117), [ingest/schema.ts:195](apps/api/src/modules/ingest/schema.ts:195));
   - `import_rows.transaction_id` and `reconciled_from`, which have no FK to repair automatically ([ingest/schema.ts:84](apps/api/src/modules/ingest/schema.ts:84)).

   “Prefer OUT on conflict” silently discards domain identity and is not acceptable. Copying `sip_id` can also hit `transactions_sip_date_idx` ([ledger.ts:121](apps/api/src/db/shared/ledger.ts:121)).

   Required: preflight all linked pairs, explicitly remap every reference, and fail/manual-remediate incompatible header-reference conflicts before deletion.

5. **Restore is broken by the authority flip before G4, and G4 option (a) is not sufficient.**

   Per-user restore deliberately discards archived postings ([restore-user.ts:151](apps/api/src/modules/system/services/restore-user.ts:151)) and relies on the legacy-derived reconciler after commit ([restore-user.ts:204](apps/api/src/modules/system/services/restore-user.ts:204)). Once G1 inverts that reconciler, restore produces transactions with no postings and cannot reconstruct them from authority.

   After G4, merely filtering unknown columns/tables is also unsafe: a pre-G4 archive contains Shape-A Clearing postings. Restoring those while G4 drops the Clearing predicate reintroduces an unsupported shape and wrong answers. Per-user restore still skipping postings would also break even post-G4 archives.

   Required: G1 must restore authoritative postings with system-account ID remapping. At G4, either transform archived Shape A/opening data through the full migration or version-bump and reject pre-G4 archives.

6. **G3 is not complete or temporally safe enough to authorize G4.**

   Missing checks include:

   - exact Shape-A/B validation rather than the broad `≥2 real` classifier;
   - posting-account and category ownership matching the parent user;
   - preservation/remapping of every reference listed above;
   - exact counter kinds, category/necessity placement, and posting multiplicities;
   - no duplicate Opening entry per account;
   - explicit account/global/list cardinality parity where applicable.

   “Per-account, per-as-of-date” and “period totals” are not defined as a finite reproducible set. Account-creation-date openings also intentionally change results before the account’s creation date compared with today’s undated column, so literal all-date parity is impossible without defining that boundary.

   Finally, G3 cannot be run once and remain valid while G1b operates indefinitely before G4. Writes or restores can reintroduce Shape A. G4 must run under the same write stop immediately after a fresh strict G3 check, or rerun G3 as a deployment precondition.

## V1–V8

- **V1:** Substantively accurate. Branch order and legacy inputs are exactly at [transactions.ts:201](apps/api/src/modules/ledger/services/transactions.ts:201). The caller inventory is incomplete, as noted above.
- **V2:** Accurate. Boot calls reconciliation unconditionally at [app.ts:188](apps/api/src/app.ts:188), and drift is replaced at [reconcile-postings.ts:102](apps/api/src/modules/ledger/services/reconcile-postings.ts:102).
- **V3:** Accurate: both columns are non-null and `account_id` is an FK ([ledger.ts:31](apps/api/src/db/shared/ledger.ts:31)).
- **V4:** Accurate.
- **V5:** Substantively accurate, though the cited `accounts.ts:166` is the SQL selection; the actual addition is at [accounts.ts:217](apps/api/src/modules/ledger/services/accounts.ts:217). It also omits several credit/reconciliation/AMB consumers.
- **V6:** Inaccurate as an exhaustive claim. There are more than eight relevant production readers/predicates.
- **V7:** Accurate. Both insert helpers use `Object.entries(row)` ([restore.ts:40](apps/api/src/db/restore.ts:40), [restore-user.ts:35](apps/api/src/modules/system/services/restore-user.ts:35)).
- **V8:** Accurate. `buildTransferPostings` exists at [postings.ts:167](apps/api/src/modules/ledger/services/postings.ts:167) and has no production caller.

Finding 1 is real: a collapsed transfer misses opening/link/split branches, becomes ordinary, and `replacePostings` deletes the destination real posting. Boot alone is sufficient to trigger it.

## Open questions

1. **Predicate/EMI:** EMI is not two families under one header. Recurring creates separate source and principal transaction rows, each rebuilt independently ([recurring.ts:288](apps/api/src/modules/ledger/services/recurring.ts:288), [recurring.ts:309](apps/api/src/modules/ledger/services/recurring.ts:309)). It is not a false positive. For current canonical writer shapes the predicate is unambiguous, but use exact predicates: Shape A = exactly one real plus one Clearing; Shape B = exactly two real and zero system.

2. **Delete `computePostingDraftsForTransaction`:** Delete it from the production runtime in G1a. A Shape-B guard preserves legacy authority for every other shape and leaves many dangerous callers. If needed for a one-shot migration, isolate it as a migration-only helper.

3. **Reference merge:** “Prefer OUT on conflict” is not acceptable. Preflight and reject/manual-remediate conflicts; migrate IN-only values only under explicit semantics. The SIP partial unique index can make a naïve merge fail.

4. **Restore choice:** Choose **(b)** as currently scoped. Option (a) is safe only if expanded into a version-aware archive transformation that collapses Shape A, migrates openings/references, and restores authoritative postings—not a few-line unknown-column filter.

## Non-blocking amendments

- Replace “same statement” with “same database transaction”; PostgreSQL commit visibility prevents an intermediate double count. Keep writes stopped unless every competing path and lock order is proven.
- Use a durable staging table, not an ordinary session-temporary table, if snapshots must survive until G4.
- Correct the rollback language: after G2, reverting to a pre-G1/G1a binary already requires restoring the pre-G2 backup. G4 is the schema point of no return, but G2 is already a code-rollback boundary.
