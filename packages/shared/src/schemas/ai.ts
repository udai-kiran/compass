import { z } from "zod";

/** One AI category suggestion, enriched with display fields for the UI. */
export const AiCategorySuggestionSchema = z.object({
  transactionId: z.uuid(),
  merchant: z.string(),
  amountPaise: z.number().int(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type AiCategorySuggestion = z.infer<typeof AiCategorySuggestionSchema>;

export const AiCategorizeRequestSchema = z.object({
  /** Restrict to these transactions; omit/empty = all uncategorized (capped). */
  transactionIds: z.array(z.uuid()).max(200).optional(),
});
export const AiCategorizeResponseSchema = z.object({
  suggestions: z.array(AiCategorySuggestionSchema),
});
export type AiCategorizeResponse = z.infer<typeof AiCategorizeResponseSchema>;

// ---------- Smart Fill (history-based, no AI) ----------

/**
 * One merchant-level suggestion produced by the history-based Smart Fill.
 * Groups all uncategorized transactions for a merchant under one suggestion so
 * the review panel scales to M unique merchants, not N individual transactions.
 */
export const MerchantSuggestionSchema = z.object({
  merchant: z.string(),
  /** All uncategorized transaction IDs for this merchant — apply as a bulk set. */
  txnIds: z.array(z.uuid()),
  txnCount: z.number().int().positive(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  /** Fraction of past categorized transactions for this merchant with this category. */
  confidence: z.number().min(0).max(1),
  /** How many past categorized transactions informed this suggestion. */
  historyCount: z.number().int().nonnegative(),
});
export type MerchantSuggestion = z.infer<typeof MerchantSuggestionSchema>;

export const SmartFillResponseSchema = z.object({
  suggestions: z.array(MerchantSuggestionSchema),
  /** Merchants with uncategorized transactions but no history to draw from. */
  uncoveredCount: z.number().int().nonnegative(),
});
export type SmartFillResponse = z.infer<typeof SmartFillResponseSchema>;

/** AI-narrated month-in-review. Numbers live in `facts` (computed, not model). */
export const AiSummarySchema = z.object({
  period: z.string(),
  narrative: z.string(),
  facts: z.record(z.string(), z.union([z.string(), z.number()])),
  generatedAt: z.string(),
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

export const AiSummaryRequestSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  /** force a regenerate even if a cached narrative exists */
  refresh: z.boolean().optional(),
});

/** Assistant chat request — full turn history from the client. */
export const AiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;

export const AiChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema).min(1).max(20),
});

export const SUGGESTED_PROMPTS = [
  "Why was last month expensive?",
  "How much did I spend on dining this month?",
  "What are my top merchants?",
  "How am I tracking against my budget?",
] as const;

// ---------- Per-user AI provider settings ----------

export const AiProviderSchema = z.enum([
  "none",
  "anthropic",
  "ollama",
  "openrouter",
  "deepseek",
  "custom",
]);
export type AiProviderName = z.infer<typeof AiProviderSchema>;

/** Providers that need a base URL. */
const URL_PROVIDERS = ["ollama", "custom"] as const;

/** Read model: what the settings page shows. The API key itself is never returned. */
export const AiSettingsSchema = z.object({
  provider: AiProviderSchema,
  baseUrl: z.string(),
  model: z.string(),
  /** whether a key is stored, so the UI can show "•••• on file" without the value */
  hasApiKey: z.boolean(),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/**
 * Write model. `apiKey` is optional so the client need not resend a stored key:
 * omit = leave unchanged, "" = clear, a value = replace. Per-provider required
 * fields are enforced here so a half-filled config can't be saved.
 */
export const UpdateAiSettingsSchema = z
  .object({
    provider: AiProviderSchema,
    baseUrl: z.string().default(""),
    model: z.string().default(""),
    apiKey: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if ((URL_PROVIDERS as readonly string[]).includes(v.provider)) {
      try {
        const url = new URL(v.baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
        if (url.username || url.password || url.search || url.hash) throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message: "Enter a valid HTTP(S) base URL without credentials, query, or fragment",
        });
      }
    }
    if (v.provider === "custom" && v.model.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["model"],
        message: "A model name is required for a custom endpoint",
      });
    }
  });
export type UpdateAiSettings = z.input<typeof UpdateAiSettingsSchema>;
