Review target: `tasks/021-postings-model/PLAN-pr-c.md`

Exit code: 1

## Findings

### WARNING — T4 still does not cover the full transfer lifecycle requested by review-22

Review-22 requested lifecycle parity for auto-link, unlink/re-link, and supported hard-delete/orphan handling. Iteration 2 adds:

- an auto-linked pair; and
- an unlink case where both legs revert to ordinary postings.

It does not explicitly cover:

- re-linking the unlinked pair and confirming both legs become excluded again; or
- a supported hard-delete/import-rollback path where the surviving partner is rebuilt without a Clearing posting.

Because Clearing versus `transfer_links` equivalence depends on application-maintained lifecycle invariants rather than a schema constraint, these remain meaningful regression cases. T4 should add both, or explicitly narrow and justify the lifecycle coverage requirement.

### WARNING — T4 covers only one direction of the mixed-sign split regression

The added mixed-sign fixture has a negative parent:

- parent `-70`
- splits `[-100, +30]`
- legacy result: expense `70`, income `0`

This catches counter-posting fan-out on the expense side. The reverse permitted shape—a positive parent containing a negative split—is not covered. For example:

- parent `+70`
- splits `[+100, -30]`
- legacy result: income `70`, expense `0` on a non-liability account
- counter-posting aggregation would incorrectly produce income `100`, expense `30`

PC3’s real-posting SQL handles this correctly, so this is a test-coverage warning rather than a design defect. Add the reverse fixture to protect both branches of the aggregate.

### NOTE — The review-22 BLOCKING finding is resolved

PC3 now selects exactly the real posting with `a.system_kind IS NULL`. Under the posting-shape invariant, every transaction has one such posting and its amount and account equal `t.amount_paise` and `t.account_id`.

Parity chains:

- Ordinary expense: legacy classifies `t.amount_paise < 0`; the real posting has the same negative amount, so both add `-t.amount_paise` to expense.
- Ordinary income: legacy classifies `t.amount_paise > 0`; the real posting has the same positive amount and account type, so both add it to income unless D4 excludes the account.
- Same-sign split: legacy classifies the parent transaction once. `buildSplitPostings` creates one real posting equal to the sum of the splits, which equals the parent, so PC3 also classifies the parent once rather than counting each split.
- Mixed-sign split: for parent `-70` and splits `[-100,+30]`, the real posting is `-70`; both implementations return expense `70`, income `0`. The counter-postings `+100` and `-30` are not selected.
- Transfer: legacy excludes either transaction referenced by `transfer_links`; a supported linked leg has a Clearing counter-posting, so the combined `NOT EXISTS` excludes its real posting.
- Opening: legacy excludes `t.is_opening`; `buildOpeningPostings` creates an Opening counter-posting, so the combined `NOT EXISTS` excludes its real posting.
- Liability D4: legacy applies the liability test to `t.account_id`; PC3 applies it to the real posting’s account. Those accounts agree under the invariant, so positive credit-card/loan inflows are excluded identically. Negative amounts remain expenses on all account types.
- EMI: the source ordinary negative bank leg is counted as expense. The independent positive loan principal leg is not a transfer but is excluded from income by D4. Neither leg is incorrectly filtered as Clearing.

### NOTE — The combined Clearing/Opening exclusion is correct for every builder-produced shape

The predicate:

```sql
NOT EXISTS (
  SELECT 1
  FROM postings p2
  JOIN accounts a2 ON a2.id = p2.account_id
  WHERE p2.transaction_id = t.id
    AND a2.system_kind IN ('clearing', 'opening')
)
```

has the correct truth table for valid builder output:

- Ordinary: only Income or Expenses counter-posting; retained.
- Split: only Income/Expenses counter-postings; retained.
- Transfer leg: Clearing counter-posting; excluded.
- Opening row: Opening counter-posting; excluded.
- Zero ordinary row: zero-valued Income counter-posting; retained but contributes zero.
- EMI legs: ordinary Income/Expenses shapes; retained, then classified by sign and D4.

There are no builder-produced false positives because ordinary, split, and EMI shapes contain neither Clearing nor Opening. There are no builder-produced false negatives because transfer and opening builders always add the corresponding system posting. Opening takes precedence in `computePostingDraftsForTransaction`, and opening rows cannot be linked as transfers.

As acknowledged in the plan, this equivalence does not cover malformed or directly mutated data outside the dual-write invariant.

### NOTE — PC1 and PC2 remain parity-correct at Expenses-posting grain

Expenses postings are the correct grain for category and necessity spend:

- A negative non-split transaction produces one positive Expenses posting carrying the parent category.
- Each negative split produces one positive Expenses posting carrying that split’s category.
- Positive splits produce Income postings and therefore do not contribute.
- Mixed-sign splits consequently count only their negative split components, exactly like the legacy `transaction_splits.amount_paise < 0` query.
- Transfers produce Clearing rather than Expenses postings.
- Opening rows produce Opening rather than Expenses postings.
- Soft-deleted and out-of-range parents remain excluded through the `transactions` join.

For `spendByNecessity`, joining the category through `p.category_id` preserves the legacy per-split category grain, while `t.necessity` continues to provide the transaction-wide override. Grouping by the override and current category metadata matches the existing legacy queries.

This differs intentionally from `incomeExpense`, whose legacy grain is one parent transaction and therefore requires the real posting.

### NOTE — PC10 is reasonable and correctly scoped

The stale comments are inside `apps/api/src/lib/periods.ts`, which is already the primary implementation file in scope. Updating the two-statement concurrency comment and making the liability-type comment query-neutral are necessary documentation corrections, not scope expansion.

### NOTE — The other review-22 findings are addressed

Iteration 2 now:

- states the Clearing/`transfer_links` invariant dependency;
- includes an explicit EMI parity fixture;
- includes a mixed-sign split fixture;
- corrects the intended `incomeExpense` aggregation grain;
- specifies the zero-amount Income-posting behavior accurately; and
- includes the stale documentation updates in PC10/AC8.

No new SQL correctness defect is introduced by the PC3 change. The remaining issues are the two T4 lifecycle/regression coverage gaps above.