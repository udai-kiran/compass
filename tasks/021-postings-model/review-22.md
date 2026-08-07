Review target: `tasks/021-postings-model/PLAN-pr-c.md`

Exit code: 1

## Findings

### BLOCKING — `incomeExpense` is not legacy-equivalent for mixed-sign splits

The parity proof at lines 23–35 and the PC3 query at lines 123–149 assume that summing Income/Expenses counter-postings is equivalent to classifying the parent transaction amount. That is false for mixed-sign splits, which the real code permits.

`setSplits` only requires the split amounts to sum to the parent amount; it does not require every split to share the parent’s sign. `buildSplitPostings` independently maps each negative split to Expenses and every non-negative split to Income.

For example:

- Parent transaction: `t.amount_paise = -70`
- Splits: `-100`, `+30`
- Legacy `incomeExpense`: expense `70`, income `0`
- Proposed PC3: expense `100`, income `30` on a non-liability account

The reverse discrepancy occurs for a positive parent containing a negative split.

This also invalidates the plan’s split fan-out claim for `incomeExpense`: although the SQL joins correctly produce one row per system posting, that is the wrong aggregation grain for this function. The overall strategy correctly says `incomeExpense` should classify the single real posting. PC3 should anchor or join exactly one `system_kind IS NULL` posting per transaction and apply the legacy sign and liability rules to that real posting. T4 must include mixed-sign splits.

### WARNING — Clearing and `transfer_links` are equivalent only under the application invariant

For valid, reconciled dual-write state, the predicates are equivalent:

- Manual and automatic linking insert `transfer_links` and rebuild both legs to Clearing within the same database transaction.
- Unlinking deletes the link and rebuilds both legs to ordinary/split shape within the same transaction.
- Auto-link invalidation captures both legs, deletes the link, and rebuilds affected postings atomically.
- Import rollback captures surviving partners before hard deletion and rebuilds them after the link cascades away.
- Re-linking passes through those same atomic unlink/link transitions.
- A surviving leg after a supported hard-delete workflow is therefore ordinary, with neither a link nor Clearing posting.

However, the equivalence is not enforced by the schema. A direct `DELETE` of one transaction cascades the `transfer_links` row and the deleted leg’s postings, but no database trigger rebuilds the surviving leg. Direct SQL can therefore leave:

- a surviving transaction with a Clearing posting but no `transfer_links` row; or
- after direct link manipulation or stale data, a `transfer_links` row without corresponding Clearing postings.

The repository’s DB-backed tests contain direct hard-delete helpers. Such drift is outside the promised writer graph and should be caught by reconciliation, but the plan should state that PC1/PC2/PC3 rely on the PR-A posting-shape invariant and should add lifecycle parity cases for auto-link, unlink/re-link, and supported hard-delete/orphan handling.

### NOTE — Using `t.account_id` for D4 is consistent in valid dual-write state

`updateTransaction` can change `account_id`, but it updates the transaction and rebuilds postings from the resulting row inside the same database transaction. It also locks the row and prohibits account/amount changes while it remains linked as a transfer.

For all supported shapes:

- Ordinary: the real posting is built from `t.account_id`.
- Split: the one real posting uses the parent `t.account_id`; all split counter-postings refer back to that same parent account.
- Updated transaction: the transaction column and rebuilt real posting change atomically.

Thus `t.account_id` cannot disagree with the real posting after a successful supported mutation. It can disagree only in already-inconsistent or directly modified data, which violates the reconciliation gate.

Using the real posting would nevertheless align more directly with `PLAN-dualwrite.md` and is required to fix the mixed-sign split blocker.

### NOTE — Opening rows cannot produce Income or Expenses postings

`buildOpeningPostings` returns exactly:

- one real-account posting with `amountPaise`; and
- one Opening-system posting with `-amountPaise`.

It does not invoke the ordinary or split classifier and cannot create an Income or Expenses posting. `computePostingDraftsForTransaction` also checks `isOpening` before transfer, split, or ordinary shape. PC5 is correct for invariant-compliant data.

### NOTE — Expense/Income posting signs and the Expenses filter are correct

For valid builder output:

- An ordinary negative transaction produces an Expenses posting of `-t.amount_paise`, which is positive.
- A negative split produces an Expenses posting of `-split.amount_paise`, which is positive.
- An ordinary positive transaction produces a negative Income posting.
- A positive split produces a negative Income posting.
- Zero is classified as Income and produces an Income posting with amount `0`.

Therefore every Expenses posting produced by the builders is strictly positive. Income postings are negative for positive inputs but can be zero for a zero-amount input.

`p.amount_paise > 0` in PC1/PC2 correctly mirrors the legacy `amount_paise < 0` predicates. It is redundant for valid nonzero Expenses postings but useful as an explicit semantic and defensive filter. It must not be added to PC3 as a substitute for classifying the real posting.

### NOTE — PC3 currently fans out once per system posting

For a split transaction with `N` counter-postings:

- `postings p` supplies `N` Income/Expenses rows.
- Each posting joins one parent transaction.
- `JOIN accounts a_real ON a_real.id = t.account_id` finds exactly one account row.
- Result cardinality remains `N × 1 = N`, not `N²`.

Thus the join itself does not duplicate each posting. Summing Expenses postings counts each negative split once. That is appropriate for `spentByCategory` and `spendByNecessity`, whose legacy queries operate per split, but not for `incomeExpense`, whose legacy query counts the parent transaction once.

### NOTE — Zero-amount behavior is correct

`buildOrdinaryPostings` allows zero and classifies it to the Income system account, producing a zero-valued Income posting. It does not produce an Expenses posting.

Consequently a zero-amount row is absent from PC1/PC2 because no Expenses posting exists. Even if malformed data contained a zero Expenses posting, `p.amount_paise > 0` would exclude it. This matches the legacy strict-negative spend predicate, and its numerical contribution would be zero regardless.

The T4 wording should say that zero is classified as a zero-valued Income counter-posting and contributes nothing, rather than implying it is an expense posting filtered by amount.

### NOTE — The EMI destination principal leg is handled correctly

The recurring EMI creates two independent ordinary transaction families, not a transfer:

- Source bank leg: negative amount → positive Expenses posting.
- Destination loan principal leg: positive amount → negative Income posting.

PC1/PC2 select only Expenses postings, so the positive destination loan leg is excluded from spend.

PC3 sees its Income posting but D4 excludes it because `t.account_id` resolves to a `loan`, which is a liability type. The source leg remains expense. This preserves the behavior asserted by `recurring.test.ts` AC9.

### WARNING — T4 should explicitly include the EMI scenario

The existing `recurring.test.ts` AC9 test will exercise the converted implementation and already protects `incomeExpense` and `spentByCategory` for an EMI destination principal leg. It does not cover `spendByNecessity`, and it does not compare all three posting-based results to independently computed legacy SQL.

T4 should include the EMI fixture explicitly because it is a domain-specific non-transfer positive liability leg that resembles one side of a transfer but must follow different rules. It should assert:

- the full source installment appears in category and necessity spend;
- the destination principal leg appears in neither spend function;
- destination principal is excluded from income by D4; and
- no Clearing posting or `transfer_links` row exists for either EMI transaction.

### WARNING — Scope should include correcting stale `periods.ts` documentation

The three intended functions are the complete shared-reader conversion scope. All identified callers invoke these functions and inherit the new behavior; direct legacy SQL in other planning/credit modules belongs to later PRs.

However, the documentation inside `spendByNecessity` currently says it runs two statements and discusses the split-add/remove race. PC2 changes it to one statement, making that comment false. The plan’s “NOTHING else” wording should still permit updating comments within `periods.ts`.

The `LIABILITY_TYPES_SQL` comment also says queries alias accounts as `a`; PC3 proposes `a_real`. That comment should be generalized or updated.

### WARNING — Existing tests may pass while the mixed-sign regression remains undetected

The cited recurring and inbox tests should continue passing:

- Recurring AC9 is compatible with the proposed Expenses filter and D4.
- Inbox AC5 continues to exclude linked transfer legs through Clearing.

The principal regression risk is false confidence: ordinary, same-sign split, transfer, opening, deletion, and EMI fixtures can all pass while PC3 remains wrong for mixed-sign splits. T4’s proposed “3 splits with distinct categories” must deliberately include mixed signs or add a separate mixed-sign case.

There is also a test-maintenance risk where tests directly insert/update/delete legacy tables without rebuilding postings. Any such fixture that calls the converted readers must either use the service layer, explicitly construct valid postings, or run reconciliation first.