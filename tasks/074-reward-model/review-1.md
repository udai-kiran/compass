**Findings**

1. **High: `reward_rules` cannot support `getPointValue` as scoped.**  
   [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:7) says to track point value per redemption route, and [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:16) requires `getPointValue(rule, route, userConfig)`. But the proposed columns in [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:13) have no route-to-value data. `pointsPerRs100` is earn rate, not value. Add something like `pointValues`/`redemptionValues` as `jsonb`, or a normalized child table keyed by `rewardRuleId + route`, with paise-per-point or equivalent.

2. **High: `accelEarnCapPaise` is underspecified and the proposed function signature makes cumulative caps impossible.**  
   [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:16) proposes `getEffectiveEarnRate(rule, spendPaise, mcc)`, and [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:41) says accelerated multiplier applies up to the cap then reverts to base. Most card accelerated reward caps are cumulative over a statement cycle/month/category, not per transaction. This function cannot know prior eligible spend, period, or cap consumption, so it will incorrectly treat the cap as transaction-local. The model should include cap period/scope, e.g. monthly/statement/annual/per-transaction, and the calculator should accept `eligibleSpendSoFarPaise` or compute it from transactions for the relevant period. If task 10.5 only needs product rules and not transaction auto-earning, still store cap semantics now.

3. **High: planned route shape uses `/:id`, but table scope omits IDs.**  
   [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:18) and [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:19) define `PATCH/:id` routes, but [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:13) does not include `id` on either `reward_rules` or `reward_point_lots`. Add UUID primary keys, then add uniqueness constraints for rule identity.

4. **Medium: rule key is inconsistent and nullable `network` needs a deliberate uniqueness design.**  
   The objective says keyed by `cardProductName/network` at [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:7), but AC1 says `(userId, cardProductName)` at [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:38). Existing card details have both `productName` and nullable `network` at [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:58). Decide whether `network` is part of identity. If nullable means “any network”, a normal Postgres unique constraint over nullable `network` will allow duplicate null rows unless handled explicitly.

5. **Medium: `reward_point_lots` overlaps conceptually with `reward_entries`; the plan needs a source-of-truth rule.**  
   Existing `reward_entries` is a signed point ledger with manual/ingestion provenance at [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:214) and current services only list/add/delete that ledger in [rewards.ts](/work/personal/compass/apps/api/src/modules/credit/services/rewards.ts:8). Adding lots does not conflict at the SQL table-name/FK level, but it can create divergent reward balances unless the plan states whether lots are expiry metadata only, replace earned positive entries, mirror entries, or are backfilled from entries.

**Direct Answers**

1. **Schema conflict?**  
   No direct physical conflict with existing table names or columns. `reward_rules` and `reward_point_lots` can be added to [credit/schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:214). The conflict risk is semantic: `reward_point_lots` and `reward_entries` both represent reward points unless their relationship is defined. Also update the explicit export list in [db/schema.ts](/work/personal/compass/apps/api/src/db/schema.ts:34), otherwise Drizzle/schema coverage may not see the new tables.

2. **`getEffectiveEarnRate`: per-transaction or cumulative monthly?**  
   It should not assume per-transaction. Model the cap as cumulative for a defined period by default, probably statement/monthly, with a field for cap period/scope. The current signature is insufficient for cumulative caps.

3. **`getPointValue` returning `null`?**  
   Yes. Returning `null`, not `0`, is the right design for unmodelled cards/routes because it lets comparison logic exclude unknowns instead of ranking them as zero-value cards. Callers must preserve that distinction.

4. **Missing fields in `reward_rules`?**  
   `annualFeeWaiverSpendPaise` is already listed, so that specific threshold is not missing. Missing or underspecified fields include redemption route values, rule IDs, timestamps, cap period/scope, possibly cap basis/category/MCC applicability, and annual fee amount if comparisons need net benefit after fees.

5. **`backup.ts` scope?**  
   Adding both `reward_rules` and `reward_point_lots` to `ALL_TABLES` and `USER_TABLES` is correct because the plan gives both tables a direct `userId` at [TASK.md](/work/personal/compass/tasks/074-reward-model/TASK.md:13). Put `reward_point_lots` after its FK parents, especially `card_details`, in [ALL_TABLES](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32). No `LINKED_TABLES` entry is needed if `user_id` is present.