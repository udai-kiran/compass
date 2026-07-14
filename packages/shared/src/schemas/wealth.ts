import { z } from "zod";

// ---------- Credit cards ----------

export const CardDetailsSchema = z.object({
  accountId: z.uuid(),
  cycleDay: z.number().int().min(1).max(28),
  dueDay: z.number().int().min(1).max(28),
  creditLimitPaise: z.number().int().min(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable(),
  remindDays: z.number().int().min(0).max(30),
  earnRatePer100: z.number().int().min(0),
});
export type CardDetails = z.infer<typeof CardDetailsSchema>;

export const UpsertCardDetailsSchema = z.object({
  cycleDay: z.number().int().min(1).max(28).default(1),
  dueDay: z.number().int().min(1).max(28).default(15),
  creditLimitPaise: z.number().int().min(0).default(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable().default(30),
  remindDays: z.number().int().min(0).max(30).default(3),
  earnRatePer100: z.number().int().min(0).default(0),
});
export type UpsertCardDetails = z.input<typeof UpsertCardDetailsSchema>;

export const CardSummarySchema = z.object({
  accountId: z.uuid(),
  name: z.string(),
  details: CardDetailsSchema.nullable(),
  /** current signed balance (negative = owed) */
  balancePaise: z.number().int(),
  /** last closed statement */
  statementStart: z.iso.date().nullable(),
  statementEnd: z.iso.date().nullable(),
  amountDuePaise: z.number().int(),
  dueDate: z.iso.date().nullable(),
  /** spend in the running (unclosed) period */
  currentSpendPaise: z.number().int(),
  utilizationPct: z.number().nullable(),
  rewardPoints: z.number().int(),
});
export type CardSummary = z.infer<typeof CardSummarySchema>;

export const RewardEntrySchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  points: z.number().int(),
  note: z.string(),
});
export type RewardEntry = z.infer<typeof RewardEntrySchema>;

export const CreateRewardEntrySchema = z.object({
  date: z.iso.date(),
  points: z
    .number()
    .int()
    .refine((v) => v !== 0, "Points cannot be zero"),
  note: z.string().default(""),
});
export type CreateRewardEntry = z.input<typeof CreateRewardEntrySchema>;

// ---------- EMIs ----------

export const UpsertEmiDetailsSchema = z.object({
  principalPaise: z.number().int().positive(),
  annualRateBps: z.number().int().min(0).max(10000),
  totalInstallments: z.number().int().min(1).max(600),
  startDate: z.iso.date(),
});
export type UpsertEmiDetails = z.input<typeof UpsertEmiDetailsSchema>;

export const CreateEmiSchema = z.object({
  accountId: z.uuid(),
  name: z.string().min(1),
  categoryId: z.uuid().nullable().default(null),
  principalPaise: z.number().int().positive(),
  annualRateBps: z.number().int().min(0).max(10000),
  totalInstallments: z.number().int().min(1).max(600),
  startDate: z.iso.date(),
});
export type CreateEmi = z.input<typeof CreateEmiSchema>;

export const EmiSummarySchema = z.object({
  templateId: z.uuid(),
  merchant: z.string(),
  installmentPaise: z.number().int(),
  principalPaise: z.number().int(),
  annualRateBps: z.number().int(),
  totalInstallments: z.number().int(),
  paidInstallments: z.number().int(),
  remainingInstallments: z.number().int(),
  totalInterestPaise: z.number().int(),
  outstandingPaise: z.number().int(),
  payoffDate: z.iso.date(),
  paused: z.boolean(),
});
export type EmiSummary = z.infer<typeof EmiSummarySchema>;

// ---------- Holdings & portfolio ----------

export const AssetClassSchema = z.enum([
  "stock",
  "mutual_fund",
  "etf",
  "gold",
  "fd",
  "epf",
  "ppf",
  "nps",
  "other",
]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const HoldingSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  assetClass: AssetClassSchema,
  notes: z.string(),
  targetPct: z.number().int().nullable(),
  archived: z.boolean(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const CreateHoldingSchema = z.object({
  name: z.string().min(1),
  assetClass: AssetClassSchema,
  notes: z.string().default(""),
  targetPct: z.number().int().min(0).max(100).nullable().default(null),
});
export type CreateHolding = z.input<typeof CreateHoldingSchema>;

export const UpdateHoldingSchema = z.object({
  name: z.string().min(1).optional(),
  assetClass: AssetClassSchema.optional(),
  notes: z.string().optional(),
  targetPct: z.number().int().min(0).max(100).nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateHolding = z.infer<typeof UpdateHoldingSchema>;

export const HoldingEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(["buy", "sell", "dividend"]),
  date: z.iso.date(),
  amountPaise: z.number().int(),
  units: z.number().nullable(),
  note: z.string(),
});
export type HoldingEvent = z.infer<typeof HoldingEventSchema>;

export const CreateHoldingEventSchema = z.object({
  type: z.enum(["buy", "sell", "dividend"]),
  date: z.iso.date(),
  amountPaise: z.number().int().positive(),
  units: z.number().positive().nullable().default(null),
  note: z.string().default(""),
});
export type CreateHoldingEvent = z.input<typeof CreateHoldingEventSchema>;

export const SetValuationSchema = z.object({
  date: z.iso.date(),
  valuePaise: z.number().int().min(0),
});
export type SetValuation = z.input<typeof SetValuationSchema>;

export const HoldingPositionSchema = HoldingSchema.extend({
  investedPaise: z.number().int(),
  currentValuePaise: z.number().int(),
  unrealizedPaise: z.number().int(),
  dividendsPaise: z.number().int(),
  lastValuationDate: z.iso.date().nullable(),
  events: z.array(HoldingEventSchema),
});
export type HoldingPosition = z.infer<typeof HoldingPositionSchema>;

export const PortfolioSchema = z.object({
  totalInvestedPaise: z.number().int(),
  totalValuePaise: z.number().int(),
  totalDividendsPaise: z.number().int(),
  positions: z.array(HoldingPositionSchema),
  allocation: z.array(
    z.object({
      assetClass: AssetClassSchema,
      valuePaise: z.number().int(),
      targetPct: z.number().int().nullable(),
    }),
  ),
  growth: z.array(
    z.object({
      month: z.string(),
      investedPaise: z.number().int(),
      valuePaise: z.number().int(),
    }),
  ),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;

// ---------- Net worth ----------

export const NetWorthPointSchema = z.object({
  date: z.iso.date(),
  assetsPaise: z.number().int(),
  liabilitiesPaise: z.number().int(),
  netPaise: z.number().int(),
  estimated: z.boolean(),
});
export type NetWorthPoint = z.infer<typeof NetWorthPointSchema>;

export const NetWorthReportSchema = z.object({
  current: z.object({
    assetsPaise: z.number().int(),
    liabilitiesPaise: z.number().int(),
    netPaise: z.number().int(),
    breakdown: z.object({
      cashPaise: z.number().int(),
      investmentAccountsPaise: z.number().int(),
      holdingsPaise: z.number().int(),
      creditCardsPaise: z.number().int(),
      loansPaise: z.number().int(),
    }),
  }),
  history: z.array(NetWorthPointSchema),
  /** simple trend projection, next 6 month-end points */
  forecast: z.array(z.object({ date: z.iso.date(), netPaise: z.number().int() })),
});
export type NetWorthReport = z.infer<typeof NetWorthReportSchema>;
