**Findings**

- **High:** The generated migration does not include Task 052’s new DB objects. [schema.ts](/work/personal/compass/apps/api/src/modules/household/schema.ts:103) defines `split_rule`, `splits`, `split_shares`, and `settlements`, but [0001_lush_grim_reaper.sql](/work/personal/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:1) has no `split_rule`, `splits`, `split_shares`, or `settlements` DDL, and the snapshot has no matches either. A migrated database will not have these tables/enums.

- **High:** Per-user backup export is broken for the new linked tables. [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:85) adds `split_shares -> splits` and [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:86) adds `settlements -> households`, but `dumpUserTable` always filters linked parents with `p.user_id` at [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:108). Neither `splits` nor `households` has `user_id`; both are scoped by `created_by_user_id`. Exporting `split_shares` or `settlements` will produce invalid SQL.

- **High:** `getHouseholdBalances` does not satisfy the stated balance invariant or direction. It subtracts every `splitShares.sharePaise` from each participant at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:77), but never credits the payer/transaction owner, so balances do not sum to zero and “positive = owed money” is not represented except after settlements. A single 100 paise two-person split returns both people negative, not payer positive / debtor negative.

- **Medium:** `getHouseholdBalances` has the explicit N+1 query risk the review asked about. It first loads split IDs, then queries `split_shares` once per split at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:68). This should be a single join/query over all shares for the household.

- **Medium:** Settlement services accept `userId` but do not use it for authorization. `createSettlement`, `listSettlements`, and `getHouseholdBalances` all take `_userId` at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:15), [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:34), and [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:57), but any caller with a household ID can create/list balances unless a route-level guard is guaranteed.

- **Medium:** Missing invariant tests. [split-math.test.ts](/work/personal/compass/apps/api/src/modules/household/services/split-math.test.ts:40) covers pure math basics, but there are no tests for `createSplit`, `deleteSplit`, settlements, balance zero-sum, delete consistency, duplicate `transactionId`, or backup export of the new linked tables. The proportional tests also do not assert largest-remainder allocation/tie behavior; [split-math.test.ts](/work/personal/compass/apps/api/src/modules/household/services/split-math.test.ts:41) only checks the sum for `[1,1,1]`.

**What Looks Correct**

- Schema references use direct shared imports, not the barrel: [schema.ts](/work/personal/compass/apps/api/src/modules/household/schema.ts:17). No schema DAG/barrel violation found.
- FK targets match the request: `transactions` from `db/shared/ledger.ts`, `familyMembers` from `db/shared/persons.ts`.
- Cascade rules and `bigint(..., { mode: "number" })` are present where expected.
- `splits.transactionId` is unique at [schema.ts](/work/personal/compass/apps/api/src/modules/household/schema.ts:107).
- `db/schema.ts` exports the new household symbols and decomposition counts pass.
- `createSplit` dispatches rules correctly, validates exact shares before insert, and wraps split + share insertion in a DB transaction.
- `deleteSplit` is creator-only.

**Verification Run**

- `node --test apps/api/src/modules/household/services/split-math.test.ts` passed: 14/14.
- `node --test apps/api/src/db/schema.decomposition.test.ts` passed: 3/3.