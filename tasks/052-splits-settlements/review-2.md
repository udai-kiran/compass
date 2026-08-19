**Findings**

- **Medium:** `getHouseholdBalances` still does not guarantee the stated zero-sum invariant for all splits creatable through the service. The credit path only runs when a `split_shares` row exists for `payerPersonId` at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:82). But `createSplit` accepts any `payerPersonId` and never verifies that it appears exactly once in `memberPersonIds` at [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:32). Example: payer `A`, shares only for `B=100` returns `B=-100` and no `A=+100`, so the split totals `-100`. Duplicate payer share rows can also over-credit the payer because `othersTotal` is added once per payer row. Fix by either validating `memberPersonIds` contains the payer exactly once, or computing the payer credit once per split outside the per-share loop.

- **Medium, pre-existing from review-1:** settlement services still accept `_userId` but do not authorize it in `createSettlement`, `listSettlements`, or `getHouseholdBalances`. If route-level household membership checks are not guaranteed, this remains an access-control gap.

**Verified Correct**

- Backup linked-table fix is structurally correct. `LINKED_TABLES` now supports `parentUserCol?: string`, `split_shares` scopes through `splits.created_by_user_id`, `settlements` scopes through `households.created_by_user_id`, and existing linked tables still default to `parent.user_id` at [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:76).

- `splits.payerPersonId` is present and maps to `payer_person_id`, `NOT NULL`, FK to `family_members.id`, with `ON DELETE cascade` at [schema.ts](/work/personal/compass/apps/api/src/modules/household/schema.ts:115).

- `getHouseholdBalances` no longer has the previous N+1 share query. It uses one `innerJoin` from `splits` to `split_shares` at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:60). For well-formed splits with exactly one payer share row, payer credit and non-payer debit direction are correct.

- Settlement direction matches the requested model: `fromPersonId` gets `+amountPaise`, `toPersonId` gets `-amountPaise` at [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:97).

- `CreateSplitInput` requires `payerPersonId`, and insert passes it into `splits` at [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:18).

- Migration `0002_messy_stepford_cuckoos.sql` contains `split_rule`, `splits` with `payer_person_id`, `split_shares`, and `settlements` DDL. I saw no `DROP`, `TRUNCATE`, or destructive delete operations.

**Verification**

- `npm run typecheck -w apps/api` passed.
- `node --env-file-if-exists=../../.env --test src/modules/household/services/split-math.test.ts` passed: 14/14.
- Full API test command was not usable in this environment because many DB-backed tests require `DATABASE_URL`.