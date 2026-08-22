/**
 * credit.ts — shared Zod response schemas for the v2.2.0 revolving-debt endpoint.
 *
 * Source of truth: apps/api/src/modules/credit/services/revolving-debt.ts.
 * Compile-time parity assertions live in
 * apps/api/src/modules/credit/services/credit-schemas.test.ts.
 *
 * Money is always integer paise (minor units). The local `paiseField` helper
 * uses z.number().int().safe(). In the installed Zod 4.4.3, `.int()` already
 * rejects NaN, ±Infinity, and values outside the safe-integer range; `.safe()`
 * is therefore redundant but is retained as an explicit safe-integer guard and
 * as insurance should `.int()` semantics change in a future Zod release.
 *
 * Temporal strings:
 *   YYYY-MM → explicit regex refinement (StatementPaymentStatus.period)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Local money helper — NOT exported
// ---------------------------------------------------------------------------

/**
 * Integer paise field. In Zod 4.4.3, `.int()` already rejects NaN, ±Infinity,
 * and values outside the safe-integer range; `.safe()` is retained as a
 * redundant-but-explicit safe-integer guard for documentation clarity.
 */
function paiseField() {
  return z.number().int().safe();
}

// ---------------------------------------------------------------------------
// Temporal helpers
// ---------------------------------------------------------------------------

/** YYYY-MM year-month string (StatementPaymentStatus.period). */
const yearMonthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a YYYY-MM year-month string");

// ---------------------------------------------------------------------------
// Revolving-debt schemas
// ---------------------------------------------------------------------------

export const PaymentStateSchema = z.enum([
  "unpaid",
  "minimum_only",
  "partial",
  "paid_in_full",
  "unknown",
]);
export type PaymentState = z.output<typeof PaymentStateSchema>;

export const StatementPaymentStatusSchema = z.object({
  accountId: z.string(),
  /** "YYYY-MM" period key */
  period: yearMonthString,
  /** from statement_reconciliations; null when not stated */
  totalDuePaise: paiseField().nullable(),
  /** from statement_reconciliations */
  minDuePaise: paiseField().nullable(),
  /** sum of positive postings to card account between close date and due date */
  paidByDueDatePaise: paiseField(),
  state: PaymentStateSchema,
  /** estimated revolving balance = max(0, totalDuePaise - paidByDueDatePaise) */
  revolvingBalancePaise: paiseField(),
  /**
   * Estimated monthly finance charge in paise; null when aprBps is null.
   */
  estimatedMonthlyChargePaise: paiseField().nullable(),
});
export type StatementPaymentStatus = z.output<typeof StatementPaymentStatusSchema>;

export const CardRevolvingStatusSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  /** the most recent statement's status (last 2 months); null if no recent statement */
  latestStatement: StatementPaymentStatusSchema.nullable(),
  isRevolving: z.boolean(),
  revolvingBalancePaise: paiseField(),
});
export type CardRevolvingStatus = z.output<typeof CardRevolvingStatusSchema>;

export const HouseholdRevolvingDebtSchema = z.object({
  cards: z.array(CardRevolvingStatusSchema),
  totalRevolvingPaise: paiseField(),
  hasRevolvingDebt: z.boolean(),
  totalMonthlyChargePaise: paiseField(),
});
export type HouseholdRevolvingDebt = z.output<typeof HouseholdRevolvingDebtSchema>;

// ---------------------------------------------------------------------------
// Card Offer schemas (task 10.4)
// ---------------------------------------------------------------------------

export const CardOfferDiscountKindSchema = z.enum([
  "flat",
  "percentage",
  "cashback",
  "points",
]);
export type CardOfferDiscountKind = z.infer<typeof CardOfferDiscountKindSchema>;

export const CardOfferSchema = z.object({
  id: z.uuid(),
  platform: z.string().min(1),
  issuer: z.string().min(1),
  cardProductName: z.string().nullable(),
  discountKind: CardOfferDiscountKindSchema,
  discountRateBps: z.number().int().nonnegative(),
  maxCapPaise: z.number().int().nonnegative().nullable(),
  minSpendPaise: z.number().int().nonnegative().nullable(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  stackable: z.boolean(),
  isReviewed: z.boolean(),
  sourceEmailId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CardOffer = z.infer<typeof CardOfferSchema>;

export const CreateCardOfferSchema = z.object({
  platform: z.string().min(1).max(120).trim(),
  issuer: z.string().min(1).max(120).trim(),
  cardProductName: z.string().max(200).nullable().default(null),
  discountKind: CardOfferDiscountKindSchema,
  discountRateBps: z.number().int().nonnegative(),
  maxCapPaise: z.number().int().nonnegative().nullable().default(null),
  minSpendPaise: z.number().int().nonnegative().nullable().default(null),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  stackable: z.boolean().default(false),
  raw: z.string().nullable().default(null),
});
export type CreateCardOffer = z.input<typeof CreateCardOfferSchema>;

// ---------------------------------------------------------------------------
// Reward rules & point lots (task 10.5)
// ---------------------------------------------------------------------------

export const RewardRedemptionRouteSchema = z.enum([
  "cashback",
  "air_miles",
  "catalogue",
  "statement_credit",
]);
export type RewardRedemptionRoute = z.infer<typeof RewardRedemptionRouteSchema>;

export const RewardCapPeriodSchema = z.enum([
  "per_transaction",
  "monthly",
  "statement_cycle",
  "annual",
]);
export type RewardCapPeriod = z.infer<typeof RewardCapPeriodSchema>;

const cardNetworkEnum = z.enum(["visa", "mastercard", "amex", "rupay", "diners"]);

/**
 * Partial record of redemption route → paise-per-point.
 * Absent routes have no configured value; getPointValue returns null for them.
 */
const redemptionValuesSchema = z.record(z.string(), z.number().int().nonnegative());
export type RedemptionValues = Record<string, number>;

export const RewardRuleSchema = z.object({
  id: z.uuid(),
  cardProductName: z.string().min(1),
  network: cardNetworkEnum.nullable(),
  baseEarnPer100: z.number().int().nonnegative(),
  mccExclusions: z.array(z.string()),
  accelEarnMultiplier: z.number().int().positive().nullable(),
  accelEarnCapPaise: z.number().int().nonnegative().nullable(),
  accelEarnCapPeriod: RewardCapPeriodSchema.nullable(),
  redemptionValues: redemptionValuesSchema,
  milestoneSpendPaise: z.number().int().nonnegative().nullable(),
  milestoneBenefitDesc: z.string().nullable(),
  annualFeeWaiverSpendPaise: z.number().int().nonnegative().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RewardRule = z.infer<typeof RewardRuleSchema>;

function accelConsistencyCheck(v: {
  accelEarnMultiplier: number | null | undefined;
  accelEarnCapPaise: number | null | undefined;
  accelEarnCapPeriod: RewardCapPeriod | null | undefined;
}): boolean {
  const accelFields = [v.accelEarnMultiplier, v.accelEarnCapPaise, v.accelEarnCapPeriod];
  const nullCount = accelFields.filter((f) => f == null).length;
  return nullCount === 0 || nullCount === 3;
}

const ACCEL_CONSISTENCY_MESSAGE =
  "accelEarnMultiplier, accelEarnCapPaise, and accelEarnCapPeriod must all be set or all be null";

export const CreateRewardRuleSchema = z
  .object({
    cardProductName: z.string().min(1).max(200).trim(),
    network: cardNetworkEnum.nullable().default(null),
    baseEarnPer100: z.number().int().nonnegative().default(0),
    mccExclusions: z.array(z.string()).default([]),
    accelEarnMultiplier: z.number().int().positive().nullable().default(null),
    accelEarnCapPaise: z.number().int().nonnegative().nullable().default(null),
    accelEarnCapPeriod: RewardCapPeriodSchema.nullable().default(null),
    redemptionValues: redemptionValuesSchema.default({}),
    milestoneSpendPaise: z.number().int().nonnegative().nullable().default(null),
    milestoneBenefitDesc: z.string().max(500).nullable().default(null),
    annualFeeWaiverSpendPaise: z.number().int().nonnegative().nullable().default(null),
  })
  .refine(accelConsistencyCheck, { message: ACCEL_CONSISTENCY_MESSAGE });
export type CreateRewardRule = z.input<typeof CreateRewardRuleSchema>;

export const UpdateRewardRuleSchema = z
  .object({
    cardProductName: z.string().min(1).max(200).trim().optional(),
    network: cardNetworkEnum.nullable().optional(),
    baseEarnPer100: z.number().int().nonnegative().optional(),
    mccExclusions: z.array(z.string()).optional(),
    accelEarnMultiplier: z.number().int().positive().nullable().optional(),
    accelEarnCapPaise: z.number().int().nonnegative().nullable().optional(),
    accelEarnCapPeriod: RewardCapPeriodSchema.nullable().optional(),
    redemptionValues: redemptionValuesSchema.optional(),
    milestoneSpendPaise: z.number().int().nonnegative().nullable().optional(),
    milestoneBenefitDesc: z.string().max(500).nullable().optional(),
    annualFeeWaiverSpendPaise: z.number().int().nonnegative().nullable().optional(),
  })
  .refine(
    (v) =>
      accelConsistencyCheck({
        accelEarnMultiplier: v.accelEarnMultiplier ?? null,
        accelEarnCapPaise: v.accelEarnCapPaise ?? null,
        accelEarnCapPeriod: v.accelEarnCapPeriod ?? null,
      }),
    { message: ACCEL_CONSISTENCY_MESSAGE },
  );
export type UpdateRewardRule = z.input<typeof UpdateRewardRuleSchema>;

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
export type CreateRewardPointLot = z.input<typeof CreateRewardPointLotSchema>;
