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
  sortOrder: z.number().int(),
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

export const ReorderGoalsSchema = z.object({
  goalIds: z.array(z.uuid()).min(1),
});
export type ReorderGoals = z.infer<typeof ReorderGoalsSchema>;

// ---------- Projection settings ----------

export const ProjectionSettingsSchema = z.object({
  /** Broad-equity annual return assumption, in basis points (1200 = 12%). */
  equityReturnBps: z.number().int().min(0).max(10_000),
});
export type ProjectionSettings = z.infer<typeof ProjectionSettingsSchema>;

export const UpdateProjectionSettingsSchema = ProjectionSettingsSchema;
export type UpdateProjectionSettings = z.infer<typeof UpdateProjectionSettingsSchema>;

/** One account/holding earmarked to a goal, with the growth rate its projection uses. */
export const GoalAssetProgressSchema = z.object({
  kind: z.enum(["account", "holding"]),
  id: z.uuid(),
  name: z.string(),
  subtitle: z.string(),
  valuePaise: z.number().int(),
  /** assumed annual return, basis points (710 = 7.10%) */
  annualReturnBps: z.number().int(),
  allocationClass: z.enum(["equity", "debt", "other"]),
});
export type GoalAssetProgress = z.infer<typeof GoalAssetProgressSchema>;

/**
 * Prescriptive plan for a goal: the recommended equity/debt mix (derived from the
 * goal's time horizon — longer to target = more equity) and the monthly
 * contribution to stay on track, split to that mix. Distinct from the descriptive
 * `equityPct`/`debtPct` on GoalProgress, which report the *current* holdings.
 */
export const GoalPlanSchema = z.object({
  /** on_track / behind (has a target date), or no_target (undated goal) */
  status: z.enum(["on_track", "behind", "no_target"]),
  /** recommended allocation; equity + debt = 100 */
  targetEquityPct: z.number().min(0).max(100),
  targetDebtPct: z.number().min(0).max(100),
  /** true when the current equity mix drifts from target beyond the rebalance band */
  allocationDrifted: z.boolean(),
  /** monthly contribution to hit the target by its date; null without a target date */
  recommendedMonthlyPaise: z.number().int().nullable(),
  /** the recommended monthly amount split to the target mix (0 when none recommended) */
  monthlyEquityPaise: z.number().int(),
  monthlyDebtPaise: z.number().int(),
  /** sum of the goal's active SIPs, paise/month (0 with none) */
  committedMonthlyPaise: z.number().int(),
  committedEquityPaise: z.number().int(),
  committedDebtPaise: z.number().int(),
  /** max(0, recommended − committed), per leg and total — what the SIPs don't yet cover */
  gapMonthlyPaise: z.number().int(),
  gapEquityPaise: z.number().int(),
  gapDebtPaise: z.number().int(),
});
export type GoalPlan = z.infer<typeof GoalPlanSchema>;

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
  /** Current mapped-asset allocation by market value; percentages sum to 100. */
  equityPct: z.number().min(0).max(100),
  debtPct: z.number().min(0).max(100),
  otherPct: z.number().min(0).max(100),
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
  /** recommended allocation + monthly investment proposal (see GoalPlanSchema) */
  plan: GoalPlanSchema,
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
  // Autopilot: forward-looking cash-flow shortfall (projected, not reactive).
  "cash_runway",
  // Autopilot: weekly goal contribution / rebalance advice (distinct from the
  // "goal" milestone alerts, so it can be muted independently).
  "goal_plan",
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
