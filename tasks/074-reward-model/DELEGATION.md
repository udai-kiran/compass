# Sonnet Worker Delegation — 074 (Phase B)

## Task
074 — Reward Value, Expiry & Earn-Rule Model (task 10.5)

## Approved Plan
- P1: Add enums + tables to credit/schema.ts; generate migration
- P2: Add shared Zod schemas
- P3: Write services/reward-rules.ts (CRUD + getEffectiveEarnRate + getPointValue)
- P4: Write services/reward-lots.ts (add, listExpiring, markRedeemed)
- P5: Write routes and register in credit/plugin.ts
- P6: Update backup.ts (ordering critical: reward_point_lots after card_details)
- P7: Update schema.smoke.test.ts and decomposition.test.ts
- P8: Write unit tests
- P9: Update route snapshots

## Files and Symbols
- `apps/api/src/modules/credit/schema.ts` — add rewardRedemptionRoute pgEnum, rewardCapPeriod pgEnum, rewardRules table, rewardPointLots table
- `apps/api/drizzle/` — new migration
- `packages/shared/src/schemas/credit.ts` — add RewardRedemptionRouteSchema, RewardCapPeriodSchema, RewardRuleSchema, CreateRewardRuleSchema, UpdateRewardRuleSchema, RewardPointLotSchema, CreateRewardPointLotSchema
- `apps/api/src/modules/credit/services/reward-rules.ts` — NEW
- `apps/api/src/modules/credit/services/reward-rules.test.ts` — NEW
- `apps/api/src/modules/credit/services/reward-lots.ts` — NEW
- `apps/api/src/modules/credit/routes/reward-rules.ts` — NEW (full paths: /api/credit/reward-rules, ...)
- `apps/api/src/modules/credit/routes/reward-lots.ts` — NEW (full paths: /api/credit/reward-lots, ...)
- `apps/api/src/modules/credit/routes/reward-rules.hermetic.test.ts` — NEW
- `apps/api/src/modules/credit/plugin.ts` — register new routes
- `apps/api/src/modules/system/services/backup.ts` — add reward_rules (after card_issuer_settings) and reward_point_lots (after card_details) to ALL_TABLES; add both to USER_TABLES
- `apps/api/src/db/schema.ts` — add barrel exports for new tables/enums
- `apps/api/src/modules/credit/schema.smoke.test.ts` — update counts
- `apps/api/src/db/schema.decomposition.test.ts` — update credit resident sets, update total table/enum counts
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Required Changes

### 1. credit/schema.ts additions
Read the full file first. Add after the existing enums and before or after `cardOffers` (added by task 073):

```ts
export const rewardRedemptionRoute = pgEnum("reward_redemption_route", [
  "cashback", "air_miles", "catalogue", "statement_credit"
]);

export const rewardCapPeriod = pgEnum("reward_cap_period", [
  "per_transaction", "monthly", "statement_cycle", "annual"
]);

export const rewardRules = pgTable(
  "reward_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cardProductName: text("card_product_name").notNull(),
    network: cardNetwork("network"), // nullable — null means "any network"
    baseEarnPer100: integer("base_earn_per_100").notNull().default(0),
    mccExclusions: text("mcc_exclusions").array().notNull().default(sql`'{}'::text[]`),
    accelEarnMultiplier: integer("accel_earn_multiplier"), // nullable
    accelEarnCapPaise: bigint("accel_earn_cap_paise", { mode: "number" }), // nullable
    accelEarnCapPeriod: rewardCapPeriod("accel_earn_cap_period"), // nullable
    // Record<redemptionRoute, paisePerPoint> — null means no configured value for that route
    redemptionValues: jsonb("redemption_values").notNull().default(sql`'{}'::jsonb`),
    milestoneSpendPaise: bigint("milestone_spend_paise", { mode: "number" }), // nullable
    milestoneBenefitDesc: text("milestone_benefit_desc"), // nullable
    annualFeeWaiverSpendPaise: bigint("annual_fee_waiver_spend_paise", { mode: "number" }), // nullable
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reward_rules_user_product_idx").on(t.userId, t.cardProductName),
    index("reward_rules_user_idx").on(t.userId),
    check("reward_rules_base_earn_nonneg", sql`"base_earn_per_100" >= 0`),
    // accel fields must all be set together or all null
    check("reward_rules_accel_consistent", sql`(
      "accel_earn_multiplier" IS NULL AND "accel_earn_cap_paise" IS NULL AND "accel_earn_cap_period" IS NULL
    ) OR (
      "accel_earn_multiplier" IS NOT NULL AND "accel_earn_cap_paise" IS NOT NULL AND "accel_earn_cap_period" IS NOT NULL
    )`),
  ]
);

export const rewardPointLots = pgTable(
  "reward_point_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    cardDetailsAccountId: uuid("card_details_account_id").notNull().references(() => cardDetails.accountId, { onDelete: "cascade" }),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull(),
    points: integer("points").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // nullable — no expiry
    isRedeemed: boolean("is_redeemed").notNull().default(false),
    description: text("description"), // nullable
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reward_point_lots_user_expires_idx").on(t.userId, t.expiresAt),
    index("reward_point_lots_user_idx").on(t.userId),
    check("reward_point_lots_points_nonneg", sql`"points" >= 0`),
  ]
);
```

Import `jsonb` from `drizzle-orm/pg-core`. `sql` is already imported for CHECK constraints.

### 2. db/schema.ts barrel
Read the file. Add exports for `rewardRedemptionRoute`, `rewardCapPeriod`, `rewardRules`, `rewardPointLots` from the credit module. Update comment counts.

### 3. packages/shared/src/schemas/credit.ts
Add at the end:
```ts
export const RewardRedemptionRouteSchema = z.enum(["cashback", "air_miles", "catalogue", "statement_credit"]);
export type RewardRedemptionRoute = z.infer<typeof RewardRedemptionRouteSchema>;

export const RewardCapPeriodSchema = z.enum(["per_transaction", "monthly", "statement_cycle", "annual"]);
export type RewardCapPeriod = z.infer<typeof RewardCapPeriodSchema>;

export const RewardRuleSchema = z.object({
  id: z.uuid(),
  cardProductName: z.string().min(1),
  network: z.enum(["visa", "mastercard", "amex", "rupay", "diners"]).nullable(),
  baseEarnPer100: z.number().int().nonnegative(),
  mccExclusions: z.array(z.string()),
  accelEarnMultiplier: z.number().int().positive().nullable(),
  accelEarnCapPaise: z.number().int().nonnegative().nullable(),
  accelEarnCapPeriod: RewardCapPeriodSchema.nullable(),
  redemptionValues: z.record(RewardRedemptionRouteSchema, z.number().int().nonnegative()),
  milestoneSpendPaise: z.number().int().nonnegative().nullable(),
  milestoneBenefitDesc: z.string().nullable(),
  annualFeeWaiverSpendPaise: z.number().int().nonnegative().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RewardRule = z.infer<typeof RewardRuleSchema>;

export const CreateRewardRuleSchema = z.object({
  cardProductName: z.string().min(1).max(200).trim(),
  network: z.enum(["visa", "mastercard", "amex", "rupay", "diners"]).nullable().default(null),
  baseEarnPer100: z.number().int().nonnegative().default(0),
  mccExclusions: z.array(z.string()).default([]),
  accelEarnMultiplier: z.number().int().positive().nullable().default(null),
  accelEarnCapPaise: z.number().int().nonnegative().nullable().default(null),
  accelEarnCapPeriod: RewardCapPeriodSchema.nullable().default(null),
  redemptionValues: z.record(RewardRedemptionRouteSchema, z.number().int().nonnegative()).default({}),
  milestoneSpendPaise: z.number().int().nonnegative().nullable().default(null),
  milestoneBenefitDesc: z.string().max(500).nullable().default(null),
  annualFeeWaiverSpendPaise: z.number().int().nonnegative().nullable().default(null),
}).refine(
  v => {
    const accelFields = [v.accelEarnMultiplier, v.accelEarnCapPaise, v.accelEarnCapPeriod];
    const nullCount = accelFields.filter(f => f === null).length;
    return nullCount === 0 || nullCount === 3;
  },
  { message: "accelEarnMultiplier, accelEarnCapPaise, and accelEarnCapPeriod must all be set or all be null" }
);

export const RewardPointLotSchema = z.object({
  id: z.uuid(),
  cardDetailsAccountId: z.uuid(),
  earnedAt: z.coerce.date(),
  points: z.number().int().nonnegative(),
  expiresAt: z.coerce.date().nullable(),
  isRedeemed: z.boolean(),
  description: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type RewardPointLot = z.infer<typeof RewardPointLotSchema>;

export const CreateRewardPointLotSchema = z.object({
  cardDetailsAccountId: z.uuid(),
  earnedAt: z.coerce.date().default(() => new Date()),
  points: z.number().int().nonnegative(),
  expiresAt: z.coerce.date().nullable().default(null),
  description: z.string().max(500).nullable().default(null),
});
```

### 4. Run migration
`npm run db:generate -w apps/api`

### 5. services/reward-rules.ts
```ts
// CRUD
listRewardRules(db, userId): Promise<RewardRule[]>
createRewardRule(db, userId, data): Promise<RewardRule>  // 409 on duplicate (userId, cardProductName)
updateRewardRule(db, userId, ruleId, data): Promise<RewardRule>  // 404 if wrong user
deleteRewardRule(db, userId, ruleId): Promise<void>  // 404 if wrong user

/**
 * Computes the effective earn rate for a spend, accounting for MCC exclusions
 * and accelerated earn cap.
 * 
 * @param rule - the reward rule
 * @param spendPaise - the spend amount in paise
 * @param mcc - merchant category code (string), or null/undefined if unknown
 * @param priorEligibleSpendInPeriodPaise - prior eligible spend in the cap period (for cumulative cap)
 * @returns earned points (integer)
 */
getEffectiveEarnPoints(
  rule: RewardRule,
  spendPaise: number,
  mcc: string | null | undefined,
  priorEligibleSpendInPeriodPaise: number
): number {
  // 1. If MCC is in mccExclusions → return 0
  // 2. If no accel config → baseEarnPer100 points per ₹100
  // 3. If accel config:
  //    - remainingCapPaise = max(0, accelEarnCapPaise - priorEligibleSpendInPeriodPaise)
  //    - eligibleAtAccel = min(spendPaise, remainingCapPaise)
  //    - eligibleAtBase = spendPaise - eligibleAtAccel
  //    - return floor(eligibleAtAccel * accelEarnMultiplier * baseEarnPer100 / 10000) + floor(eligibleAtBase * baseEarnPer100 / 10000)
}

/**
 * Gets the value of 1 point in paise for the given redemption route.
 * Returns null if the route is not configured — callers must exclude this card from comparison.
 */
getPointValue(rule: RewardRule, route: RewardRedemptionRoute): number | null {
  return rule.redemptionValues[route] ?? null;
}
```

### 6. services/reward-lots.ts
```ts
addLot(db, userId, data: CreateRewardPointLot): Promise<RewardPointLot>
  // Verify cardDetailsAccountId belongs to userId (404 if not)

listExpiringLots(db, userId, withinDays: number = 30, now?: Date): Promise<RewardPointLot[]>
  // WHERE userId = ? AND isRedeemed = false AND expiresAt IS NOT NULL AND expiresAt <= now + withinDays*days

markRedeemed(db, userId, lotId): Promise<RewardPointLot>
  // 404 if wrong user or not found
```

### 7. Routes (full paths — credit module not prefix-mounted)
- reward-rules.ts: GET /api/credit/reward-rules, POST /api/credit/reward-rules, PUT /api/credit/reward-rules/:id, DELETE /api/credit/reward-rules/:id
- reward-lots.ts: GET /api/credit/reward-lots?expiringWithinDays=30, POST /api/credit/reward-lots, PATCH /api/credit/reward-lots/:id/redeem

### 8. backup.ts
Add to ALL_TABLES:
- "reward_rules" after "card_issuer_settings"
- "reward_point_lots" after "card_details" (has FK to card_details.account_id)
Add to USER_TABLES:
- reward_rules: "user_id"
- reward_point_lots: "user_id"

### 9. schema counts
- credit/schema.smoke.test.ts: was 9 tables (after task 073 added card_offers), 3 enums. Now +2 tables (reward_rules, reward_point_lots), +2 enums (reward_redemption_route, reward_cap_period) → 11 tables, 5 enums
- db/schema.decomposition.test.ts: was 66 tables / 48 enums. Now +2 tables +2 enums → 68 tables / 50 enums. Add rewardRules, rewardPointLots to creditResidents tables set. Add rewardRedemptionRoute, rewardCapPeriod to creditResidents enums set.

### 10. Unit tests (services/reward-rules.test.ts)
Tests (no DB needed — pure functions only):
1. `getEffectiveEarnPoints: zero spend earns zero points`
2. `getEffectiveEarnPoints: MCC in exclusions → 0 points`
3. `getEffectiveEarnPoints: no accel config → base rate only`
4. `getEffectiveEarnPoints: within accel cap → accelerated rate`
5. `getEffectiveEarnPoints: prior spend exactly at cap → base rate only (cap exhausted)`
6. `getEffectiveEarnPoints: spend spanning cap boundary → split accel + base`
7. `getPointValue: returns null for unconfigured route`
8. `getPointValue: returns configured paise value for configured route`

## Must Not Change
- Existing credit schema tables (card_details, card_issuer_settings, reward_entries, etc.)
- apps/api/src/modules/shopping/ (task 070's files)
- apps/api/src/modules/automation/ (task 073 already updated it)
- reward_entries table (reward_point_lots is additive — different concern)

## Commands
1. `npm run db:generate -w apps/api`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api` (snapshot failures on first run → update snapshots → re-run)
5. `npm run test -w packages/shared`

## Required Evidence
- All files changed with line counts
- Complete diff
- Migration SQL content
- All command outputs and exit codes
- Any plan deviations or blockers
