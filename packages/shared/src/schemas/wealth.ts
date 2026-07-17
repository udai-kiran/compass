import { z } from "zod";

// ---------- Credit cards ----------

export const CardNetworkSchema = z.enum(["visa", "mastercard", "amex", "rupay", "diners"]);
export type CardNetwork = z.infer<typeof CardNetworkSchema>;

/** Issuer and last-4 come from the account (institution/accountLast4), not from here. */
export const CardDetailsSchema = z.object({
  accountId: z.uuid(),
  network: CardNetworkSchema.nullable(),
  productName: z.string(),
  cycleDay: z.number().int().min(1).max(28),
  dueDay: z.number().int().min(1).max(28),
  creditLimitPaise: z.number().int().min(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable(),
  remindDays: z.number().int().min(0).max(30),
  earnRatePer100: z.number().int().min(0),
});
export type CardDetails = z.infer<typeof CardDetailsSchema>;

export const UpsertCardDetailsSchema = z.object({
  network: CardNetworkSchema.nullable().default(null),
  productName: z.string().default(""),
  cycleDay: z.number().int().min(1).max(28).default(1),
  dueDay: z.number().int().min(1).max(28).default(15),
  creditLimitPaise: z.number().int().min(0).default(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable().default(30),
  remindDays: z.number().int().min(0).max(30).default(3),
  earnRatePer100: z.number().int().min(0).default(0),
});
export type UpsertCardDetails = z.input<typeof UpsertCardDetailsSchema>;

// ---------- Retirement accounts (PPF / EPF) ----------

export const RetirementDetailsSchema = z.object({
  accountId: z.uuid(),
  annualRateBps: z.number().int(),
  maturityDate: z.iso.date().nullable(),
  referenceNumber: z.string(),
  /** EPF only: accumulated Employee Pension Scheme (EPS) balance, paise. Null elsewhere. */
  epsBalancePaise: z.number().int().nullable(),
});
export type RetirementDetails = z.infer<typeof RetirementDetailsSchema>;

export const UpsertRetirementDetailsSchema = z.object({
  /** basis points, so 7.10% = 710; capped at 100% */
  annualRateBps: z.number().int().min(0).max(10000).default(0),
  /** PPF matures 15 years from opening; EPF has none */
  maturityDate: z.iso.date().nullable().default(null),
  /** UAN (EPF) or account number (PPF) */
  referenceNumber: z.string().default(""),
  /** EPF only: EPS pension balance, paise; ignored (stored null) for PPF/SSY */
  epsBalancePaise: z.number().int().min(0).nullable().default(null),
});
export type UpsertRetirementDetails = z.input<typeof UpsertRetirementDetailsSchema>;

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

/** PPF/EPF are account types, not asset classes — see AccountTypeSchema. */
export const AssetClassSchema = z.enum(["stock", "mutual_fund", "etf", "gold", "fd", "nps", "other"]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

// ---------- NPS ----------

export const NpsTierSchema = z.enum(["tier_i", "tier_ii"]);
export type NpsTier = z.infer<typeof NpsTierSchema>;

export const NpsDetailsSchema = z.object({
  holdingId: z.uuid(),
  pran: z.string(),
  tier: NpsTierSchema,
  equityPct: z.number().int(),
  corporatePct: z.number().int(),
  govtPct: z.number().int(),
});
export type NpsDetails = z.infer<typeof NpsDetailsSchema>;

export const UpsertNpsDetailsSchema = z
  .object({
    pran: z.string().default(""),
    tier: NpsTierSchema.default("tier_i"),
    equityPct: z.number().int().min(0).max(100).default(0),
    corporatePct: z.number().int().min(0).max(100).default(0),
    govtPct: z.number().int().min(0).max(100).default(0),
  })
  .refine((v) => v.equityPct + v.corporatePct + v.govtPct === 100, {
    error: "Scheme allocation (E + C + G) must total 100%",
    path: ["equityPct"],
  });
export type UpsertNpsDetails = z.input<typeof UpsertNpsDetailsSchema>;

// ---------- Gold ----------

export const GoldFormSchema = z.enum(["physical", "digital", "etf", "sgb"]);
export type GoldForm = z.infer<typeof GoldFormSchema>;

export const GoldDetailsSchema = z.object({
  holdingId: z.uuid(),
  form: GoldFormSchema,
  purityKarat: z.number().int().nullable(),
  maturityDate: z.iso.date().nullable(),
});
export type GoldDetails = z.infer<typeof GoldDetailsSchema>;

export const UpsertGoldDetailsSchema = z
  .object({
    form: GoldFormSchema.default("physical"),
    /** karat only means something for metal you hold */
    purityKarat: z.union([z.literal(22), z.literal(24)]).nullable().default(null),
    /** SGBs mature 8 years from issue; other forms never do */
    maturityDate: z.iso.date().nullable().default(null),
  })
  .check((ctx) => {
    const paper = ctx.value.form === "etf" || ctx.value.form === "sgb";
    if (paper && ctx.value.purityKarat !== null) {
      ctx.issues.push({
        code: "custom",
        path: ["purityKarat"],
        message: `purity does not apply to ${ctx.value.form}`,
        input: ctx.value.purityKarat,
      });
    }
    if (ctx.value.form !== "sgb" && ctx.value.maturityDate !== null) {
      ctx.issues.push({
        code: "custom",
        path: ["maturityDate"],
        message: "only SGBs mature",
        input: ctx.value.maturityDate,
      });
    }
  });
export type UpsertGoldDetails = z.input<typeof UpsertGoldDetailsSchema>;

/** AMFI scheme code: 6 digits. Null = unmapped (no AMFI scheme / not looked up). */
export const AmfiSchemeCodeSchema = z.number().int().min(100000).max(999999).nullable();

export const HoldingSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  assetClass: AssetClassSchema,
  notes: z.string(),
  targetPct: z.number().int().nullable(),
  amfiSchemeCode: z.number().int().nullable(),
  folioNumber: z.string().nullable(),
  /** Goal this folio is earmarked for; null = Unassigned. */
  goalId: z.uuid().nullable(),
  archived: z.boolean(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const CreateHoldingSchema = z.object({
  name: z.string().min(1),
  assetClass: AssetClassSchema,
  notes: z.string().default(""),
  targetPct: z.number().int().min(0).max(100).nullable().default(null),
  amfiSchemeCode: AmfiSchemeCodeSchema.default(null),
  folioNumber: z.string().min(1).nullable().default(null),
});
export type CreateHolding = z.input<typeof CreateHoldingSchema>;

export const UpdateHoldingSchema = z.object({
  name: z.string().min(1).optional(),
  assetClass: AssetClassSchema.optional(),
  notes: z.string().optional(),
  targetPct: z.number().int().min(0).max(100).nullable().optional(),
  amfiSchemeCode: AmfiSchemeCodeSchema.optional(),
  folioNumber: z.string().min(1).nullable().optional(),
  goalId: z.uuid().nullable().optional(),
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

export const CreateHoldingEventSchema = z
  .object({
    type: z.enum(["buy", "sell", "dividend"]),
    date: z.iso.date(),
    amountPaise: z.number().int().positive(),
    units: z.number().positive().nullable().default(null),
    note: z.string().default(""),
  })
  // A buy/sell with no units carries money but no position, so every valuation
  // and NAV refresh would understate the holding. Only dividends may omit units.
  .refine((e) => e.type === "dividend" || e.units !== null, {
    error: "buy and sell events require units",
    path: ["units"],
  });
export type CreateHoldingEvent = z.input<typeof CreateHoldingEventSchema>;

export const SetValuationSchema = z.object({
  date: z.iso.date(),
  valuePaise: z.number().int().min(0),
});
export type SetValuation = z.input<typeof SetValuationSchema>;

export const HoldingPositionSchema = HoldingSchema.extend({
  /** Remaining cost basis of still-held units (average-cost), never negative. */
  investedPaise: z.number().int(),
  currentValuePaise: z.number().int(),
  /** currentValue − remaining cost basis; pure of realized gain. */
  unrealizedPaise: z.number().int(),
  /** Gain/loss booked on sells (proceeds − average cost of units sold). */
  realizedPaise: z.number().int(),
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

// ---------- NAV refresh + MF import ----------

/** Result of pulling AMFI NAVs and re-valuing mapped holdings. */
export const RefreshNavResultSchema = z.object({
  /** holdings re-valued from a fresh NAV */
  refreshed: z.number().int(),
  /** holdings skipped: no scheme code, or the code wasn't in the AMFI feed */
  skipped: z.number().int(),
  /** the NAV as-of date (AMFI publishes one date per run); null if nothing refreshed */
  asOf: z.iso.date().nullable(),
});
export type RefreshNavResult = z.infer<typeof RefreshNavResultSchema>;

/** One fund's rollup in an import preview: transactions grouped, scheme resolved. */
export const MfImportFundSchema = z.object({
  fundName: z.string(),
  folioNumber: z.string().nullable(),
  /** resolved AMFI scheme code, or null when the fund isn't in the map */
  amfiSchemeCode: z.number().int().nullable(),
  /** AMFI's official name for the resolved scheme, for the user to eyeball */
  canonicalName: z.string().nullable(),
  /** latest NAV from AMFI, when the scheme resolved and was in the feed */
  latestNav: z.number().nullable(),
  buyCount: z.number().int(),
  sellCount: z.number().int(),
  /** net units after buys − sells across the file */
  netUnits: z.number(),
  investedPaise: z.number().int(),
});
export type MfImportFund = z.infer<typeof MfImportFundSchema>;

export const MfImportPreviewSchema = z.object({
  funds: z.array(MfImportFundSchema),
  totalRows: z.number().int(),
  /** rows that couldn't be parsed (bad date/amount/order), reported not dropped silently */
  skippedRows: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  /** recognised bookkeeping rows that intentionally do not represent fund units */
  ignoredRows: z.array(z.object({ line: z.number().int(), reason: z.string() })),
});
export type MfImportPreview = z.infer<typeof MfImportPreviewSchema>;

export const MfImportResultSchema = z.object({
  holdingsCreated: z.number().int(),
  holdingsMatched: z.number().int(),
  eventsInserted: z.number().int(),
  /** events already present (same holding/date/type/units/amount) — skipped, so re-import is safe */
  eventsDuplicate: z.number().int(),
  valuationsSet: z.number().int(),
});
export type MfImportResult = z.infer<typeof MfImportResultSchema>;

/** Body for both preview and commit: the raw CSV text pasted or uploaded. */
export const MfImportInputSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});
export type MfImportInput = z.input<typeof MfImportInputSchema>;

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

// ---------- Net worth grouped by goal ----------

/** One tagged asset within a goal group. Liabilities carry a negative valuePaise. */
export const GoalAssetSchema = z.object({
  kind: z.enum(["account", "holding"]),
  id: z.uuid(),
  name: z.string(),
  /** e.g. account type, or a folio number — a hint under the name */
  subtitle: z.string(),
  /** signed: assets positive, liabilities negative, so a group sums to its net */
  valuePaise: z.number().int(),
  goalId: z.uuid().nullable(),
});
export type GoalAsset = z.infer<typeof GoalAssetSchema>;

export const GoalGroupSchema = z.object({
  /** null for the Unassigned and Liabilities groups */
  goalId: z.uuid().nullable(),
  goalName: z.string(),
  goalType: z.string().nullable(),
  targetPaise: z.number().int().nullable(),
  netPaise: z.number().int(),
  assetsPaise: z.number().int(),
  liabilitiesPaise: z.number().int(),
  /** whether the rows here can be earmarked to a goal — false for the Liabilities group */
  assignable: z.boolean(),
  items: z.array(GoalAssetSchema),
});
export type GoalGroup = z.infer<typeof GoalGroupSchema>;

export const NetWorthByGoalSchema = z.object({
  groups: z.array(GoalGroupSchema),
});
export type NetWorthByGoal = z.infer<typeof NetWorthByGoalSchema>;
