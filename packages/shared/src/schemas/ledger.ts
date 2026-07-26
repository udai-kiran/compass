import { z } from "zod";

// ---------- Accounts ----------

export const AccountTypeSchema = z.enum([
  "bank",
  "cash",
  "credit_card",
  "investment",
  "loan",
  "overdraft",
  "ppf",
  "epf",
  "ssy",
  "nps",
  "home_loan_od",
  // DEPRECATED account type. Insurance is now a standalone entity (see
  // schemas/insurance.ts), not an account. Kept only because the Postgres enum
  // can't drop a value; no account uses it and the UI never offers it.
  "insurance",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

/**
 * Fixed-rate, credited-balance small-savings schemes: they share one detail
 * shape (rate, maturity, account/reference number). Named "retirement" for
 * historical reasons — SSY is a child's scheme, not retirement — but the
 * structure is identical, so it reuses the same table and form.
 */
export const RETIREMENT_ACCOUNT_TYPES = ["ppf", "epf", "ssy"] as const satisfies readonly AccountType[];

export function isRetirementAccount(type: AccountType): boolean {
  return (RETIREMENT_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/** Account types that carry overdraft details (sanctioned limit, rate). */
export const OVERDRAFT_ACCOUNT_TYPES = ["overdraft", "home_loan_od"] as const satisfies readonly AccountType[];

export function isOverdraftAccount(type: AccountType): boolean {
  return (OVERDRAFT_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/**
 * Drawing power on an overdraft loan: what you can withdraw back out. It's the
 * limit minus what you currently owe. `owedPaise` is the positive amount owed
 * (i.e. −balance for a liability). Clamped at 0 — you can't draw past the limit.
 */
export function availableToDrawPaise(sanctionedLimitPaise: number, owedPaise: number): number {
  return Math.max(0, sanctionedLimitPaise - owedPaise);
}

/** Account types that carry bank details (a/c number, IFSC, branch, subtype). */
export const BANK_ACCOUNT_TYPES = ["bank"] as const satisfies readonly AccountType[];

export function isBankAccount(type: AccountType): boolean {
  return (BANK_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/**
 * Account types you earmark toward a goal: long-horizon assets you accumulate
 * (investments and the credited-balance schemes). Transactional accounts
 * (bank/cash) and liabilities (cards/loans/overdrafts) are excluded — a savings
 * account or a credit card isn't a pot you're growing toward a target.
 */
export const GOAL_ELIGIBLE_ACCOUNT_TYPES = [
  "investment",
  "ppf",
  "epf",
  "ssy",
  "nps",
] as const satisfies readonly AccountType[];

export function accountCanHaveGoal(type: AccountType): boolean {
  return (GOAL_ELIGIBLE_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/** Account types whose balance is money owed — a liability, not an asset. */
export const LIABILITY_ACCOUNT_TYPES = [
  "credit_card",
  "loan",
  "overdraft",
  "home_loan_od",
] as const satisfies readonly AccountType[];

export function isLiabilityAccount(type: AccountType): boolean {
  return (LIABILITY_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/** Last 4 digits, for display in lists. Derived from the full number when there is one. */
export const Last4Schema = z
  .string()
  .regex(/^\d{4}$/, "must be exactly 4 digits")
  .nullable();

/** Indian account numbers are digits only; length varies by bank (9–18). */
export const AccountNumberSchema = z
  .string()
  .regex(/^\d{9,18}$/, "must be 9 to 18 digits");

/**
 * IFSC: 4 letters (bank), a literal 0 (reserved), then 6 alphanumeric (branch).
 * Uppercased before checking — nobody types these in caps.
 */
export const IfscSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "must look like HDFC0001234"));

/**
 * UPI VPA: handle@psp. Deliberately loose on the handle — banks allow dots,
 * hyphens and underscores, and a bare mobile number is also valid.
 */
export const UpiIdSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.]{1,63}$/, "must look like name@okhdfcbank"),
  );

export const BankAccountSubtypeSchema = z.enum(["savings", "current", "salary", "nre", "nro"]);
export type BankAccountSubtype = z.infer<typeof BankAccountSubtypeSchema>;

export const BankDetailsSchema = z.object({
  accountId: z.uuid(),
  accountNumber: z.string(),
  ifsc: z.string(),
  branch: z.string(),
  subtype: BankAccountSubtypeSchema.nullable(),
  /** Required Average Monthly Balance for this account, in integer paise. 0 = no requirement set. */
  requiredAmbPaise: z.number().int(),
  /** last 4 of the linked debit card; "" when none recorded */
  debitCardLast4: z.string(),
});
export type BankDetails = z.infer<typeof BankDetailsSchema>;

/**
 * Upper bound for a required AMB, in paise (₹1,00,00,000 — one crore, far above
 * any real bank's minimum balance). It exists so `requiredPaise * days` in the
 * AMB comparison stays well inside JavaScript's exact-integer range: a typo or a
 * pasted long number must fail validation rather than silently produce a wrong
 * "ok"/"short" verdict.
 */
export const MAX_REQUIRED_AMB_PAISE = 1_000_000_000;

/** Empty string clears a field — the forms send "" for "I don't want this recorded". */
export const UpsertBankDetailsSchema = z.object({
  accountNumber: z.union([AccountNumberSchema, z.literal("")]).default(""),
  ifsc: z.union([IfscSchema, z.literal("")]).default(""),
  branch: z.string().max(120).default(""),
  subtype: BankAccountSubtypeSchema.nullable().default(null),
  /** Required AMB in paise; 0 clears it. Omitted entirely = leave unchanged. */
  requiredAmbPaise: z.number().int().min(0).max(MAX_REQUIRED_AMB_PAISE).optional(),
  debitCardLast4: z
    .union([z.string().regex(/^\d{4}$/, "must be exactly 4 digits"), z.literal("")])
    .default(""),
});
/** z.input, not z.infer: IFSC is uppercased on the way through, and fields default. */
export type UpsertBankDetails = z.input<typeof UpsertBankDetailsSchema>;

export const OverdraftDetailsSchema = z.object({
  accountId: z.uuid(),
  sanctionedLimitPaise: z.number().int(),
  annualRateBps: z.number().int(),
});
export type OverdraftDetails = z.infer<typeof OverdraftDetailsSchema>;

export const UpsertOverdraftDetailsSchema = z.object({
  sanctionedLimitPaise: z.number().int().min(0).default(0),
  // 0–20% in basis points; a home-loan rate above 20% is a typo, not a rate.
  annualRateBps: z.number().int().min(0).max(2000).default(0),
});
export type UpsertOverdraftDetails = z.input<typeof UpsertOverdraftDetailsSchema>;

/** Primary handle first — that's the one shown when there isn't room for all of them. */
export const UpiIdsSchema = z
  .array(UpiIdSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "duplicate UPI ID");

export const AccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: AccountTypeSchema,
  institution: z.string().nullable(),
  accountLast4: z.string().nullable(),
  holderName: z.string().nullable(),
  upiIds: z.array(z.string()),
  currency: z.string(),
  openingBalancePaise: z.number().int(),
  /** Goal this account is earmarked for; null = Unassigned. */
  goalId: z.uuid().nullable(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AccountWithBalanceSchema = AccountSchema.extend({
  balancePaise: z.number().int(),
  /** Bank subtype (savings/current/…) when the account carries bank details; else null. */
  subtype: BankAccountSubtypeSchema.nullable().default(null),
});
export type AccountWithBalance = z.infer<typeof AccountWithBalanceSchema>;

/** How an account's month-to-date Average Monthly Balance compares with its requirement. */
export const AmbStatusSchema = z.enum(["none", "ok", "short"]);
export type AmbStatus = z.infer<typeof AmbStatusSchema>;

export const AccountAverageBalanceSchema = z.object({
  accountId: z.uuid(),
  /** first day averaged, inclusive — YYYY-MM-DD */
  from: z.string(),
  /** last day averaged, inclusive — YYYY-MM-DD */
  to: z.string(),
  /** the divisor: how many days were averaged (`to` - `from` + 1) */
  days: z.number().int(),
  /** days in the whole calendar month, so the UI can tell a partial window */
  daysInMonth: z.number().int(),
  /** sum of daily closing balances / days, in integer paise */
  averagePaise: z.number().int(),
  /** the account's requirement, integer paise; 0 = none set */
  requiredPaise: z.number().int(),
  status: AmbStatusSchema,
  /** how far below the requirement, integer paise; 0 unless status is "short" */
  shortfallPaise: z.number().int(),
  /**
   * True when the ledger's first entry falls after the 1st, so the days
   * earlier in the month have no known balance and were not averaged. The
   * result can therefore be OVERSTATED relative to the bank's own figure — if
   * the real balance was lower in those unseen days, a genuine breach can be
   * hidden.
   */
  partialHistory: z.boolean(),
});
export type AccountAverageBalance = z.infer<typeof AccountAverageBalanceSchema>;

export const CreateAccountSchema = z.object({
  name: z.string().min(1),
  type: AccountTypeSchema,
  institution: z.string().min(1).nullable().default(null),
  accountLast4: Last4Schema.default(null),
  holderName: z.string().min(1).max(120).nullable().default(null),
  currency: z.string().min(3).max(3).default("INR"),
  openingBalancePaise: z.number().int().default(0),
});
export type CreateAccount = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  type: AccountTypeSchema.optional(),
  institution: z.string().min(1).nullable().optional(),
  accountLast4: Last4Schema.optional(),
  holderName: z.string().min(1).max(120).nullable().optional(),
  upiIds: UpiIdsSchema.optional(),
  goalId: z.uuid().nullable().optional(),
  openingBalancePaise: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});
export type UpdateAccount = z.infer<typeof UpdateAccountSchema>;
export type UpdateAccountInput = z.input<typeof UpdateAccountSchema>;

// ---------- Categories ----------

export const CategoryKindSchema = z.enum(["income", "expense"]);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: CategoryKindSchema,
  parentId: z.uuid().nullable(),
  icon: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Category = z.infer<typeof CategorySchema>;

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}
export const CategoryTreeNodeSchema: z.ZodType<CategoryTreeNode> = CategorySchema.extend({
  get children() {
    return z.array(CategoryTreeNodeSchema);
  },
});

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  kind: CategoryKindSchema,
  parentId: z.uuid().nullable().default(null),
  icon: z.string().default(""),
  color: z.string().default(""),
});
export type CreateCategory = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.uuid().nullable().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});
export type UpdateCategory = z.infer<typeof UpdateCategorySchema>;

export const MergeCategorySchema = z.object({
  intoCategoryId: z.uuid(),
});

// ---------- Transactions ----------

export const TransactionSourceSchema = z.enum(["manual", "import", "recurring"]);

export const SplitSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  amountPaise: z.number().int(),
  note: z.string(),
});
export type Split = z.infer<typeof SplitSchema>;

export const TransactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.iso.date(),
  amountPaise: z.number().int(),
  merchant: z.string(),
  categoryId: z.uuid().nullable(),
  notes: z.string(),
  tags: z.array(z.string()),
  source: TransactionSourceSchema,
  transferLinkId: z.uuid().nullable(),
  /**
   * When this is one leg of a transfer, the account the other leg sits in — lets
   * the UI tell a plain account-to-account move from a credit-card payment (and
   * name the counterpart). Null when the transaction isn't a transfer leg.
   */
  transferCounterpartAccountId: z.uuid().nullable(),
  /** insurance policy this expense is a premium for; null for ordinary transactions */
  policyId: z.uuid().nullable(),
  /** vehicle or utility connection this expense belongs to */
  resourceId: z.uuid().nullable(),
  /** recurring bill/subscription that generated or was linked to this transaction */
  recurringTemplateId: z.uuid().nullable(),
  splits: z.array(SplitSchema),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const CreateTransactionSchema = z.object({
  accountId: z.uuid(),
  date: z.iso.date(),
  amountPaise: z
    .number()
    .int()
    .refine((n) => n !== 0, "Amount cannot be zero"),
  merchant: z.string().default(""),
  categoryId: z.uuid().nullable().default(null),
  notes: z.string().default(""),
  tags: z.array(z.string()).default([]),
  resourceId: z.uuid().nullable().default(null),
  recurringTemplateId: z.uuid().nullable().default(null),
});
export type CreateTransaction = z.input<typeof CreateTransactionSchema>;

export const UpdateTransactionSchema = z.object({
  accountId: z.uuid().optional(),
  date: z.iso.date().optional(),
  amountPaise: z
    .number()
    .int()
    .refine((n) => n !== 0, "Amount cannot be zero")
    .optional(),
  merchant: z.string().optional(),
  categoryId: z.uuid().nullable().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  resourceId: z.uuid().nullable().optional(),
  recurringTemplateId: z.uuid().nullable().optional(),
});
export type UpdateTransaction = z.infer<typeof UpdateTransactionSchema>;

export const TransactionFilterSchema = z.object({
  q: z.string().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  minAmountPaise: z.coerce.number().int().optional(),
  maxAmountPaise: z.coerce.number().int().optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  tag: z.string().optional(),
});
export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;

export const ListTransactionsQuerySchema = TransactionFilterSchema.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const TransactionPageSchema = z.object({
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int(),
  totalAmountPaise: z.number().int(),
  /** Sum of inflows (credits), as a positive magnitude. -1 on cursor pages (unchanged). */
  totalInflowPaise: z.number().int(),
  /** Sum of outflows (debits), as a positive magnitude. -1 on cursor pages (unchanged). */
  totalOutflowPaise: z.number().int(),
});
export type TransactionPage = z.infer<typeof TransactionPageSchema>;

export const SetSplitsSchema = z.object({
  splits: z
    .array(
      z.object({
        categoryId: z.uuid(),
        amountPaise: z.number().int(),
        note: z.string().default(""),
      }),
    )
    .max(50),
});

export const BulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setCategory"),
    categoryId: z.uuid().nullable(),
    ids: z.array(z.uuid()).optional(),
    filter: TransactionFilterSchema.optional(),
  }),
  z.object({
    action: z.literal("addTag"),
    tag: z.string().min(1),
    ids: z.array(z.uuid()).optional(),
    filter: TransactionFilterSchema.optional(),
  }),
  z.object({
    action: z.literal("removeTag"),
    tag: z.string().min(1),
    ids: z.array(z.uuid()).optional(),
    filter: TransactionFilterSchema.optional(),
  }),
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.uuid()).optional(),
    filter: TransactionFilterSchema.optional(),
  }),
  z.object({
    action: z.literal("restore"),
    snapshot: z.array(
      z.object({
        id: z.uuid(),
        categoryId: z.uuid().nullable(),
        tags: z.array(z.string()),
        deleted: z.boolean(),
      }),
    ),
  }),
]);
export type BulkAction = z.infer<typeof BulkActionSchema>;

export const BulkResultSchema = z.object({
  affected: z.number().int(),
  snapshot: z.array(
    z.object({
      id: z.uuid(),
      categoryId: z.uuid().nullable(),
      tags: z.array(z.string()),
      deleted: z.boolean(),
    }),
  ),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;

// ---------- Transfers ----------

export const TransferSuggestionSchema = z.object({
  outTransactionId: z.uuid(),
  inTransactionId: z.uuid(),
  amountPaise: z.number().int(),
  daysApart: z.number().int(),
});
export type TransferSuggestion = z.infer<typeof TransferSuggestionSchema>;

export const CreateTransferLinkSchema = z.object({
  outTransactionId: z.uuid(),
  inTransactionId: z.uuid(),
});

export const TransferLinkSchema = z.object({
  id: z.uuid(),
  outTransactionId: z.uuid(),
  inTransactionId: z.uuid(),
  auto: z.boolean(),
});

// ---------- Payslips ----------
//
// A payslip records gross salary and the deductions withheld at source (the
// Indian norm): the employer credits only the *net* to your bank, but the gross
// is your income, TDS/professional-tax are real tax expenses, and EPF is your
// money moving into a retirement asset. Rather than logging one net "Salary"
// credit (which hides all of that), a payslip fans out into linked entries —
// gross as bank income, each tax as a bank expense, and EPF as a transfer into
// the chosen retirement account — so income, tax paid, and EPF growth are all
// captured. The bank balance still nets to take-home.

export const PayslipDeductionKindSchema = z.enum([
  "tds", // income tax deducted at source → expense
  "professional_tax", // state professional tax → expense
  "epf", // employee provident fund → transfer into a retirement account (asset)
  "other", // any other withholding (e.g. group insurance) → expense
]);
export type PayslipDeductionKind = z.infer<typeof PayslipDeductionKindSchema>;

export const PayslipDeductionSchema = z.object({
  kind: PayslipDeductionKindSchema,
  /** Free-text label, shown for "other" deductions. */
  label: z.string().default(""),
  amountPaise: z.number().int().positive(),
  /** Destination retirement account — required when kind === "epf". */
  toAccountId: z.uuid().nullable().default(null),
});
export type PayslipDeduction = z.infer<typeof PayslipDeductionSchema>;

export const CreatePayslipSchema = z
  .object({
    bankAccountId: z.uuid(),
    date: z.iso.date(),
    employer: z.string().default(""),
    grossPaise: z.number().int().positive(),
    /** Income category for the gross credit; defaults to the user's Salary category. */
    categoryId: z.uuid().nullable().default(null),
    deductions: z.array(PayslipDeductionSchema).max(20).default([]),
    notes: z.string().default(""),
  })
  .refine(
    (p) => p.deductions.reduce((s, d) => s + d.amountPaise, 0) < p.grossPaise,
    { message: "Deductions must be less than gross (take-home must be positive)", path: ["deductions"] },
  )
  .refine((p) => p.deductions.every((d) => d.kind !== "epf" || d.toAccountId !== null), {
    message: "EPF deduction needs a destination account",
    path: ["deductions"],
  });
export type CreatePayslip = z.infer<typeof CreatePayslipSchema>;
export type CreatePayslipInput = z.input<typeof CreatePayslipSchema>;

export const PayslipResultSchema = z.object({
  grossPaise: z.number().int(),
  netPaise: z.number().int(),
  taxPaise: z.number().int(),
  epfPaise: z.number().int(),
  otherPaise: z.number().int(),
  transactionIds: z.array(z.uuid()),
});
export type PayslipResult = z.infer<typeof PayslipResultSchema>;

// ---------- Attachments ----------

export const AttachmentSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;
