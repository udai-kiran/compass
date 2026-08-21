import { z } from "zod";

/** The kinds of model call the event log records. */
export const AiEventKindSchema = z.enum([
  "email_extract",
  "statement_parse",
  "statement_summary",
  "categorize",
  "summary",
  "assistant",
  "goal_roadmap",
  "shopping_parse",
]);
export type AiEventKind = z.infer<typeof AiEventKindSchema>;

export const AiEventStatusSchema = z.enum(["ok", "error"]);
export type AiEventStatus = z.infer<typeof AiEventStatusSchema>;

/** A row in the event-log list. */
export const AiEventSummarySchema = z.object({
  id: z.uuid(),
  kind: AiEventKindSchema,
  status: AiEventStatusSchema,
  provider: z.string(),
  model: z.string(),
  title: z.string(),
  ingestionId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});
export type AiEventSummary = z.infer<typeof AiEventSummarySchema>;

/** The full record — the exact context sent to the model and the raw response. */
export const AiEventDetailSchema = AiEventSummarySchema.extend({
  requestContext: z.string(),
  responseRaw: z.string(),
  error: z.string().nullable(),
});
export type AiEventDetail = z.infer<typeof AiEventDetailSchema>;

export const AiEventPageSchema = z.object({
  items: z.array(AiEventSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AiEventPage = z.infer<typeof AiEventPageSchema>;

export const ListAiEventsQuerySchema = z.object({
  kind: AiEventKindSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
