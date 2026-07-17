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
  type: GoalTypeSchema.optional(),
  targetPaise: z.number().int().positive().nullable().optional(),
  targetMonths: z.number().int().min(1).max(36).nullable().optional(),
  targetDate: z.iso.date().nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateGoal = z.infer<typeof UpdateGoalSchema>;

/** One account/holding earmarked to a goal, with the growth rate its projection uses. */
export const GoalAssetProgressSchema = z.object({
  kind: z.enum(["account", "holding"]),
  id: z.uuid(),
  name: z.string(),
  subtitle: z.string(),
  valuePaise: z.number().int(),
  /** assumed annual return, basis points (710 = 7.10%) */
  annualReturnBps: z.number().int(),
});
export type GoalAssetProgress = z.infer<typeof GoalAssetProgressSchema>;

export const GoalProgressSchema = GoalSchema.extend({
  /** resolved target (emergency fund: months × trailing avg expenses) */
  effectiveTargetPaise: z.number().int(),
  /** current market value of every asset mapped to this goal */
  fundedPaise: z.number().int(),
  /** nominal gap today: max(0, target − funded) */
  remainingPaise: z.number().int(),
  percent: z.number(),
  /** value-weighted annual return of the mapped assets, basis points */
  blendedReturnBps: z.number().int(),
  /** trailing 3-month net inflow into the mapped accounts, paise/month */
  monthlyInflowPaise: z.number().int(),
  /** projected value at the target date (corpus growth + ongoing inflow); null without a target date */
  projectedValuePaise: z.number().int().nullable(),
  /** target − projectedValue (positive = behind); null without a target date */
  shortfallPaise: z.number().int().nullable(),
  /** months to reach the target from growth + inflow; null if unreachable or already met */
  projectedMonths: z.number().nullable(),
  projectedDate: z.iso.date().nullable(),
  /** required monthly inflow to hit targetDate given growth; null without a target date */
  requiredMonthlyPaise: z.number().int().nullable(),
  onTrack: z.boolean().nullable(),
  assets: z.array(GoalAssetProgressSchema),
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
