## Review findings

1. **High — multiple active opening transactions can make saves non-idempotent.**  
   The aggregate sums every active `is_opening` posting, but `updateAccount` selects and updates only the earliest opening-shaped transaction (`limit 1`). If duplicates exist, the UI displays their sum; saving that displayed value updates one row to the sum while leaving the others intact, increasing the next aggregate. Clearing similarly deletes only one row. There is no uniqueness constraint preventing multiple opening transactions. Either enforce/repair the single-opening invariant or make the read and write paths handle all active opening rows consistently.

2. **Medium — validate `openingTxnPaise` before converting/returning it.**  
   Like `postingSum`, the bigint aggregate is converted to a JavaScript number. The plan should explicitly run `Number.isSafeInteger` on it and reject unsafe values; otherwise opening-balance paise can silently lose precision.

3. **Medium — add targeted service/UI tests to the plan.**  
   Existing verification only runs broad suites. Add coverage for:

   - Active versus soft-deleted opening transactions.
   - Cross-user transactions.
   - Multiple active opening rows.
   - Nonzero and zero/cleared opening values.
   - Liability sign display.
   - Field synchronization after query refresh/save.

## Checks requested

1. **Opening identification:** The join path is correct: `accounts → postings.accountId → transactions.id`, and `transactions.isOpening` maps to the non-null boolean `is_opening` column. Filtering `deletedAt` is also correct. Using postings rather than `transactions.accountId` matches the postings-based balance model.

2. **User isolation/double-counting:** The `transactions.userId = userId` filter matches the existing `postingSum` pattern. The outer account query also scopes accounts to the user. Each account posting is counted once under normal data, although the schema does not prevent duplicate postings for the same transaction/account.

3. **Multiple opening rows:** Yes, this is unsafe as described in finding 1. Normal serialized writes should avoid duplicates, but neither the database nor historical/corrupt data guarantees that invariant.

4. **Clearing the field:** Correct. An empty field parses as `0`; when the stored aggregate is also `0`, `dirty` is false. When the stored value is nonzero, clearing makes it dirty and PATCHing `openingBalancePaise: 0` is correct.

5. **Other consumers:** Adding the field does not semantically affect other consumers, but typed `AccountWithBalance` fixtures must be updated. In particular, the object factory in `apps/web/src/routes/accounts/account-groups.test.ts` will require the new property because `z.infer` reflects the schema’s output type.

6. **`default(0)` versus `optional()`:** Do not use `optional()`; it creates `number | undefined` and weakens every consumer. Prefer a required `z.number().int()` for a coordinated API/client change because a default can conceal a missing API aggregate by recreating the original visible value of zero. Use `.default(0)` only if backward compatibility with older cached/server payloads is an explicit deployment requirement; note that it still leaves the inferred output property required in typed fixtures.

Apart from the duplicate-row and safe-integer issues, P1–P3 address the reported EPF reset correctly.