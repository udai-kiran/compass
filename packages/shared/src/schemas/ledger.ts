import { z } from "zod";

// ---------- Accounts ----------

export const AccountTypeSchema = z.enum([
  "bank",
  "cash",
  "credit_card",
  "investment",
  "loan",
  "ppf",
  "epf",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

/** Account types that carry retirement details (rate, maturity, UAN/PPF number). */
export const RETIREMENT_ACCOUNT_TYPES = ["ppf", "epf"] as const satisfies readonly AccountType[];

export function isRetirementAccount(type: AccountType): boolean {
  return (RETIREMENT_ACCOUNT_TYPES as readonly AccountType[]).includes(type);
}

/** Last 4 digits of the account/card number — never the full number. */
export const Last4Schema = z
  .string()
  .regex(/^\d{4}$/, "must be exactly 4 digits")
  .nullable();

export const AccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: AccountTypeSchema,
  institution: z.string().nullable(),
  accountLast4: z.string().nullable(),
  currency: z.string(),
  openingBalancePaise: z.number().int(),
  sortOrder: z.number().int(),
  archivedAt: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const AccountWithBalanceSchema = AccountSchema.extend({
  balancePaise: z.number().int(),
});
export type AccountWithBalance = z.infer<typeof AccountWithBalanceSchema>;

export const CreateAccountSchema = z.object({
  name: z.string().min(1),
  type: AccountTypeSchema,
  institution: z.string().min(1).nullable().default(null),
  accountLast4: Last4Schema.default(null),
  currency: z.string().min(3).max(3).default("INR"),
  openingBalancePaise: z.number().int().default(0),
});
export type CreateAccount = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  type: AccountTypeSchema.optional(),
  institution: z.string().min(1).nullable().optional(),
  accountLast4: Last4Schema.optional(),
  openingBalancePaise: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});
export type UpdateAccount = z.infer<typeof UpdateAccountSchema>;

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
});
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;

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

// ---------- Attachments ----------

export const AttachmentSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;
