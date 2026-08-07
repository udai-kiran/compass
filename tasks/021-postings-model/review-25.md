Review target: `apps/api/src/lib/postings-periods-parity.test.ts`

Exit code: 0

## Findings

### NOTE — review-24 BLOCKING is resolved

`legacySpendByNecessity` queries `transactions`, `transaction_splits`, `categories`, and `transfer_links` directly and does not call converted period helpers.

Tests 1, 3, and 4 compare complete, canonically sorted rows using `assert.deepEqual(sortNecessityRows(sbn), sortNecessityRows(legSbn))`. These comparisons are order-independent and will detect differences in `txNecessity`, `catNecessity`, `catKind`, grouping, or `spentPaise` for the exercised fixtures.

### WARNING — Non-null necessity values remain unexercised

The normalized comparisons are structurally sufficient, but tests 1, 3, and 4 do not assign non-null transaction or category necessity values. Consequently, a regression that always returned `null` for `txNecessity` or `catNecessity` could still pass these fixtures. Add distinct non-null transaction overrides and category defaults if full field-mapping and precedence regression coverage is required.

### NOTE — Transfer lifecycle warning is resolved

Test 7 calls `spendByNecessity` at every lifecycle stage and asserts:

- 7a linked: `0`
- 7b unlinked: `30000`
- 7c re-linked: `0`
- 7d hard-delete plus rebuild: `30000`

### NOTE — EMI transfer-link warning is resolved

Test 12 correctly counts transfer links involving either fixture transaction by joining `transfer_links` to `transactions` on both `out_transaction_id` and `in_transaction_id`, scopes through `t.user_id = ${userId}`, casts the count to `int`, and asserts zero.

### NOTE — PC1/PC2/PC3/PC6 remain correct

`periods.ts` has no regression:

- PC1 uses positive Expenses postings, category grouping, tenant/date/deletion filtering, and Clearing exclusion.
- PC2 uses the same spend grain, preserves transaction necessity and tenant-scoped category metadata, and excludes Clearing-backed transactions.
- PC3 anchors on the single real posting, excludes Clearing and Opening shapes, and applies the liability-income rule to the real account.
- PC6 checks all returned monetary conversions and map accumulation with `Number.isSafeInteger`, throwing `HttpError(500)` on overflow.