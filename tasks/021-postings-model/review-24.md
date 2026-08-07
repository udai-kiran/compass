Review target: `tasks/021-postings-model/PLAN-pr-c.md`

Exit code: 1

## Findings

### BLOCKING — AC4/T4 does not prove `spendByNecessity` parity against the legacy formula

The test contains direct legacy helpers for `spentByCategory` and `incomeExpense`, but none for `spendByNecessity`. Instead, it reduces the returned necessity rows to a total and compares that total with literals or category spend.

This would not detect incorrect `txNecessity`, `catNecessity`, or `catKind` values, incorrect grouping, or incorrect transaction-override/category-default behavior as long as total spend remained unchanged. T4 requires per-function equality with expectations computed directly from legacy tables.

Add a legacy necessity helper querying `transactions`, `transaction_splits`, `categories`, and `transfer_links`, normalize both result sets, and compare the complete rows.

### WARNING — Transfer lifecycle coverage omits `spendByNecessity`

Case 7 covers all four required state transitions:

- 7a link
- 7b unlink
- 7c re-link
- 7d hard-delete one leg and rebuild the survivor

However, it only exercises `spentByCategory` and `incomeExpense`. It never calls `spendByNecessity`, so PC2’s Clearing-based exclusion and restoration are not protected across the lifecycle. Add necessity assertions at each step.

### WARNING — EMI fixture does not assert absence of `transfer_links`

The EMI test correctly verifies that neither ordinary transaction has a Clearing posting. The approved T4 additionally requires asserting that neither EMI transaction participates in `transfer_links`. Add the direct legacy-table assertion.

### NOTE — PC1 is implemented correctly

`spentByCategory` uses one Expenses-posting query, filters positive Expenses postings, excludes soft-deleted, out-of-range, and Clearing-backed transactions, groups by posting category, and naturally excludes opening rows. Both the row conversion and map accumulation guards throw `HttpError(500)`.

### NOTE — PC2 is implemented correctly

`spendByNecessity` uses one Expenses-posting query, preserves the transaction-level override and tenant-scoped category join, and guards `mapRow` conversion with `HttpError(500)`. Its stale two-statement JSDoc was updated.

### NOTE — PC3 through PC5 are implemented correctly

`incomeExpense` anchors on the real posting with `a.system_kind IS NULL`, applies the D4 liability check to that posting account’s `a.type`, and combines Clearing and Opening exclusions in one `NOT EXISTS`. Opening rows are naturally absent from PC1/PC2 and explicitly excluded from PC3.

### NOTE — PC6, PC7, and PC10 are satisfied

All new monetary overflow guards use `HttpError(500)`, not plain `Error`. The alias-specific `LIABILITY_TYPES_SQL` comment was removed, and the `spendByNecessity` documentation now describes the single-query implementation.

### NOTE — Mixed-sign regression assertions are correct

The negative-parent case asserts `expensePaise = 7000`, not 10000. The positive-parent case asserts `incomePaise = 7000`, not 10000. Category spend remains correctly based on negative split components.

### NOTE — All 15 named scenarios are present and isolated

The suite contains cases 1–15, including both mixed-sign directions, the four-step transfer lifecycle, opening, deletion, date filtering, D4, EMI, zero amount, tenant isolation, and `findInconsistentPostings`. Each case uses separate generated users and cleanup hooks.

### NOTE — PC8 and application scope are satisfied

There are no changes to `recurring.test.ts` or `inbox.test.ts`, and no writer, schema, migration, shared-contract, or web changes. The working tree’s application changes are limited to `periods.ts` and the new parity test. Typecheck and lint both exit successfully.