import { z } from "zod";

// ---------- Goals ----------

export const GoalTypeSchema = z.enum([
  "savings",
  "emergency_fund",
  "vacation",
  "home",
  "vehicle",
  "education",
  "retirement",
  "custom",
]);
export type GoalType = z.infer<typeof GoalTypeSchema>;

export const GoalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: GoalTypeSchema,
  targetPaise: z.number().int().nullable(),
  targetMonths: z.number().int().nullable(),
  targetDate: z.iso.date().nullable(),
  accountId: z.uuid().nullable(),
  archived: z.boolean(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const CreateGoalSchema = z
  .object({
    name: z.string().min(1),
    type: GoalTypeSchema.default("savings"),
    targetPaise: z.number().int().positive().nullable().default(null),
    targetMonths: z.number().int().min(1).max(36).nullable().default(null),
    targetDate: z.iso.date().nullable().default(null),
    accountId: z.uuid().nullable().default(null),
  })
  .check((ctx) => {
    if (ctx.value.type === "emergency_fund") {
      if (ctx.value.targetMonths === null && ctx.value.targetPaise === null) {
        ctx.issues.push({
          code: "custom",
          message: "Emergency fund needs targetMonths (or an explicit targetPaise)",
          input: ctx.value,
        });
      }
    } else if (ctx.value.targetPaise === null) {
      ctx.issues.push({ code: "custom", message: "targetPaise is required", input: ctx.value });
    }
  });
export type CreateGoal = z.input<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z.object({
  name: z.string().min(1).optional(),
  targetPaise: z.number().int().positive().nullable().optional(),
  targetMonths: z.number().int().min(1).max(36).nullable().optional(),
  targetDate: z.iso.date().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateGoal = z.infer<typeof UpdateGoalSchema>;

export const GoalContributionSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid().nullable(),
  amountPaise: z.number().int(),
  date: z.iso.date(),
  note: z.string(),
});
export type GoalContribution = z.infer<typeof GoalContributionSchema>;

export const CreateContributionSchema = z.object({
  amountPaise: z
    .number()
    .int()
    .refine((v) => v !== 0, "Amount cannot be zero"),
  date: z.iso.date(),
  note: z.string().default(""),
});

export const GoalProgressSchema = GoalSchema.extend({
  /** resolved target (emergency fund: months × trailing avg expenses) */
  effectiveTargetPaise: z.number().int(),
  savedPaise: z.number().int(),
  remainingPaise: z.number().int(),
  percent: z.number(),
  /** trailing 3-month contribution rate, paise/month */
  monthlyRatePaise: z.number().int(),
  /** months to completion at the current rate; null if rate <= 0 */
  projectedMonths: z.number().nullable(),
  projectedDate: z.iso.date().nullable(),
  /** required monthly contribution to hit targetDate; null without a target date */
  requiredMonthlyPaise: z.number().int().nullable(),
  onTrack: z.boolean().nullable(),
  contributions: z.array(GoalContributionSchema),
});
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

// ---------- Cash flow & forecast ----------

export const CashflowMonthSchema = z.object({
  month: z.string(),
  incomePaise: z.number().int(),
  expensePaise: z.number().int(),
  netPaise: z.number().int(),
});
export type CashflowMonth = z.infer<typeof CashflowMonthSchema>;

export const ForecastSchema = z.object({
  startBalancePaise: z.number().int(),
  /** months of runway at current net burn; null when cash-flow positive */
  runwayMonths: z.number().nullable(),
  avgMonthlyBurnPaise: z.number().int(),
  days: z.array(
    z.object({
      date: z.iso.date(),
      balancePaise: z.number().int(),
      obligations: z.array(z.object({ merchant: z.string(), amountPaise: z.number().int() })),
    }),
  ),
});
export type Forecast = z.infer<typeof ForecastSchema>;

// ---------- Bills & subscriptions ----------

export const RecurringKindSchema = z.enum(["none", "bill", "subscription", "insurance", "emi"]);
export type RecurringKind = z.infer<typeof RecurringKindSchema>;

export const BillOccurrenceSchema = z.object({
  templateId: z.uuid(),
  merchant: z.string(),
  amountPaise: z.number().int(),
  dueDate: z.iso.date(),
  kind: RecurringKindSchema,
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  paused: z.boolean(),
});
export type BillOccurrence = z.infer<typeof BillOccurrenceSchema>;

export const SubscriptionSuggestionSchema = z.object({
  merchant: z.string(),
  avgAmountPaise: z.number().int(),
  occurrences: z.number().int(),
  periodicity: z.enum(["monthly", "yearly"]),
  lastDate: z.iso.date(),
  nextExpectedDate: z.iso.date(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
});
export type SubscriptionSuggestion = z.infer<typeof SubscriptionSuggestionSchema>;

// ---------- Notification preferences ----------

export const NotificationTypeSchema = z.enum([
  "budget",
  "bill",
  "goal",
  "large_transaction",
  "low_balance",
  "anomaly",
]);

/** Anomaly detector sensitivity → z-score threshold (higher = fires more readily). */
export const AnomalySensitivitySchema = z.enum(["off", "low", "normal", "high"]);
export type AnomalySensitivity = z.infer<typeof AnomalySensitivitySchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationPrefSchema = z.object({
  type: NotificationTypeSchema,
  accountId: z.uuid().nullable(),
  enabled: z.boolean(),
  thresholdPaise: z.number().int().nullable(),
  leadDays: z.number().int().nullable(),
});
export type NotificationPref = z.infer<typeof NotificationPrefSchema>;

export const UpsertNotificationPrefSchema = z.object({
  type: NotificationTypeSchema,
  accountId: z.uuid().nullable().default(null),
  enabled: z.boolean().default(true),
  thresholdPaise: z.number().int().positive().nullable().default(null),
  leadDays: z.number().int().min(0).max(60).nullable().default(null),
});
export type UpsertNotificationPref = z.input<typeof UpsertNotificationPrefSchema>;
