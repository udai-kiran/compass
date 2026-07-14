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
