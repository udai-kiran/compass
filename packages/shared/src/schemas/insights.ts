import { z } from "zod";

export const InsightSentimentSchema = z.enum(["positive", "neutral", "warning"]);
export type InsightSentiment = z.infer<typeof InsightSentimentSchema>;

export const InsightCardSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  sentiment: InsightSentimentSchema,
  valuePaise: z.number().int().nullable(),
  deltaPct: z.number().nullable(),
  /** small trailing series for sparkline context */
  spark: z.array(z.number()),
  /** drill-down link to the underlying transactions, if any */
  link: z.string().nullable(),
});
export type InsightCard = z.infer<typeof InsightCardSchema>;

export const HealthComponentSchema = z.object({
  label: z.string(),
  score: z.number(),
  weightPct: z.number(),
  detail: z.string(),
});
export type HealthComponent = z.infer<typeof HealthComponentSchema>;

export const HealthScoreSchema = z.object({
  score: z.number(),
  grade: z.enum(["A", "B", "C", "D", "E"]),
  components: z.array(HealthComponentSchema),
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

export const InsightsSchema = z.object({
  periodKey: z.string(),
  health: HealthScoreSchema,
  cards: z.array(InsightCardSchema),
});
export type Insights = z.infer<typeof InsightsSchema>;
