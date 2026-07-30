import { z } from "zod";

// ---------- Credit cards ----------

export const CardNetworkSchema = z.enum(["visa", "mastercard", "amex", "rupay", "diners"]);
export type CardNetwork = z.infer<typeof CardNetworkSchema>;

/**
 * Per-card fields. Issuer and last-4 come from the account (institution/
 * accountLast4); the genuinely shared fields (combined limit, mobile, alerts)
 * live on CardIssuerSettings. The statement-PDF password is per-card (issuers
 * like HDFC embed the card's last-4 in it), so it lives here.
 */
export const CardDetailsSchema = z.object({
  accountId: z.uuid(),
  network: CardNetworkSchema.nullable(),
  productName: z.string(),
  cycleDay: z.number().int().min(1).max(28),
  dueDay: z.number().int().min(1).max(28),
  earnRatePer100: z.number().int().min(0),
  /** whether a statement-PDF password is stored; the value itself is never sent out */
  hasStatementPassword: z.boolean(),
});
export type CardDetails = z.infer<typeof CardDetailsSchema>;

export const UpsertCardDetailsSchema = z.object({
  network: CardNetworkSchema.nullable().default(null),
  productName: z.string().default(""),
  /**
   * Issuing bank; stored on the account (accounts.institution), not card_details.
   * It's also the group key that joins a card to its issuer settings. Omit to
   * leave the issuer unchanged (so an older client that doesn't send this field
   * can't wipe it); pass "" to clear it, or a name to set it.
   */
  bankName: z.string().optional(),
  cycleDay: z.number().int().min(1).max(28).default(1),
  dueDay: z.number().int().min(1).max(28).default(15),
  earnRatePer100: z.number().int().min(0).default(0),
});
export type UpsertCardDetails = z.input<typeof UpsertCardDetailsSchema>;

/** Settings shared across every card of one bank/issuer, keyed by institution. */
export const CardIssuerSettingsSchema = z.object({
  institution: z.string(),
  /** combined credit limit shared across all this bank's cards */
  creditLimitPaise: z.number().int().min(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable(),
  remindDays: z.number().int().min(0).max(30),
  /** registered mobile (10 digits) for the bill-payment UPI VPA; "" when unset */
  billMobile: z.string(),
});
export type CardIssuerSettings = z.infer<typeof CardIssuerSettingsSchema>;

export const UpsertCardIssuerSettingsSchema = z.object({
  /** which issuer these settings belong to; must match a card's bank */
  institution: z.string().min(1),
  creditLimitPaise: z.number().int().min(0).default(0),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable().default(30),
  remindDays: z.number().int().min(0).max(30).default(3),
  billMobile: z.string().default(""),
});
export type UpsertCardIssuerSettings = z.input<typeof UpsertCardIssuerSettingsSchema>;

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

// ---------- NPS accounts ----------

export const AccountNpsDetailsSchema = z.object({
  accountId: z.uuid(),
  pran: z.string(),
  tier: z.enum(["tier_i", "tier_ii"]),
  equityPct: z.number().int(),
  corporatePct: z.number().int(),
  govtPct: z.number().int(),
});
export type AccountNpsDetails = z.infer<typeof AccountNpsDetailsSchema>;

export const UpsertAccountNpsDetailsSchema = z
  .object({
    pran: z.string().max(32).default(""),
    tier: z.enum(["tier_i", "tier_ii"]).default("tier_i"),
    equityPct: z.number().int().min(0).max(100).default(0),
    corporatePct: z.number().int().min(0).max(100).default(0),
    govtPct: z.number().int().min(0).max(100).default(0),
  })
  .refine((v) => v.equityPct + v.corporatePct + v.govtPct === 100, {
    error: "Scheme allocation (E + C + G) must total 100%",
    path: ["equityPct"],
  });
export type UpsertAccountNpsDetails = z.input<typeof UpsertAccountNpsDetailsSchema>;

export const CardSummarySchema = z.object({
  accountId: z.uuid(),
  name: z.string(),
  /** issuing bank, from the account's institution field */
  bankName: z.string().nullable(),
  /** last 4 digits of the card, from the account; needed to build the bill VPA */
  last4: z.string().nullable(),
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
  rewardPoints: z.number().int(),
});
export type CardSummary = z.infer<typeof CardSummarySchema>;

/**
 * A bank/issuer holder: its shared settings plus every card under it. Credit
 * limit and utilization are combined across the cards (India's typical shared
 * limit). `institution` is null for the "unassigned" holder grouping cards with
 * no bank set — each such card gets its own holder, and `settings` is null.
 */
export const CardHolderSummarySchema = z.object({
  institution: z.string().nullable(),
  /** display name for the holder; the institution, or the lone card's name when unassigned */
  bankName: z.string().nullable(),
  settings: CardIssuerSettingsSchema.nullable(),
  /** combined limit across the holder's cards (0 when unset) */
  creditLimitPaise: z.number().int().min(0),
  /** combined amount owed right now across the holder's cards */
  totalOwedPaise: z.number().int(),
  /** combined owed ÷ shared limit; null when no limit is set */
  utilizationPct: z.number().nullable(),
  utilizationAlertPct: z.number().int().min(1).max(100).nullable(),
  cards: z.array(CardSummarySchema),
});
export type CardHolderSummary = z.infer<typeof CardHolderSummarySchema>;

/** One line item in a card's activity view. */
export const CardActivityTxnSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  merchant: z.string(),
  /** signed like the ledger: a spend is negative, a payment/refund positive */
  amountPaise: z.number().int(),
  categoryId: z.uuid().nullable(),
  /** the statement cycle that cleared this txn (a statement line matched it), else null */
  reconciledStatementId: z.uuid().nullable(),
});
export type CardActivityTxn = z.infer<typeof CardActivityTxnSchema>;

/**
 * A card's CRED-style breakdown: what's due for the last closed statement, and
 * the spends since then that haven't been billed yet — each with its line items.
 */
export const CardActivitySchema = z.object({
  accountId: z.uuid(),
  name: z.string(),
  bankName: z.string().nullable(),
  last4: z.string().nullable(),
  statementStart: z.iso.date().nullable(),
  statementEnd: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  /** total amount due for the last closed statement (carried balance included) */
  totalDuePaise: z.number().int(),
  /** spends since the statement closed — not yet billed */
  unbilledSpendPaise: z.number().int(),
  /** current signed balance (negative = owed) */
  balancePaise: z.number().int(),
  /** transactions in the last closed statement period */
  billed: z.array(CardActivityTxnSchema),
  /** transactions since the statement closed */
  unbilled: z.array(CardActivityTxnSchema),
});
export type CardActivity = z.infer<typeof CardActivitySchema>;

/** An uploaded statement PDF/image for a card (metadata only; blob in storage). */
export const CardStatementSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  /** statement close/period date, or null when not tagged */
  period: z.iso.date().nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type CardStatement = z.infer<typeof CardStatementSchema>;

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

/**
 * A statement cycle the extractor reconciled: the totals it read and how many of
 * the cycle's lines were already in the ledger from real-time alerts. `deltaPaise`
 * is the listed spend not yet cleared (lineDebit − matched) — what a review should
 * look at. One row per (card, period).
 */
export const StatementReconciliationSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  /** the statement cycle, "YYYY-MM" */
  period: z.string(),
  statementDate: z.iso.date().nullable(),
  totalDuePaise: z.number().int().nullable(),
  minDuePaise: z.number().int().nullable(),
  rewardClosing: z.number().int().nullable(),
  lineCount: z.number().int(),
  lineDebitPaise: z.number().int(),
  matchedCount: z.number().int(),
  matchedPaise: z.number().int(),
  unmatchedCount: z.number().int(),
  /** listed spend not yet in the ledger: max(0, lineDebitPaise − matchedPaise) */
  deltaPaise: z.number().int(),
  updatedAt: z.string(),
});
export type StatementReconciliation = z.infer<typeof StatementReconciliationSchema>;

// ---------- EMIs ----------

/**
 * Account types an EMI's destination (the loan itself, modelled as an
 * account) may point at. Excludes `credit_card` even though it's in the
 * broader `LIABILITY_ACCOUNT_TYPES` predicate — a deliberate scope decision,
 * not an oversight (see tasks/emi-loan-destination-account, "round 2" notes).
 * Exported here, not duplicated, so the API and web import the same literal
 * array.
 */
export const EMI_DESTINATION_TYPES = ["loan", "home_loan_od", "overdraft"] as const;

export const UpsertEmiDetailsSchema = z.object({
  principalPaise: z.number().int().positive(),
  annualRateBps: z.number().int().min(0).max(10000),
  totalInstallments: z.number().int().min(1).max(600),
  startDate: z.iso.date(),
  loanAccountId: z.uuid().nullable().default(null),
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
  loanAccountId: z.uuid().nullable().default(null),
});
export type CreateEmi = z.input<typeof CreateEmiSchema>;

export const EmiSummarySchema = z.object({
  templateId: z.uuid(),
  accountId: z.uuid(),
  loanAccountId: z.uuid().nullable(),
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

export const EmiInstallmentSchema = z.object({
  transactionId: z.uuid(),
  date: z.iso.date(),
  amountPaise: z.number().int(),
  principalPaise: z.number().int(),
  interestPaise: z.number().int(),
  balancePaise: z.number().int(),
});
export type EmiInstallment = z.infer<typeof EmiInstallmentSchema>;

// ---------- Holdings & portfolio ----------

/** PPF/EPF are account types, not asset classes — see AccountTypeSchema. */
export const AssetClassSchema = z.enum([
  "stock",
  "mutual_fund",
  "etf",
  "gold",
  "silver",
  "fd",
  "nps",
  "real_estate",
  "other",
]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

/**
 * Classes held as a quantity that a per-unit price applies to — fund units,
 * shares, grams of metal. A buy/sell in one of these with no quantity carries
 * money but no position, so every valuation and NAV refresh would understate
 * the holding; `services/holdings.ts` rejects it. Property and an FD have no
 * such quantity (one flat is not "1 unit" of anything priced per unit), so
 * their events legitimately leave `units` null.
 */
export const UNITISED_ASSET_CLASSES = [
  "stock",
  "mutual_fund",
  "etf",
  "gold",
  "silver",
] as const satisfies readonly AssetClass[];

export function assetClassHasUnits(assetClass: AssetClass): boolean {
  return (UNITISED_ASSET_CLASSES as readonly AssetClass[]).includes(assetClass);
}

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

/**
 * Capital-gains tax treatment of a holding. Can't be inferred from asset class
 * (a mutual_fund may be equity, debt, or a §50AA specified fund), so it's an
 * explicit, user-editable field. See services/tax-lots.ts.
 */
export const GainsTaxClassSchema = z.enum([
  "equity",
  "unlisted_shares",
  "other",
  "specified_fund",
  "market_linked_debenture",
  "unlisted_bond",
  "exempt",
]);
export type GainsTaxClass = z.infer<typeof GainsTaxClassSchema>;

export const HoldingSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  assetClass: AssetClassSchema,
  notes: z.string(),
  targetPct: z.number().int().nullable(),
  amfiSchemeCode: z.number().int().nullable(),
  folioNumber: z.string().nullable(),
  /** NAV/unit on 31-Jan-2018 in paise; grandfathering for pre-2018 equity lots. */
  grandfatherNavPaise: z.number().int().nullable(),
  /** How this holding's capital gains are taxed. */
  gainsTaxClass: GainsTaxClassSchema,
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
  grandfatherNavPaise: z.number().int().min(0).nullable().default(null),
  /** Omit to let the service guess from asset class; user can correct later. */
  gainsTaxClass: GainsTaxClassSchema.optional(),
});
export type CreateHolding = z.input<typeof CreateHoldingSchema>;

export const UpdateHoldingSchema = z.object({
  name: z.string().min(1).optional(),
  assetClass: AssetClassSchema.optional(),
  notes: z.string().optional(),
  targetPct: z.number().int().min(0).max(100).nullable().optional(),
  amfiSchemeCode: AmfiSchemeCodeSchema.optional(),
  folioNumber: z.string().min(1).nullable().optional(),
  grandfatherNavPaise: z.number().int().min(0).nullable().optional(),
  gainsTaxClass: GainsTaxClassSchema.optional(),
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

/**
 * `units` is nullable here on purpose. Whether a buy/sell *must* carry units
 * depends on the holding's asset class (see `assetClassHasUnits`), which this
 * body doesn't carry — so that rule lives in `services/holdings.ts` `addEvent`,
 * where the holding has already been loaded. Validating it here would either
 * reject a property purchase or let a fund buy through with no position.
 */
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
  /** NAV per unit on this date, when it came from a NAV feed; null for a manual value. */
  nav: z.number().min(0).nullable().default(null),
});
export type SetValuation = z.input<typeof SetValuationSchema>;

export const HoldingPositionSchema = HoldingSchema.extend({
  /** Remaining cost basis of still-held units (average-cost), never negative. */
  investedPaise: z.number().int(),
  currentValuePaise: z.number().int(),
  /** value change from the prior valuation to the latest (the day's move); null with no prior valuation */
  dayChangePaise: z.number().int().nullable(),
  /** currentValue − remaining cost basis; pure of realized gain. */
  unrealizedPaise: z.number().int(),
  /** Gain/loss booked on sells (proceeds − average cost of units sold). */
  realizedPaise: z.number().int(),
  dividendsPaise: z.number().int(),
  lastValuationDate: z.iso.date().nullable(),
  events: z.array(HoldingEventSchema),
  /**
   * Money-weighted annualised return (XIRR), basis points. Null — deliberately
   * not 0 — when it isn't computable: units are still held with no current
   * valuation to value them at, or the cash-flow span is too short (<30 days)
   * to annualise meaningfully. A 0 would falsely claim "no return".
   */
  xirrBps: z.number().int().nullable(),
});
export type HoldingPosition = z.infer<typeof HoldingPositionSchema>;

export const PortfolioSchema = z.object({
  totalInvestedPaise: z.number().int(),
  totalValuePaise: z.number().int(),
  /** sum of positions' day change (only those with a prior valuation) */
  totalDayChangePaise: z.number().int(),
  totalDividendsPaise: z.number().int(),
  /**
   * Money-weighted annualised return across all active positions' concatenated
   * cash flows. Positions lacking a usable terminal value (units held with no
   * current valuation) are excluded from the aggregate series entirely — they
   * are not counted at cost, which would fabricate a fake ~0% contribution.
   */
  totalXirrBps: z.number().int().nullable(),
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

// ---------- Capital gains (FIFO tax lots) ----------

/**
 * `exempt` is a third state alongside the holding-period terms, not a duration:
 * the disposal is outside the capital-gains net entirely (an SGB redeemed at
 * maturity, a tax-free bond), so no short/long line was ever tested. It stays a
 * visible slice — a disposal that vanished from the statement would be a worse
 * reporting bug than one showing zero tax.
 */
export const GainTermSchema = z.enum(["short", "long", "exempt"]);
export type GainTerm = z.infer<typeof GainTermSchema>;

/** One FIFO buy↔sell match: the atomic row of a capital-gains statement. */
export const CapitalGainsSliceSchema = z.object({
  holdingId: z.uuid(),
  holdingName: z.string(),
  assetClass: AssetClassSchema,
  buyDate: z.iso.date(),
  sellDate: z.iso.date(),
  units: z.number(),
  proceedsPaise: z.number().int(),
  /** Effective (grandfathered) acquisition cost. */
  costPaise: z.number().int(),
  gainPaise: z.number().int(),
  term: GainTermSchema,
  heldDays: z.number().int(),
  grandfathered: z.boolean(),
});
export type CapitalGainsSlice = z.infer<typeof CapitalGainsSliceSchema>;

/** Per-holding rollup within the selected financial year. */
export const CapitalGainsHoldingSchema = z.object({
  holdingId: z.uuid(),
  holdingName: z.string(),
  assetClass: AssetClassSchema,
  shortTermGainPaise: z.number().int(),
  longTermGainPaise: z.number().int(),
  /** Realized on exempt disposals; reported, never added to a taxable total. */
  exemptGainPaise: z.number().int(),
  proceedsPaise: z.number().int(),
  costPaise: z.number().int(),
  slices: z.array(CapitalGainsSliceSchema),
});
export type CapitalGainsHolding = z.infer<typeof CapitalGainsHoldingSchema>;

export const CapitalGainsStatementSchema = z.object({
  /** Indian financial year, e.g. "2025-26" (Apr 1 2025 – Mar 31 2026). */
  fy: z.string(),
  /** FYs that have at least one realized slice, newest first. */
  availableFys: z.array(z.string()),
  shortTermGainPaise: z.number().int(),
  longTermGainPaise: z.number().int(),
  /** Realized on exempt disposals; excluded from `totalGainPaise` by design. */
  exemptGainPaise: z.number().int(),
  /** Taxable total: short + long only. Exempt gains are never folded in here. */
  totalGainPaise: z.number().int(),
  totalProceedsPaise: z.number().int(),
  totalCostPaise: z.number().int(),
  holdings: z.array(CapitalGainsHoldingSchema),
});
export type CapitalGainsStatement = z.infer<typeof CapitalGainsStatementSchema>;

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

/**
 * Body for `POST /api/net-worth/backfill`.
 *
 * `from` is optional and selects a different operation: absent means "estimate
 * month-end history that does not exist yet", present means "recompute the days
 * that do exist, from this date forward". Optional so callers that only send
 * `{ months }` keep working.
 */
export const NetWorthBackfillRequestSchema = z.object({
  months: z.number().int().min(1).max(60).default(12),
  from: z.iso.date().optional(),
});
export type NetWorthBackfillRequest = z.infer<typeof NetWorthBackfillRequestSchema>;

/**
 * What a repair actually managed to do.
 *
 * Reported rather than logged-and-dropped: days are recomputed with per-day
 * failure isolation, so a repair can partly fail and still return 200. Without
 * these counts the caller cannot tell "42 days repaired" from "42 days attempted,
 * every one of them failed". `clamped` says the requested range was wider than
 * the server will do in one request, so the caller knows it got less than it
 * asked for.
 */
export const SnapshotRepairSchema = z.object({
  /** the effective earliest day repaired, after clamping */
  from: z.iso.date(),
  /** true when `from` was older than the server's maximum window and moved forward */
  clamped: z.boolean(),
  /** days the repair attempted */
  processed: z.number().int(),
  /** days it successfully rewrote */
  refreshed: z.number().int(),
  /** days it could not compute; these keep their stale values */
  failed: z.number().int(),
});
export type SnapshotRepair = z.infer<typeof SnapshotRepairSchema>;

/**
 * The backfill/repair response: the refreshed report, plus what the repair did.
 *
 * `repair` is null when no `from` was given (the estimate-missing-history path),
 * so the field's presence mirrors the request.
 */
export const NetWorthBackfillResultSchema = NetWorthReportSchema.extend({
  repair: SnapshotRepairSchema.nullable(),
});
export type NetWorthBackfillResult = z.infer<typeof NetWorthBackfillResultSchema>;

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
