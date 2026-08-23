No AC violations found.

Verified:

- [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:340): `rewardRedemptionRoute` and `rewardCapPeriod` enums are present.
- [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:365): `rewardRules` includes `mccExclusions` as `text[]`, `redemptionValues` as `jsonb`, and `reward_rules_accel_consistent` CHECK.
- [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:416): `rewardPointLots.cardDetailsAccountId` references `cardDetails.accountId`.
- [reward-rules.ts](/work/personal/compass/apps/api/src/modules/credit/services/reward-rules.ts:132): `getEffectiveEarnPoints` handles MCC exclusions as `0`, base-only earn, accelerated earn within cap, and base earn after the cap is exhausted or crossed.
- [reward-rules.ts](/work/personal/compass/apps/api/src/modules/credit/services/reward-rules.ts:169): `getPointValue` returns `null` when the route is absent.
- [reward-rules.test.ts](/work/personal/compass/apps/api/src/modules/credit/services/reward-rules.test.ts:30): 8 pure-function tests are present, including MCC exclusion, accel cap boundary/spanning behavior, and `getPointValue` null.
- [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:41): `reward_rules` is after `card_issuer_settings`; `reward_point_lots` is after `card_details`.
- [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:62): both `reward_rules` and `reward_point_lots` are in `USER_TABLES`.
- [schema.decomposition.test.ts](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:72): `rewardRules` and `rewardPointLots` are credit residents.
- [schema.decomposition.test.ts](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:120): decomposition test asserts exactly `69` tables and `51` enums.