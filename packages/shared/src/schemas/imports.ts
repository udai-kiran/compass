import { z } from "zod";

// ---------- Import mapping ----------

export const DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD-MM-YYYY",
  "DD MMM YYYY",
] as const;
export const DateFormatSchema = z.enum(DATE_FORMATS);
export type DateFormat = z.infer<typeof DateFormatSchema>;

export const ImportMappingSchema = z.object({
  dateColumn: z.string().min(1),
  dateFormat: DateFormatSchema,
  // single signed column, or separate debit/credit columns
  amountMode: z.enum(["signed", "debit_credit"]),
  amountColumn: z.string().optional(),
  debitColumn: z.string().optional(),
  creditColumn: z.string().optional(),
  /** signed mode: set when positive numbers mean money out */
  invertSign: z.boolean().default(false),
  merchantColumn: z.string().min(1),
  notesColumn: z.string().optional(),
});
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

export const ImportStatusSchema = z.enum(["staged", "committed", "rolled_back"]);

export const ImportBatchSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  fileName: z.string(),
  status: ImportStatusSchema,
  headers: z.array(z.string()),
  rowCount: z.number().int(),
  errorCount: z.number().int(),
  mapping: ImportMappingSchema.nullable(),
  createdAt: z.string(),
  committedAt: z.string().nullable(),
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const ImportRowSchema = z.object({
  id: z.uuid(),
  rowIndex: z.number().int(),
  raw: z.record(z.string(), z.string()),
  date: z.iso.date().nullable(),
  amountPaise: z.number().int().nullable(),
  merchant: z.string(),
  rawMerchant: z.string(),
  notes: z.string(),
  categoryId: z.uuid().nullable(),
  duplicate: z.boolean(),
  include: z.boolean(),
  error: z.string().nullable(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const ImportRowsPageSchema = z.object({
  items: z.array(ImportRowSchema),
  totalCount: z.number().int(),
});

export const UpdateImportRowSchema = z.object({
  include: z.boolean().optional(),
  categoryId: z.uuid().nullable().optional(),
  duplicate: z.boolean().optional(),
});

export const CommitResultSchema = z.object({
  created: z.number().int(),
  skippedDuplicates: z.number().int(),
  skippedExcluded: z.number().int(),
  skippedErrors: z.number().int(),
  /** net signed sum of imported rows — reconcile against the statement total */
  netPaise: z.number().int(),
  /** card payments (and other exact cross-account matches) auto-linked as transfers */
  linkedTransfers: z.number().int(),
});
export type CommitResult = z.infer<typeof CommitResultSchema>;

export const BankPresetSchema = z.object({
  name: z.string(),
  mapping: ImportMappingSchema,
});
export type BankPreset = z.infer<typeof BankPresetSchema>;

// ---------- Merchant normalization ----------

export const MerchantRuleSchema = z.object({
  id: z.uuid(),
  match: z.string(),
  replacement: z.string(),
});

export const RenameMerchantSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  applyToAll: z.boolean().default(false),
  createRule: z.boolean().default(true),
});
export type RenameMerchant = z.input<typeof RenameMerchantSchema>;
