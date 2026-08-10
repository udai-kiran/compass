## Verdict

Amendment 1 is sound. D6 is a legitimate, tightly scoped correction of a test-authoring defect, not rationalising a production regression. F1 is correctly diagnosed as a fourth Cause-B fixture defect.

No blocking amendment issue found.

## D6 five-step verification

1. Confirmed. `titleCase` lowercases the complete string and then uppercases the first non-whitespace character of each whitespace-delimited run: [merchants.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/merchants.ts:11). `"PE7Merchant"` therefore becomes `"Pe7merchant"`.

2. Confirmed. The split expression at [merchants.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/merchants.ts:20) does not split camel case, so this is one token. It survives:

   - the reference/masked-number filter at line 24 because it contains letters other than `X`;
   - the long-digit filter at line 25 because it has only one digit;
   - the noise-token filter at line 26.

   Line 28 consequently returns `titleCase("PE7Merchant")`, namely `"Pe7merchant"`.

3. Confirmed. `createTransaction` obtains the rules and calls `normalizeMerchant` before inserting: [transactions.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/transactions.ts:401). The normalized value is included in the insert at line 410. With PE7’s fresh user and no merchant rules, the stored ordinary-transaction row is `"Pe7merchant"`.

4. Confirmed. Search selects `t.merchant` at [search.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/search.ts:13) and maps `r.merchant` directly into the response at line 35. There is no response-side normalization. PR-E changed the source of the amount and transaction selection, but not merchant presentation.

5. Substantively confirmed, with one correction to the cited evidence. The normalization is clearly intentional and independently acknowledged by:

   - [imports.test.ts](/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.test.ts:135), which explicitly expects normalized casing;
   - [postings-planning-parity.test.ts](/home/udai/common/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:537), which explicitly says `"MerchantX"` is stored as `"Merchantx"`;
   - [epf-contributions.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/epf-contributions.test.ts:105), which deliberately accommodates the pre-existing normalization.

   However, the docstring at [merchants.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/merchants.ts:17) is factually stale: its example claims the result is `"Amazon"`, while the current implementation retains `BLR`, and the direct unit test expects `"Amazon Blr"` at `imports.test.ts:136`. That does not undermine D6’s casing conclusion, but the docstring should not be presented as exact proof of the stated example.

## Git-history conclusion

The linchpin is confirmed:

- `git blame` attributes `titleCase`, `heuristicNormalize`, and `normalizeMerchant` to initial commit `90ee575` dated 2026-07-14.
- `transactions.ts` already called `normalizeMerchant` in the parent of PR-E.
- `postings-pr-e-parity.test.ts`, including PE7 and its assertion, was introduced by PR-E commit `2253623` on 2026-08-10.

Therefore normalization did not arrive with PR-E. Given PE7’s fresh user has no merchant rule, the assertion expecting `"PE7Merchant"` could never have passed as committed. D6 is not masking a PR-E production regression.

## Contracts and consumers

I found no API or web contract requiring verbatim merchant round-tripping:

- [search schema](/home/udai/common/compass/packages/shared/src/schemas/search.ts:3) requires only an arbitrary string.
- [CommandPalette.tsx](/home/udai/common/compass/apps/web/src/components/CommandPalette.tsx:79) displays the returned stored merchant and uses it as a case-insensitive transaction-filter query.
- Search itself matches with `lower(...) LIKE lower(term)` at [search.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/search.ts:10), so `"PE7Merchant"` still matches stored `"Pe7merchant"`.
- Other production readers likewise treat the merchant column as the canonical normalized display value.

Verbatim casing is possible through explicit user rules and merchant renaming, which intentionally return/store the user-provided replacement, but that is a different path from ordinary `createTransaction` without rules. D6 does not alter either behavior.

Restricting D6 to PE7’s single assertion is therefore appropriately tight. Existing tests and production callers already acknowledge normalized merchant storage; they do not depend on this input round-tripping verbatim.

## PE7 and the rejected alternative

Your reading of PE7’s actual subject is correct:

- The ordinary transaction is written through the real service at lines 503–509.
- The transfer out-leg is deliberately raw-updated at lines 519–523 so it matches the search.
- The query must then exclude that transfer via Pattern C and return exactly one ordinary transaction.
- The important assertions remain result count at line 526, posting-derived amount at line 527, and posting consistency at line 530.

Editing only the merchant assertion leaves PE7 meaningful. It continues testing transfer exclusion, one-row-per-transaction behavior, real-posting amount selection, search matching, and consistency.

One nuance: the rejected alternative is not inherently as dangerous as Amendment 1 claims. Replacing all relevant PE7 literals with the fixed point `"Pe7merchant"` would still make the raw-updated transfer match case-insensitively and would not by itself destroy Pattern-C coverage. Nevertheless, changing only the incorrect expectation is the smaller and better edit: it preserves the realistic non-fixed-point service input and incidentally verifies the actual normalized stored value.

## F1 diagnosis

Confirmed. The helper at [user-tasks.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.test.ts:63) inserts only a `transactions` row at lines 68–77.

`TASK_LATERAL_QUERY` obtains the projection’s account and amount exclusively from a real-account posting at [user-tasks.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:99). With no posting, `txn_id` remains non-null from the transaction join, while `txn_account_id` and `txn_amount_paise` are null. `toUserTask` then constructs a supposedly present projection using non-null assertions at lines 44–50. That exactly explains AC6’s failure at [user-tasks.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.test.ts:252).

The query is behaving according to PR-E’s postings-derived design. Repairing the healthy-path fixture with the full balanced posting family is correct; falling back to legacy transaction columns would undo the conversion and obscure the separately acknowledged degraded-path defect.

Using `createTransaction` will require calling `seedSystemAccounts` for each test user first. Its normalized merchant behavior will not change current expectations: `"Test merchant"` and `"Bookstore"` are already normalization fixed points.

## Effects on other user-task assertions

The repair should not perturb the remaining assertions:

- Ownership tests use transaction identity and ownership, unaffected by postings.
- Soft-delete tests still hide the transaction at the `t.deleted_at is null` join before the lateral posting lookup.
- Hard deletion removes the transaction and its postings through their foreign-key lifecycle; the task’s `ON DELETE SET NULL` assertion remains unchanged.
- AC6 must continue returning the real-account posting’s `accountId` and `-12345`; the system counter-posting is excluded by `a.system_kind is null`.
- The lateral query has `limit 1`, so a full two-leg posting family cannot multiply task rows.
- The ordering test at [user-tasks.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.test.ts:377) inserts unlinked tasks only. Its ordering is based solely on user-task columns at [user-tasks.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/user-tasks.ts:113), so additional posting rows cannot affect AC10.

## Adjacent fixture scope

One additional passing fixture gap exists: [user-tasks.route.test.ts](/home/udai/common/compass/apps/api/src/modules/ledger/routes/user-tasks.route.test.ts:110) also raw-inserts a transaction without postings. Its uses currently test soft-deleted projection behavior and cross-user isolation, not an active transaction’s account/amount projection, so it does not cause the Amendment 1 failures and need not be added to P6. It should be listed in the existing P5 report because `createUserTask` initially hydrates through the postings-derived reader even though those tests do not assert the malformed active projection.

I found no further raw transaction fixture that both belongs to Amendment 1’s failing paths and asserts a postings-derived value while lacking postings. The reconciliation and backup tests intentionally create inconsistent rows to test reconciliation/degraded behavior and should not be mechanically converted.

## Remaining risks and conventions

No security or compatibility risk is introduced by P6/P7. Full balanced postings follow the repository’s atomicity and consistency conventions.

The explanatory D6 comment should cite the behavior rather than fragile line numbers where practical. It would also be accurate to mention that normalization predates PR-E. Separately, the stale `"Amazon"` docstring should eventually be corrected to `"Amazon Blr"` or the implementation changed, but that is unrelated to this amendment and not required for approval.

Overall: approve Amendment 1.