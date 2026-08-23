# Task: 074 — Reward Value, Expiry & Earn-Rule Model (task 10.5)

## Status
COMPLETE

## Objective
Add `reward_rules` (product-level earn rules with redemption values per route) and `reward_point_lots` (expiry tracking per tranche) to the credit module. `reward_point_lots` is expiry-metadata only — it does NOT replace `reward_entries` (the existing signed point ledger). `getPointValue` returns null for unmodelled cards — excluded from comparison. Accelerated earn cap is cumulative with a period field, not per-transaction.

## Root Cause
`cardDetails.earnRatePer100` is a single integer; `rewardEntries` is a bare point ledger with no expiry, no redemption value, no MCC exclusions, no caps.

## Scope
- `apps/api/src/modules/credit/schema.ts` — add:
  - `rewardRedemptionRoute` pgEnum (`cashback`, `air_miles`, `catalogue`, `statement_credit`)
  - `rewardCapPeriod` pgEnum (`per_transaction`, `monthly`, `statement_cycle`, `annual`)
  - `rewardRules` table: id uuid PK defaultRandom(), userId uuid FK users NOT NULL, cardProductName text NOT NULL, network cardNetwork nullable, baseEarnPer100 int NOT NULL default 0, mccExclusions text[] NOT NULL default '{}', accelEarnMultiplier int nullable, accelEarnCapPaise bigint nullable, accelEarnCapPeriod rewardCapPeriod nullable, redemptionValues jsonb NOT NULL default '{}' (Record<redemptionRoute, paise-per-point>), milestoneSpendPaise bigint nullable, milestoneBenefitDesc text nullable, annualFeeWaiverSpendPaise bigint nullable, createdAt, updatedAt; uniqueIndex (userId, cardProductName) — network NOT part of unique key (nullable uniqueness issue); CHECK baseEarnPer100 >= 0; note in comment that accelEarnMultiplier, accelEarnCapPaise, accelEarnCapPeriod must all be set together
  - `rewardPointLots` table: id uuid PK defaultRandom(), userId uuid FK users NOT NULL, cardDetailsAccountId uuid FK cardDetails NOT NULL, earnedAt timestamp NOT NULL, points int NOT NULL CHECK >= 0, expiresAt timestamp nullable, isRedeemed boolean NOT NULL default false, description text nullable, createdAt; index (userId, expiresAt)
- `apps/api/drizzle/` — generate migration
- `packages/shared/src/schemas/credit.ts` — add `RewardRedemptionRouteSchema`, `RewardCapPeriodSchema`, `RewardRuleSchema`, `CreateRewardRuleSchema`, `UpdateRewardRuleSchema`, `RewardPointLotSchema`, `CreateRewardPointLotSchema`
- `apps/api/src/modules/credit/services/reward-rules.ts` — CRUD for rules; `getEffectiveEarnRate(rule, spendPaise, mcc, priorEligibleSpendInPeriodPaise)` → int (base rate if MCC excluded or cap exceeded; accel rate if within cap); `getPointValue(rule, route)` → number|null (null if route not in redemptionValues)
- `apps/api/src/modules/credit/services/reward-lots.ts` — `addLot`, `listExpiring(db, userId, withinDays)`, `markRedeemed`; `reward_point_lots` is additive metadata — never subtracts from reward_entries
- `apps/api/src/modules/credit/routes/reward-rules.ts` — GET /api/credit/reward-rules, POST, PUT /:id, DELETE /:id
- `apps/api/src/modules/credit/routes/reward-lots.ts` — GET /api/credit/reward-lots?expiringWithinDays=30, POST, PATCH /:id/redeem
- `apps/api/src/modules/credit/plugin.ts` — register new routes
- `apps/api/src/modules/system/services/backup.ts` — add `reward_rules` (after card_issuer_settings) and `reward_point_lots` (after card_details — has FK to cardDetails) to ALL_TABLES and USER_TABLES
- `apps/api/src/modules/credit/schema.smoke.test.ts` — update table/enum counts
- `apps/api/src/db/schema.decomposition.test.ts` — update credit resident sets
- `apps/api/src/modules/credit/services/reward-rules.test.ts` — unit tests: MCC excluded → 0 earn rate; accel within cap → multiplied rate; accel beyond cap → base rate; getPointValue null for unset route; getPointValue returns configured value
- `apps/api/src/modules/credit/routes/reward-rules.hermetic.test.ts`
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Dependencies
- task 073 (can be parallel — both add credit schema tables)

## Plan
- P1: Add enums + tables to credit/schema.ts; generate migration
- P2: Add shared Zod schemas
- P3: Write services/reward-rules.ts (CRUD + getEffectiveEarnRate + getPointValue)
- P4: Write services/reward-lots.ts (add, listExpiring, markRedeemed)
- P5: Write routes and register in credit/plugin.ts
- P6: Update backup.ts (ordering critical: reward_point_lots after card_details)
- P7: Update schema.smoke.test.ts and decomposition.test.ts
- P8: Write unit tests
- P9: Update route snapshots

## Acceptance Criteria
- AC1: `reward_rules` has UUID PK, (userId, cardProductName) unique index, mccExclusions[], redemptionValues jsonb, accelEarnCapPeriod enum
- AC2: `reward_point_lots` has UUID PK, cardDetailsAccountId FK, expiresAt nullable; is additive only (no interaction with reward_entries)
- AC3: `getEffectiveEarnRate` returns 0 for excluded MCC (regardless of spend amount)
- AC4: `getEffectiveEarnRate` applies multiplier when priorEligibleSpend < cap; reverts to base when cap reached
- AC5: `getPointValue` returns null when route not in redemptionValues — excludes card from comparison
- AC6: Expiring lots (next N days) queryable; markRedeemed sets isRedeemed=true
- AC7: Both tables in ALL_TABLES with correct ordering; both in USER_TABLES
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0
- T4: `npm run test -w packages/shared` exits 0

## Non-Goals
- Auto-earning points from transactions (manual entry via POST /reward-lots)
- Milestone benefit fulfillment
- Overriding or integrating with reward_entries (separate concerns)
