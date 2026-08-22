import { and, eq } from "drizzle-orm";
import type { CreateRewardRule, RewardCapPeriod, RewardRedemptionRoute, RewardRule, UpdateRewardRule } from "@compass/shared";
import { CreateRewardRuleSchema, UpdateRewardRuleSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { rewardRules } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type RuleRow = typeof rewardRules.$inferSelect;

function toRewardRule(row: RuleRow): RewardRule {
  return {
    id: row.id,
    cardProductName: row.cardProductName,
    network: row.network ?? null,
    baseEarnPer100: row.baseEarnPer100,
    mccExclusions: (row.mccExclusions as string[]) ?? [],
    accelEarnMultiplier: row.accelEarnMultiplier ?? null,
    accelEarnCapPaise: row.accelEarnCapPaise ?? null,
    accelEarnCapPeriod: (row.accelEarnCapPeriod as RewardCapPeriod | null) ?? null,
    redemptionValues: (row.redemptionValues as Record<string, number>) ?? {},
    milestoneSpendPaise: row.milestoneSpendPaise ?? null,
    milestoneBenefitDesc: row.milestoneBenefitDesc ?? null,
    annualFeeWaiverSpendPaise: row.annualFeeWaiverSpendPaise ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** List all reward rules for a user. */
export async function listRewardRules(db: Db, userId: string): Promise<RewardRule[]> {
  const rows = await db.query.rewardRules.findMany({
    where: eq(rewardRules.userId, userId),
    orderBy: (t, { asc }) => [asc(t.cardProductName)],
  });
  return rows.map(toRewardRule);
}

/**
 * Create a new reward rule. Throws 409 if a rule with the same
 * (userId, cardProductName) already exists.
 */
export async function createRewardRule(
  db: Db,
  userId: string,
  data: CreateRewardRule,
): Promise<RewardRule> {
  const parsed = CreateRewardRuleSchema.parse(data);

  // Check for duplicate
  const existing = await db.query.rewardRules.findFirst({
    where: and(
      eq(rewardRules.userId, userId),
      eq(rewardRules.cardProductName, parsed.cardProductName),
    ),
    columns: { id: true },
  });
  if (existing) throw new HttpError(409, "A reward rule for this card product already exists");

  const rows = await db
    .insert(rewardRules)
    .values({
      userId,
      cardProductName: parsed.cardProductName,
      network: parsed.network ?? null,
      baseEarnPer100: parsed.baseEarnPer100 ?? 0,
      mccExclusions: (parsed.mccExclusions ?? []) as string[],
      accelEarnMultiplier: parsed.accelEarnMultiplier ?? null,
      accelEarnCapPaise: parsed.accelEarnCapPaise ?? null,
      accelEarnCapPeriod: (parsed.accelEarnCapPeriod as RewardCapPeriod | null) ?? null,
      redemptionValues: (parsed.redemptionValues ?? {}) as Record<string, number>,
      milestoneSpendPaise: parsed.milestoneSpendPaise ?? null,
      milestoneBenefitDesc: parsed.milestoneBenefitDesc ?? null,
      annualFeeWaiverSpendPaise: parsed.annualFeeWaiverSpendPaise ?? null,
    })
    .returning();
  return toRewardRule(rows[0]!);
}

/**
 * Update an existing reward rule. Throws 404 if the rule doesn't belong to userId.
 * Supports partial updates.
 */
export async function updateRewardRule(
  db: Db,
  userId: string,
  ruleId: string,
  data: UpdateRewardRule,
): Promise<RewardRule> {
  const parsed = UpdateRewardRuleSchema.parse(data);

  const set: Partial<typeof rewardRules.$inferInsert> = { updatedAt: new Date() };
  if (parsed.cardProductName !== undefined) set.cardProductName = parsed.cardProductName;
  if (parsed.network !== undefined) set.network = parsed.network ?? null;
  if (parsed.baseEarnPer100 !== undefined) set.baseEarnPer100 = parsed.baseEarnPer100;
  if (parsed.mccExclusions !== undefined) set.mccExclusions = parsed.mccExclusions as string[];
  if (parsed.accelEarnMultiplier !== undefined) set.accelEarnMultiplier = parsed.accelEarnMultiplier ?? null;
  if (parsed.accelEarnCapPaise !== undefined) set.accelEarnCapPaise = parsed.accelEarnCapPaise ?? null;
  if (parsed.accelEarnCapPeriod !== undefined) set.accelEarnCapPeriod = (parsed.accelEarnCapPeriod as RewardCapPeriod | null) ?? null;
  if (parsed.redemptionValues !== undefined) set.redemptionValues = parsed.redemptionValues as Record<string, number>;
  if (parsed.milestoneSpendPaise !== undefined) set.milestoneSpendPaise = parsed.milestoneSpendPaise ?? null;
  if (parsed.milestoneBenefitDesc !== undefined) set.milestoneBenefitDesc = parsed.milestoneBenefitDesc ?? null;
  if (parsed.annualFeeWaiverSpendPaise !== undefined) set.annualFeeWaiverSpendPaise = parsed.annualFeeWaiverSpendPaise ?? null;

  const rows = await db
    .update(rewardRules)
    .set(set)
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Reward rule not found");
  return toRewardRule(rows[0]!);
}

/**
 * Delete a reward rule. Throws 404 if the rule doesn't belong to userId.
 */
export async function deleteRewardRule(
  db: Db,
  userId: string,
  ruleId: string,
): Promise<void> {
  const rows = await db
    .delete(rewardRules)
    .where(and(eq(rewardRules.id, ruleId), eq(rewardRules.userId, userId)))
    .returning({ id: rewardRules.id });
  if (rows.length === 0) throw new HttpError(404, "Reward rule not found");
}

/**
 * Computes the effective points earned for a spend, accounting for MCC exclusions
 * and the accelerated earn cap.
 *
 * @param rule - the reward rule
 * @param spendPaise - the spend amount in paise (must be >= 0)
 * @param mcc - merchant category code (string), or null/undefined if unknown
 * @param priorEligibleSpendInPeriodPaise - cumulative eligible spend in the cap period so far
 * @returns earned points (non-negative integer)
 */
export function getEffectiveEarnPoints(
  rule: RewardRule,
  spendPaise: number,
  mcc: string | null | undefined,
  priorEligibleSpendInPeriodPaise: number,
): number {
  // 1. MCC exclusion → 0 points
  if (mcc != null && rule.mccExclusions.includes(mcc)) return 0;

  const base = rule.baseEarnPer100;

  // 2. No accel config → base rate only
  if (
    rule.accelEarnMultiplier == null ||
    rule.accelEarnCapPaise == null
  ) {
    return Math.floor((spendPaise * base) / 10000);
  }

  // 3. Accel config: split spend at the cap boundary
  const remainingCapPaise = Math.max(0, rule.accelEarnCapPaise - priorEligibleSpendInPeriodPaise);
  const eligibleAtAccel = Math.min(spendPaise, remainingCapPaise);
  const eligibleAtBase = spendPaise - eligibleAtAccel;

  return (
    Math.floor((eligibleAtAccel * rule.accelEarnMultiplier * base) / 10000) +
    Math.floor((eligibleAtBase * base) / 10000)
  );
}

/**
 * Gets the value of 1 point in paise for the given redemption route.
 * Returns null if the route is not configured — callers must exclude this card
 * from any value comparison.
 */
export function getPointValue(rule: RewardRule, route: RewardRedemptionRoute): number | null {
  const val = (rule.redemptionValues as Record<string, number>)[route];
  return val !== undefined ? val : null;
}
