import { z } from "zod";
import { TransactionSchema } from "./ledger.ts";

// ---------- Budgets ----------

export const BudgetPeriodSchema = z.enum(["monthly", "annual"]);
export type BudgetPeriod = z.infer<typeof BudgetPeriodSchema>;

/** "2026-07" (monthly) or "2026" (annual) */
export const PeriodKeySchema = z.string().regex(/^\d{4}(-\d{2})?$/);

export const BudgetLineSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  amountPaise: z.number().int().min(0),
  rollover: z.boolean(),
});
export type BudgetLine = z.infer<typeof BudgetLineSchema>;

export const BudgetSchema = z.object({
  id: z.uuid(),
  period: BudgetPeriodSchema,
  periodKey: PeriodKeySchema,
  lines: z.array(BudgetLineSchema),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BudgetLineInputSchema = z.object({
  categoryId: z.uuid(),
  amountPaise: z.number().int().min(0),
  rollover: z.boolean().default(false),
});

export const CreateBudgetSchema = z.object({
  period: BudgetPeriodSchema.default("monthly"),
  periodKey: PeriodKeySchema,
  lines: z.array(BudgetLineInputSchema).min(1),
});
export type CreateBudget = z.input<typeof CreateBudgetSchema>;

export const UpsertBudgetLineSchema = BudgetLineInputSchema;

export const UtilizationLineSchema = z.object({
  categoryId: z.uuid(),
  budgetedPaise: z.number().int(),
  carryPaise: z.number().int(),
  spentPaise: z.number().int(),
  remainingPaise: z.number().int(),
  rollover: z.boolean(),
});
export type UtilizationLine = z.infer<typeof UtilizationLineSchema>;

export const BudgetUtilizationSchema = z.object({
  budgetId: z.uuid().nullable(),
  period: BudgetPeriodSchema,
  periodKey: PeriodKeySchema,
  closed: z.boolean(),
  lines: z.array(UtilizationLineSchema),
  totalBudgetedPaise: z.number().int(),
  totalSpentPaise: z.number().int(),
});
export type BudgetUtilization = z.infer<typeof BudgetUtilizationSchema>;

export const BudgetSuggestionSchema = z.object({
  categoryId: z.uuid(),
  avgMonthlyPaise: z.number().int(),
});

export const BudgetComparisonSchema = z.object({
  periodKey: PeriodKeySchema,
  lines: z.array(
    z.object({
      categoryId: z.uuid(),
      budgetedPaise: z.number().int().nullable(),
      spentPaise: z.number().int(),
      lastSpentPaise: z.number().int(),
      avg3moPaise: z.number().int(),
    }),
  ),
});
export type BudgetComparison = z.infer<typeof BudgetComparisonSchema>;

// ---------- Notifications ----------

export const NotificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationsPageSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int(),
});

// ---------- Dashboard ----------

export const DashboardSchema = z.object({
  cashAvailablePaise: z.number().int(),
  month: z.object({
    periodKey: PeriodKeySchema,
    incomePaise: z.number().int(),
    expensePaise: z.number().int(),
  }),
  budget: z.object({
    totalBudgetedPaise: z.number().int(),
    totalSpentPaise: z.number().int(),
    lines: z.array(UtilizationLineSchema),
  }),
  recent: z.array(TransactionSchema),
  byCategory: z.array(
    z.object({ categoryId: z.uuid().nullable(), spentPaise: z.number().int() }),
  ),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

// ---------- Trends ----------

export const TrendMonthSchema = z.object({
  month: z.string(),
  incomePaise: z.number().int(),
  expensePaise: z.number().int(),
  byCategory: z.array(z.object({ categoryId: z.uuid().nullable(), spentPaise: z.number().int() })),
});
export type TrendMonth = z.infer<typeof TrendMonthSchema>;

export const TrendsSchema = z.object({ months: z.array(TrendMonthSchema) });
export type Trends = z.infer<typeof TrendsSchema>;

// ---------- Recurring ----------

export const RecurringFrequencySchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type RecurringFrequency = z.infer<typeof RecurringFrequencySchema>;

export const RecurringTemplateSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  merchant: z.string(),
  amountPaise: z.number().int(),
  notes: z.string(),
  frequency: RecurringFrequencySchema,
  interval: z.number().int().min(1),
  nextDueDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  paused: z.boolean(),
  kind: z.enum(["none", "bill", "subscription", "insurance", "emi"]),
  remindDays: z.number().int().nullable(),
  resourceId: z.uuid().nullable(),
});
export type RecurringTemplate = z.infer<typeof RecurringTemplateSchema>;

export const CreateRecurringTemplateSchema = z.object({
  accountId: z.uuid(),
  categoryId: z.uuid().nullable().default(null),
  merchant: z.string().min(1),
  amountPaise: z
    .number()
    .int()
    .refine((v) => v !== 0, "Amount cannot be zero"),
  notes: z.string().default(""),
  frequency: RecurringFrequencySchema,
  interval: z.number().int().min(1).default(1),
  nextDueDate: z.iso.date(),
  endDate: z.iso.date().nullable().default(null),
  kind: z.enum(["none", "bill", "subscription", "insurance", "emi"]).default("none"),
  remindDays: z.number().int().min(0).max(60).nullable().default(null),
  resourceId: z.uuid().nullable().default(null),
});
export type CreateRecurringTemplate = z.input<typeof CreateRecurringTemplateSchema>;

export const UpdateRecurringTemplateSchema = CreateRecurringTemplateSchema.partial().extend({
  paused: z.boolean().optional(),
});
export type UpdateRecurringTemplate = z.infer<typeof UpdateRecurringTemplateSchema>;
