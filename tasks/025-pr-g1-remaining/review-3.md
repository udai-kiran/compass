BLOCKING — B2: `first.checked >= 1` is sound because the test’s own transaction remains present. However, `second.checked === first.checked` is not concurrency-safe: `reprojectAllLegacyColumns` scans every user, and Node runs test files concurrently. Other tests can insert or delete transactions between calls, so either count may be larger. The equality assertion is potentially flaky and should be scoped or removed.

OK — B1 insert: The posting correctly contains only `transactionId`, `accountId`, and `amountPaise`. The schema confirms `postings` has no `userId` column; omitted optional/default fields are valid.

OK — B1 assertion: Non-zero totals produce `postings sum to ${sum} paise, not zero`, so `reason.includes("not zero")` passes.

OK — B3 lateral:

- `ca.user_id = t.user_id` correctly tenant-scopes the counter-posting account.
- `cp.category_id is not null` correctly selects a categorized counter-posting.
- The system-account condition excludes the card posting itself.
- `limit 1` prevents result fanout. Selection would be nondeterministic if corrupt data contained multiple qualifying postings, but canonical shapes should not.

OK — B3 row type: `category_id: string | null` correctly matches `cat.category_id`. The `t.category_id` at line 376 refers to the TypeScript row parameter named `t`, not the SQL transaction alias.

OK — Stale references: No stale SQL reference to `transactions.category_id` remains anywhere in `cards.ts`.

OK — Imports/static checks: No missing or unused imports were found. API type-checking and ESLint for the reviewed files pass.