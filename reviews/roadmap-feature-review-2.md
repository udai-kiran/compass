## 1. Double-entry design flaws

### P0 — The accounting model is underspecified and cannot safely be implemented

1. **“Signs become mechanical” is false.** Task 2.1 removes the documented sign convention but does not replace it with debit/credit semantics or an account-normal-balance rule. A signed posting still needs a convention. Is a positive posting an asset increase, a debit, or an increase in the account’s natural balance? Those are not interchangeable for assets, liabilities, income, and expenses. [tasks/02.01-postings-model.md](/home/udai/PennyPilot/tasks/02.01-postings-model.md:20)

   The current code relies everywhere on positive = inflow and negative = outflow, including `txDirection()`, `sumSigned()`, card debt, SIP candidate selection, EMI history, goals and reports. [transactions.ts](/home/udai/PennyPilot/apps/api/src/services/transactions.ts:17)

   The plan must define signs per account class, plus the compatibility mapping for the old API. Without that, two agents can build opposite but internally zero-sum ledgers.

2. **There is no usable system-account schema.** Task 2.1 says to seed `Expenses`, `Income`, and `Opening Balances` “per user,” but `accounts.type` is a closed Postgres enum of user-facing financial containers. There is no `system`, `equity`, `income`, or `expense` type, no `isSystem` field, and no stable system-account key. [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:127)

   Names are not safe identifiers: users can already name accounts freely. The task does not say:

   - how system accounts are identified;
   - whether they appear in `/api/accounts`, account pickers, search, backups, goals or archives;
   - how they are protected from rename/archive/delete;
   - how `assertOwnedAccount()` distinguishes valid user-postable accounts;
   - whether system accounts participate in account sorting and bank/detail joins.

   “Not user-deletable” is one acceptance criterion, not a design.

3. **System accounts will break net worth unless explicitly excluded.** `computeNetWorth()` exhaustively maps every `AccountType` through `ACCOUNT_BUCKET` and throws on an unknown type. [networth.ts](/home/udai/PennyPilot/apps/api/src/services/networth.ts:28) If system accounts reuse an existing type, their cumulative Income/Expenses/Opening Balances balances will be counted as assets or liabilities. If a new type is added, `computeNetWorth()` throws until classified. If classified as a normal bucket, double-entry counterbalances contaminate net worth.

   Task 2.4 merely says “convert net worth.” It does not specify the essential rule: balance-sheet reports must include real asset/liability accounts and exclude nominal/equity system accounts. Nor does it specify closing nominal balances, so Income and Expenses accumulate forever.

4. **The claimed invariant is not enforced at the database boundary.** Task 2.1 promises only service enforcement. Task 2.6 recognizes bypass writes but adds an on-demand checker, not a storage constraint. [tasks/02.06-double-entry-invariants.md](/home/udai/PennyPilot/tasks/02.06-double-entry-invariants.md:10)

   A per-transaction zero-sum rule spans rows and cannot be implemented as a normal PostgreSQL `CHECK`. It needs an explicitly designed deferred constraint trigger, a sealed database write function, or another atomic persistence boundary. Otherwise:

   - backup restore can insert one posting at a time;
   - seed/bootstrap code can bypass the service;
   - future services can insert directly;
   - a transaction containing one malformed balanced set remains committable.

   “Concurrent writes cannot commit a half-balanced transaction” is not implementable from the current task instructions. Property tests do not enforce production data.

5. **`postings` lacks basic integrity constraints.** The proposed columns omit:

   - primary key;
   - `user_id`, or an explicit decision to scope only through the transaction;
   - timestamps/order for deterministic leg display;
   - FK deletion behavior;
   - non-zero amount constraint;
   - category ownership and account ownership constraints;
   - rule that category/necessity are permitted only on the Income/Expenses counter-leg;
   - rule that all posting accounts and the header belong to the same user;
   - indexes for `(account_id, transaction_id)`, transaction hydration, date/account reports and category reports.

   This is not enough specification for the highest-risk schema change.

6. **Soft deletion is confused.** Transactions are currently soft-deleted through `transactions.deletedAt`; postings would remain physically present. [transactions.ts](/home/udai/PennyPilot/apps/api/src/services/transactions.ts:328) Task 2.6 says “soft-deleted transactions remove all their legs together” and tests “partial-delete” cases, but postings have no `deletedAt`, so there are no independently deletable legs. [tasks/02.06-double-entry-invariants.md](/home/udai/PennyPilot/tasks/02.06-double-entry-invariants.md:17)

   The actual invariant should be that every posting query joins to a live header and applies `transactions.deletedAt IS NULL`. A raw `sum(postings.amount_paise)` is wrong after the first soft delete. Task 2.1’s “balance becomes `sum(postings)`” is therefore materially incomplete.

   Restore and bulk undo also toggle the header’s `deletedAt`; they must not mutate postings. The tasks never define whether system-wide integrity totals include or exclude deleted transactions.

### P0 — Opening balances are not a simple column deletion

7. **The plan misses two distinct opening-balance models.** `accounts.ts` deliberately stores bank/cash openings as dated ledger rows but keeps card/loan/scheme openings in `accounts.openingBalancePaise`, because statement and valuation logic reads the latter directly. See `carriesOpeningAsTransaction()`, `openingBalanceRow()`, and the update planner in `updateAccount()`. [accounts.ts](/home/udai/PennyPilot/apps/api/src/services/accounts.ts:14)

   Removing both `is_opening` and `openingBalancePaise` requires redesigning:

   - opening-balance creation date;
   - correction after later transactions exist;
   - account type changes;
   - zeroing/removing an opening;
   - card carry-over absorption;
   - liability opening signs;
   - archival/deletion protection;
   - CSV/report visibility.

   Task 2.4’s word “opening balances” does not cover these flows.

8. **`cards.absorbCarryover()` directly mutates `accounts.openingBalancePaise`.** It locks the account and reconciliation, computes drift, then changes the opening column so the statement due reconciles. [cards.ts](/home/udai/PennyPilot/apps/api/src/services/cards.ts:1090) That flow must instead create or amend a dated opening-equity transaction before the statement boundary, under the same serializable/concurrency guarantees. Task 2.4 does not name `absorbCarryover()` at all.

   This is a release blocker: deleting the column makes statement carry-over absorption uncompilable and changes its audit semantics.

9. **Opening Balances is really equity, not an asset account.** The plan calls everything a “system account” without classifying it. Opening balances against bank, credit-card and loan accounts need opposite signs and must stay outside income/expense reports. A single opening counter-account can work, but only after debit/credit semantics are settled.

### P0 — EMI conversion is much more complicated than one acceptance criterion

10. **The existing EMI flow already creates separate source and principal rows.** `materializeDue()` creates the full negative payment on the funding account and a positive principal movement on the destination loan account; the remaining difference is interest expense. [recurring.ts](/home/udai/PennyPilot/apps/api/src/services/recurring.ts:235)

    The correct replacement for each installment is one transaction with:

    - funding-asset posting;
    - loan-liability principal posting;
    - Expenses posting for interest.

    But the plan does not specify sign conventions, category placement, or what happens when no destination loan account is configured. The current fallback records the full installment as an expense. Under double entry, that must become asset + Expenses, while a configured destination produces asset + liability + Expenses.

11. **`listEmiInstallments()` derives principal/interest from source-account transaction rows and chronological ordering.** [emis.ts](/home/udai/PennyPilot/apps/api/src/services/emis.ts:446) Once one header contains multiple postings, it must select the funding posting—not the loan posting or expense posting—and preserve the existing `(date, createdAt, id)` installment order. “Expressed as postings without double-counting” is too vague to prevent selecting the wrong leg.

12. **The current EMI recovery/concurrency behavior is not captured.** `materializeDue()` locks the template and account pair, tolerates stale/retyped destinations by falling back to source-only recording, and updates `outstandingPrincipalPaise` atomically. The ledger task does not state whether these semantics remain. Characterizing only aggregate totals will not protect them.

### P0 — Transfer and statement reconciliation semantics are incomplete

13. **Import transfer detection cannot simply turn two imported rows into one transaction without preserving import provenance.** An import batch is tied to one account, and rollback operates on transaction IDs associated with its rows. [imports.ts](/home/udai/PennyPilot/apps/api/src/services/imports.ts:600) If a detected transfer combines rows from two independently committed batches:

    - which batch owns the header?
    - does rolling back either batch delete the whole transfer?
    - how are both `import_rows.transactionId` links represented?
    - what happens when only one side is imported?
    - how does “keep anyway” interact with later matching?

    Task 2.2 says only that detection produces one transaction. That is not enough.

14. **Statement reconciliation is account-leg-specific, but the stamp is header-wide.** `transactions.reconciledStatementId` currently works because a transaction belongs to exactly one account. [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:359) After conversion, a transfer or repayment header can touch two accounts and potentially two statements. One header column cannot represent reconciliation of a specific posting against a specific card statement.

    `recomputeReconciliation()` clears and applies the stamp while filtering `transactions.accountId`; that column disappears. [cards.ts](/home/udai/PennyPilot/apps/api/src/services/cards.ts:900) Reconciliation must move to the relevant posting, or to a separate posting/statement match table. The plan does not mention this.

15. **Statement matching must match the account posting amount, not a header amount.** `inbox.ts`, `imports.ts`, and card reconciliation currently compare `transactions.amountPaise` and `accountId`. For a three-leg EMI or split transaction there is no meaningful header amount. Task 2.4’s generic conversion language does not define which posting qualifies, how multiple same-account postings are handled, or whether system legs are excluded.

16. **`transaction_links` are not `transfer_links`.** The former records semantic refund/repayment relationships and remains a real feature. [transaction-links.ts](/home/udai/PennyPilot/apps/api/src/services/transaction-links.ts:1) The ledger tasks discuss deleting `transfer_links` but never say how `transaction_links` behave when one header has multiple financial legs. Links may remain header-to-header, but refund amount logic must identify the relevant expense/card posting rather than assume one amount per row.

### P1 — Pagination, filtering and API compatibility are not preserved

17. **Cursor pagination over headers is fine only if filtering does not duplicate headers.** `listTransactions()` currently paginates a single table by `(date, createdAt, id)`. [transactions.ts](/home/udai/PennyPilot/apps/api/src/services/transactions.ts:169) Joining postings for account/category/amount filters can return one header multiple times—especially splits and N-leg transactions—breaking page size, totals and cursor continuity.

    The conversion needs `EXISTS` filters or a distinct-header subquery. The plan does not state this. The search-ranked order is also different from the cursor order and already disables next cursors for search; that behavior needs explicit preservation.

18. **Header totals have no obvious meaning.** `TransactionPage` currently returns `totalAmountPaise`, inflow and outflow over filtered transaction rows. [transactions.ts](/home/udai/PennyPilot/apps/api/src/services/transactions.ts:191) With balanced headers, summing all postings is always zero. The API must define totals relative to:

    - the selected account posting;
    - Income/Expenses postings;
    - all user-visible asset postings;
    - or a compatibility “primary posting.”

    Task 2.5 claims the old API shape remains but never defines the old read shape for transfers, splits, account-filtered lists, or unfiltered totals.

19. **The “common UI almost unchanged” claim is implausible.** Existing `Transaction` consumers expect `accountId`, `amountPaise`, `categoryId`, `necessity`, splits and transfer fields. Removing them from the header while merely “exposing postings” is not typed-schema churn; it changes display, filtering, bulk recategorization, task transaction pickers, account ledgers, card activity, attachments and search. Either the server must return explicit compatibility-derived fields or substantially more web code changes.

20. **Bulk category changes are ambiguous.** `bulkAction(setCategory)` currently updates one header field. [transactions.ts](/home/udai/PennyPilot/apps/api/src/services/transactions.ts:370) In a split, should it replace all Expenses posting categories, only an unsplit primary counter-leg, or reject? Undo snapshots currently save one category. Task 2.5 does not decide.

21. **`setSplits` cannot safely “replace the whole posting set” without defining preserved legs.** It must replace only category-bearing counter-postings while retaining the account leg, policy/resource/SIP provenance and any liability leg. For an EMI or transfer, replacing the whole set is destructive. Task 2.3’s wording is bad.

### P1 — Capital gains, SIPs, goals and one-movement queries are under-scoped

22. **Tax lots do not use `transactions`; saying they are “ready” for tax-aware rebalancing overstates integration.** Capital gains derive from `holdingEvents`, which remain a separate investment event ledger. [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1370) A sale can therefore have a holding event and a cash transaction with no durable one-to-one linkage. Double entry does not solve that. Tax-aware switching still needs an explicit proposed holding disposal and event-level tax treatment.

23. **MF SIP recording also does not create a ledger transaction.** `recordSipInstallment()` creates a `holdingEvents` buy, whereas account-target SIPs link an existing transaction using `transactions.sipId`. The plan’s statement that “SIP installment recording” produces balanced postings conflates two different paths.

24. **Account-target SIP eligibility must identify the target-account posting.** `linkSipInstallment()` and candidate queries currently require `transaction.accountId === target`, positive amount, non-opening, and unclaimed `sipId`. [sips.ts](/home/udai/PennyPilot/apps/api/src/services/sips.ts:781) After conversion, `sipId` on the header may claim a transfer containing both source and target. The eligibility rule must identify and validate the positive target posting. The task does not say whether `sipId` belongs on the header or posting.

25. **Goal contribution calculations assume one positive transaction movement.** `goals.ts` sums positive transactions in goal-linked accounts. With postings it must sum only appropriate asset postings while excluding openings, internal reallocations, refunds and possibly loan/card movements. A transfer between two accounts assigned to the same goal must not count twice; a transfer into a goal from an unassigned account may or may not represent a contribution. Task 2.4 says “convert goals” but provides no semantics.

26. **`userTasks` transaction previews need a display-leg rule.** `taskQuery()` currently returns one account and one amount from the linked transaction. [user-tasks.ts](/home/udai/PennyPilot/apps/api/src/services/user-tasks.ts:77) An N-leg header needs either all postings or a deterministic summary. This is not just changing a join.

27. **Card activity must select only the card posting.** `getCardActivity()` currently returns one row per card movement and computes `unbilledSpendPaise` from that row’s sign. [cards.ts](/home/udai/PennyPilot/apps/api/src/services/cards.ts:440) Joining all postings would create extra rows and count expense/loan legs. The same issue affects EMI installment lists, SIP candidate lists, account ledgers, import duplicate detection and statement matching.

### P1 — Backup/restore round-trip is not designed

28. **Adding `postings` to `ALL_TABLES`/`USER_TABLES` is insufficient.** `postings` will likely have no `user_id`, so it belongs in `LINKED_TABLES` under `transactions`, not `USER_TABLES`. [backup.ts](/home/udai/PennyPilot/apps/api/src/services/backup.ts:28) Task 2.1 explicitly says `ALL_TABLES/USER_TABLES`, which is factually misleading.

29. **Restore order conflicts with zero-sum enforcement.** [restore.ts](/home/udai/PennyPilot/apps/api/src/db/restore.ts:61) inserts rows individually in `ALL_TABLES` order. If balance is checked after each posting insert, every multi-leg transaction fails on its first leg. If enforcement is deferred to transaction commit, it can work, but the task must say so. Per-user restore has the same problem. [restore-user.ts](/home/udai/PennyPilot/apps/api/src/services/restore-user.ts:116)

30. **Portable restore remaps `user_id` but not system-account identity.** A restored archive can contain old system-account UUIDs while signup has seeded new ones, and restore currently deletes seeded user tables before inserting archive rows. The plan must decide whether system accounts are backed up/restored verbatim or recreated and posting references remapped. It says neither.

31. **Transaction CSV export becomes undefined.** `transactionsCsv()` currently exports one account/category/amount row. [backup.ts](/home/udai/PennyPilot/apps/api/src/services/backup.ts:121) An N-leg header cannot fit that shape without either one row per posting, one row per user-facing movement, or derived compatibility columns. Task 2.4 says only “backup round-trips postings”; exports are omitted.

### P2 — The prior review’s backup warning was not adequately actioned

The first review explicitly warned that table-coverage tests do not prove semantic restorability. The response added “backup round-trips postings correctly,” but did not specify restore ordering, deferred invariant enforcement, system-account remapping, deleted-header semantics, or CSV behavior. That response is not adequate.

---

## 2. UI tasks are not executable unattended

### Systemic blockers in `UI.md`

1. **The “three coordinated edits” rule is wrong.** Every new route also requires a fourth edit in `apps/web/src/main.tsx`: lazy import plus router child. [main.tsx](/home/udai/PennyPilot/apps/web/src/main.tsx:124) Adding only `NAV_GROUPS`, `IconName`, and `PAGES` creates navigation to the wildcard `NotFound`. [tasks/UI.md](/home/udai/PennyPilot/tasks/UI.md:44)

2. **`NAV_GROUPS` and `PAGES` are not exported.** An unattended agent cannot test them directly without changing structure or using source-text tests. UI.md’s claim that the build catches an “unreachable route” is false: Vite will happily build a nav link with no matching route.

3. **UI.md forbids arithmetic “in the component” but does not define the boundary.** Display-only sums, percentage formatting and derived labels will be interpreted inconsistently. It should say that domain calculations live in shared/service code, view-model derivation in tested sibling modules, and JSX may only map/format already-derived values.

4. **Demo handling is underspecified.** The app exposes `me.isDemo` in `AppLayout`, but UI.md does not state whether mutation controls should be hidden, disabled, or replaced with explanatory text. Individual tasks will guess.

5. **There is no UI component-testing stack.** `apps/web` uses `node --test`; it has no DOM renderer, Testing Library or browser/E2E harness. Requirements such as focus trapping, Escape behavior, mobile camera opening, keyboard focus and responsive layout cannot be covered as “every acceptance criterion is a test” under the stated no-new-dependency policy.

6. **The recommended modal is not a complete focus-trap primitive.** Copying `RecordEpfModal.tsx` gives dialog attributes but does not settle reusable focus restoration, tab cycling, nested popovers or background inertness. UI.md asserts focus trapping without giving working infrastructure.

### Task-by-task verdict

- **2.7 Transaction postings UI — not executable.** Paths are incomplete: `TransactionDrawer.tsx` needs its full `src/routes/transactions/` prefix, and the task omits `AccountLedgerPage.tsx`, which is the actual account movement surface. More importantly, there is no posting contract, no system-account discriminator, no “plain two-leg” predicate, no derived compatibility amount, no update semantics, and no rule for which postings a split editor may replace. “Surface the server error” conflicts with an unattended UI that cannot know the error contract. [tasks/02.07-transaction-postings-ui.md](/home/udai/PennyPilot/tasks/02.07-transaction-postings-ui.md:12)

- **4.6 Household switcher — not executable.** It omits `main.tsx`; does not specify routes, active-household persistence, whether users can belong to multiple households, invite token entry versus URL acceptance, owner-leave behavior, last-member behavior, role permissions, or the API contracts. “No household” versus the app’s stated single-household model is also unclear. [tasks/04.06-household-switcher-ui.md](/home/udai/PennyPilot/tasks/04.06-household-switcher-ui.md:11)

- **4.7 Sharing controls — not executable.** It does not name the exact transaction-drawer path, sharing API, record-type contract, cascade semantics or permission model. It says one identical control everywhere even though account sharing cascades to transactions while goals/budgets/individual transactions have different effects. That requirement is likely wrong, not merely vague. [tasks/04.07-sharing-controls-ui.md](/home/udai/PennyPilot/tasks/04.07-sharing-controls-ui.md:13)

- **4.8 Split modal — not executable.** It does not define whether the payer is included, who owns rounding remainder, how shares are entered, whether exact amounts include the payer’s share, refund/income eligibility, editing after settlement, or what “zeroes that pair” means. These are precisely the ambiguities flagged in review 1 and they remain unresolved. [tasks/04.08-split-modal-ui.md](/home/udai/PennyPilot/tasks/04.08-split-modal-ui.md:13)

- **7.1 Goal roadmap — not executable.** The task does not define the 5.1 response schema, panel placement, goal selection behavior, required contribution meaning at a switch point, or how inflation is obtained—the current `projectionSettings` schema shown in `schema.ts` contains only `equityReturnBps`, despite plan prose claiming per-user return/inflation assumptions. [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:28)

- **7.2 Instrument guidance — not executable.** No query file or integration file is named, despite the panel requiring per-goal and current-holdings data. “No named product” is ambiguous because existing holdings necessarily have scheme names; the task must distinguish recommendation text from the user’s own holdings. A backend test cannot prove arbitrary rendered rationale contains no product name.

- **7.3 Allocation/levers — not executable.** It gives no parent integration file, API/query path, definition of “combinations explorable,” permitted controls, recalculation boundary, or persistence rule. That phrase alone can produce anything from four sliders to a scenario builder. [tasks/07.03-allocation-levers-ui.md](/home/udai/PennyPilot/tasks/07.03-allocation-levers-ui.md:20)

- **7.4 Rebalancing — not executable.** It omits the parent `GoalsPage.tsx` and query hook. It does not define the comparison threshold for “tax consequence outweighs drift,” nor whether that decision comes from 6.7 or the UI. “Cash held in an emergency fund” requires a stable goal-kind contract that is not cited.

- **12.1 Shopping lists — not executable.** It creates four nav destinations but names only `ListsPage.tsx`; Cart, Pantry and Price Watch are implemented by later tasks. Adding all four links now creates three dead routes. It also omits `main.tsx`, exact route paths, reorder interaction, archive visibility, photo endpoint/response and ambiguous-match contract. [tasks/12.01-shopping-lists-ui.md](/home/udai/PennyPilot/tasks/12.01-shopping-lists-ui.md:10)

- **12.2 Cart review — not executable.** It depends only on 11.3 but consumes 10.2 serviceability, 10.6 reward-aware recommendations and pending-cart data. Those are transitive in part, but the task still lacks route registration, query file, mutation endpoint, draft edit contract, accept semantics and sidebar badge plumbing. It says to copy a 530-line page without identifying which pieces are appropriate—a recipe for inconsistent duplication.

- **12.3 Pantry/price watch — not executable.** It omits query hooks and route registration. “I still have plenty” has no defined payload or quantitative meaning, and “visibly affects” the learned rate does not say immediately versus after subsequent observations. Thin-data minimum and confidence vocabulary are not specified.

- **13.14 Tax surface — not executable.** It consumes AIS/26AS discrepancies but does not depend on 13.13. It has no dependency on payslip/fixed-income/EPF tasks needed to populate the displayed buckets. It omits `main.tsx`, review mutation contracts and FY selection behavior. It also states four buckets while 80D commonly needs internally distinct cap treatment; whether that is handled in the backend contract is unstated. [tasks/13.14-tax-surface-ui.md](/home/udai/PennyPilot/tasks/13.14-tax-surface-ui.md:7)

- **14.5 Protection surface — not executable.** It creates Calendar and Dossier routes but omits `main.tsx`, query hooks and exact nav labels/routes. “Dossier exportable via the existing encrypted backup path” is not a UI acceptance criterion the described pages can satisfy: existing backup exports the whole user archive, not a human-readable continuity dossier. It also depends on 14.4 but not directly on 13.12/ELSS disposal data needed for per-installment unlocks.

- **15.3 Debt/windfall — not executable.** It omits query hooks and the parent `GoalsPage.tsx`. It does not define inputs, scenario controls, whether calculations are live or persisted, or the decision threshold for emergency-fund-first/high-interest-debt-first. “Interest saved is certain” also needs qualification when loans have floating rates, prepayment penalties or tax effects.

- **16.5 Everyday savings — not executable.** It supplies no route, nav integration or query paths. The backend tasks do not clearly provide recurring commute/repeat-order classification, metro-pass cost data, or “money left on the table by card.” The example introduces an external alternative-price datum with no source model. An agent must invent it.

- **17.3 Portfolio integrity — not executable.** It does not define how fraud findings enter `InboxPage`, even though the existing inbox is built around `extractedTransactions`, not a generic review-item union. The task omits the shared schema, query changes, dismissal mutation and badge-count semantics. “After-tax return where available” lacks an availability contract and depends on tax results beyond the stated 17.1 dependency.

**Bottom line:** none of the 16 tasks is safely unattended as written. Some may become implementable after inspecting completed backend work, but that contradicts the board’s claim that each task is self-contained with exact paths and settled decisions.

---

## 3. TDD approach gaps

1. **“Every acceptance criterion is a test” is impossible.** Criteria such as neutral tone, “looks like a real answer,” mobile layout verified, no fear framing, workings shown prominently, and “groceries notices no difference” are review requirements, not automatically executable tests. [tasks/TDD.md](/home/udai/PennyPilot/tasks/TDD.md:16)

2. **There is no property-testing library.** Neither root nor workspace dependencies include `fast-check` or an equivalent. The document repeatedly requires generated/property tests but never authorizes a dependency or defines the generator/shrinking approach. Hand-written loops are fuzz examples, not proper property tests.

3. **The one-file command is unreliable for DB tests.** `node --test apps/api/src/services/foo.test.ts` does not itself provision/migrate Postgres or Redis. CI may, but the documented local inner loop assumes external infrastructure is already running and initialized. TDD.md should state that prerequisite.

4. **A route-table snapshot cannot prove API identity.** It can prove method/path registration, not request/response schemas, status codes, auth hooks, prefix behavior, error shapes or side effects. Calling it the highest-value proof that “all 155 URLs stay byte-identical” overstates what it can establish.

5. **Existing tests are not automatically the specification for a deliberate ledger-model change.** Task 2.4 says no expected value may change. That is untenable where behavior intentionally changes:

   - transfers go from two listed rows to one header;
   - unfiltered transaction count changes;
   - net transaction totals need new semantics;
   - CSV output may become posting-based;
   - opening rows change representation;
   - transaction responses gain postings and lose or derive old fields;
   - reconciliation moves from header/account to posting/account.

   Tests for old representation must change. The correct rule is to preserve domain outcomes, not freeze obsolete wire and row-count behavior.

6. **“Do not rewrite tests in the same commit” clashes with module migration.** Imports necessarily change when files move. If tests import implementation symbols from old flat paths, they must be edited with the move. The useful prohibition is against changing assertions and fixtures without an explained intentional behavior change—not against any test edit.

7. **Characterization tests written immediately before a refactor can encode existing bugs.** The code already contains representation-specific behavior. For example, transaction totals include transfers unless particular callers exclude them, and card/loan openings deliberately differ from bank openings. Characterize externally required semantics, not every current result.

8. **Ledger property tests miss persistence invariants.** A pure generator proving a constructor returns zero-sum postings does not prove that:

   - direct SQL cannot insert imbalance;
   - FK ownership is preserved;
   - soft-deleted headers are excluded;
   - restore commits only balanced sets;
   - concurrent posting replacement is serializable;
   - system accounts cannot be archived;
   - account totals remain safe integers.

   Those need real-DB invariant and concurrency tests.

9. **The “whole ledger sums to zero” property is nearly tautological.** If every included transaction sums to zero, the whole included ledger does too. Higher-value properties are per-user isolation, live-header filtering, category/system-leg restrictions, account balance under deletion/restore, and immutable posting-set replacement.

10. **Backup coverage is mislabeled as a money invariant.** `backup covers every table` is schema-drift coverage, not a generated money property, and review 1 already explained that it does not prove semantic restore.

11. **UI behavior is largely untestable with the current stack.** Pure view-model tests can cover math and selection, but not dialogs, focus traps, command-palette reachability, mutation flows, camera inputs or responsive overflow. The plan needs either a browser/component-test layer or explicit manual/visual acceptance gates. Pretending `node --test` covers these is bad process.

12. **Migration tests need version-boundary treatment.** Because the DB is recreated, tests and fixtures that insert old transaction columns must change at the schema cut. They cannot all remain green during intermediate commits unless the work is kept atomic or temporary compatibility schema exists. The release plan does not define that boundary.

---

## 4. Sequencing and release-split problems

1. **Doing module migration and ledger conversion in one continuously shipped line is high-risk.** The plan says to keep shipping `1.95 → 1.9x` as tasks land. But after task 2.1 changes the schema, the app is unusable until all writers, readers, contracts and web consumers are converted. That is not continuously shippable. Tasks 2.1–2.7 need an atomic integration branch or explicit compatibility stages.

2. **The module migration first doubles churn rather than preventing it.** Phase 1 moves every ledger consumer, then phase 2 rewrites it. “Nothing gets touched twice” is factually false. Services such as cards, recurring, imports, inbox, SIPs and transactions are necessarily edited during both phases. A safer split is:

   - establish module boundaries and route gate;
   - design/freeze ledger contracts and invariants;
   - migrate each ledger-owning module directly into its final posting implementation;
   - move genuinely unaffected modules separately.

3. **Task 2.6 is too late.** Storage-level invariants, deferred enforcement and concurrency strategy must be designed in 2.1, before any writer exists. An on-demand integrity checker can come later, but atomic zero-sum persistence cannot.

4. **Task 2.7 does not gate release.** `3.1` depends only on `2.6`; `3.2` depends only on `3.1`. Therefore 2.0.0 can release without the only ledger UI task. That is an actual dependency bug. `3.1` or `3.2` must depend on 2.7.

5. **Task 2.6 does not depend on 2.2/2.3/2.4 except transitively through 2.5, but 2.5 itself depends on the entire conversion.** This serializes almost all ledger work unnecessarily and postpones invariant testing. Schema/contracts, reader conversion and integrity tooling can be developed in parallel once the accounting design is fixed.

6. **Household tasks depend on 1.9 instead of the shipped ledger foundation.** Tasks 4.1/4.2 can theoretically start after module migration while ledger conversion is incomplete, even though household splits and sharing operate on the final transaction/posting model. They should depend on 3.2 or at least 2.6/2.7.

7. **Shopping schema depends on `4.3` sharing guard but not on the released household API/model.** If pantry is genuinely household data, `9.1` should depend on the complete household schema/API semantics, not only a guard function.

8. **Tax UI misses 13.13.** It promises AIS/26AS reconciliation but `depends` omits the task that implements it. This directly violates the task graph.

9. **Protection dossier export has a hidden backend dependency.** Task 14.5 promises dossier export through backup, but 14.4 does not necessarily modify the archive into a user-consumable dossier. That requires its own backend/export task and shared contract before the UI.

10. **Portfolio integrity UI has a hidden inbox-platform dependency.** The existing inbox is not generic. Before 17.2/17.3, a task must generalize the review queue contract, counts, dismissal and rendering. Depending only on “fraud review” leaves architectural work hidden inside a UI task.

11. **Performance attribution is scheduled too late if rebalancing depends on honest contribution-versus-return analysis.** 2.2.0 gives actionable rebalancing advice before 2.8.0 separates contributions from market movement. At minimum, the portfolio cash-flow linkage needed for rebalancing should move earlier, even if the full attribution UI stays later.

12. **Tax-aware rebalancing is too early.** Task 6.7 ships in 2.2.0 before the 2.4.0 tax-rule data, fixed-income classification, taxable-income ledger, brought-forward losses and harvesting planner. Labeling gains as not-final-tax in the UI does not make the recommendation safe. Either move 6.7 after phase 13 or restrict it explicitly to holding-period/realized-gain disclosure with no tax-cost decision.

13. **Insurance adequacy depends on income model but not data completeness.** It should depend on 6.3; otherwise it can produce precise Human Life Value advice from known-incomplete income/liability data—the exact risk review 1 raised.

14. **Fraud/duplicate review depends on data completeness but not statement reconciliation/card debt detection.** Missing refunds and post-cancellation charges require transaction relationships, recurring history and reconciliation coverage. The dependency graph does not capture them.

15. **Release summaries are internally stale and cannot be trusted as execution metadata.** See factual errors below.

---

## 5. Factual errors and inadequate prior-review responses

1. **`ROADMAP.md` was not updated for the new roadmap.** It still says “53 tasks across four releases,” describes 2.0.0 as 44 tasks containing household, planning, vision and shopping, and assigns tax to 2.1.0. [ROADMAP.md](/home/udai/PennyPilot/ROADMAP.md:91) The actual board says 94 tasks across nine releases and foundation-only 2.0.0. This is the largest factual error in the documents the requester named.

2. **`tasks/README.md` has stale release prose immediately below the correct table.** Lines 29–35 call 2.1 tax, 2.2 protection, 2.3 debt and 2.4 everyday savings, contradicting the table above, where those are 2.4, 2.5, 2.6 and 2.7. [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:29)

3. **Those stale paragraphs cite obsolete task IDs.** They refer to the income model as 5.1, multi-goal engine as 5.2, regime comparison as 11.4 and adapter model as 14.1. Current IDs are 6.1, 6.4, 13.8 and 16.1.

4. **The non-negotiables cite wrong enforcement tasks.** `tasks/README.md` says named-product prohibition is enforced in 4.2 and UI 9.3; current relevant tasks are 5.2/5.3 and 7.2. [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:85) It also says adapter task 14.1; current adapter task is 16.1.

5. **The task count claim “94” is itself inconsistent with the index.** The release table totals 94, but the listed task files total 97: 21 + 8 + 15 + 20 + 14 + 5 + 3 + 5 + 3 = 94 is arithmetically correct; however the board also contains three phase-0 tasks within the 21, so the count is consistent only if all listed rows match. The more serious problem is `ROADMAP.md` still says 53. The documents need one generated source of truth rather than hand-maintained prose.

6. **“All findings are now actioned” is false.** [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:199)

   Several review-1 findings were only copied into “Known traps,” not resolved in task acceptance criteria:

   - arbitrary per-record sharing remains despite the warning that one guard is inadequate;
   - household split sign/refund/settlement semantics remain unspecified;
   - cross-user settlement still cannot reuse `createTransfer()`;
   - investment-account/NPS allocation remains too coarse for actionable switches;
   - holding-wide SGB tax treatment remains inadequate;
   - tax provenance/source priority remains unspecified;
   - UI and task wording still overstate backup coverage;
   - data-source concerns were answered with adapter architecture, which does not create actual price data.

   Recording a trap is not actioning it.

7. **The response to shopping’s missing durable data source is inadequate.** A pluggable adapter interface and serviceability model solve extensibility, not data availability, legality, freshness, geographic coverage or trust. The plan still calls it a “live Indian comparator” while excluding scraping and naming only user entry, receipt OCR and unspecified official affiliate APIs. [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:35) That claim is unsupported.

8. **“No task depends on a task in a later release” is technically true but misleading.** Missing dependencies do not validate sequencing. Tax UI consuming AIS reconciliation without depending on 13.13 is the clearest example.

9. **“Two sources of truth” misdescribes current bank/cash behavior.** `createAccount()` zeros `accounts.openingBalancePaise` when it seeds a bank/cash opening transaction. The code deliberately avoids counting both sources for those account types. [accounts.ts](/home/udai/PennyPilot/apps/api/src/services/accounts.ts:180) Cards/loans/schemes retain column-based openings. The real problem is heterogeneous balance representation, not universal double-counting.

10. **The claimed “25 exclusion call-sites” is not substantiated by current direct service references.** The code has `isTransferSql()` plus multiple callers, but the plan presents an exact number without defining whether it counts references, queries or service files. Exact blast-radius numbers should be generated, not asserted in prose.

11. **`is_opening` is not redundant with `openingBalancePaise` in the current design.** For bank/cash it marks a real ledger row; for cards/loans/schemes the column remains authoritative. Treating both as two interchangeable sources hides the account-type distinction.

12. **`projectionSettings` does not currently hold both return and inflation assumptions as claimed.** The schema shown contains only `equityReturnBps`; no inflation column appears in `projectionSettings`. [schema.ts](/home/udai/PennyPilot/apps/api/src/db/schema.ts:28) The roadmap/UI prose should cite the actual source of inflation or stop claiming it is already per-user there.

13. **“Every automated path produces reviewable drafts” is already false for recurring materialization.** `materializeDue()` writes recurring and EMI transactions directly to the ledger. [recurring.ts](/home/udai/PennyPilot/apps/api/src/services/recurring.ts:209) The non-negotiable is true for AI/extraction paths, not every automated path.

14. **UI.md says every route directory already extracts decision logic.** Many route directories contain no sibling tested logic module. It is a desirable convention, not a factual description of every route.

15. **UI.md says the build catches unreachable-route mistakes.** TypeScript/Vite cannot infer that a string in `NAV_GROUPS` lacks a React Router entry. Only a route/nav consistency test could catch that, and none is specified.

16. **TDD.md’s test counts and source LOC are volatile hand-maintained facts.** They may have been true when written, but they should not be normative documentation. More importantly, the actual repository has no property-testing dependency despite the document treating generated properties as established infrastructure.

17. **`ROADMAP.md` still says the product framing is “over double-entry bookkeeping.”** [ROADMAP.md](/home/udai/PennyPilot/ROADMAP.md:14) That is defensible as user-facing positioning, but now that 2.0.0’s core deliverable is explicitly a double-entry ledger, the wording is confusing and should distinguish internal accounting architecture from product UX.

The foundation-first restructuring is directionally sensible. The double-entry phase, however, is not ready to execute. It currently specifies a zero-sum data shape, not a complete accounting model, and it misses several concrete behaviors the existing code carefully implements. Shipping from these tasks would produce a ledger that can balance mathematically while still being wrong financially.