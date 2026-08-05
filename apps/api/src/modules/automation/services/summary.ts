import type { Redis } from "ioredis";
import type { AiProvider } from "@compass/ai";
import { formatINR, type AiSummary } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { buildReport } from "../../planning/services/reports.ts";
import { getInsights } from "../../planning/services/insights.ts";

const TTL_SECONDS = 60 * 60 * 24 * 7; // narratives are stable for a closed month
const cacheKey = (userId: string, period: string) => `ai:summary:${userId}:${period}`;

/**
 * Month-in-review narrative (task 7.6). All figures come from the deterministic
 * insight/report computations (task 6.1/6.4); the model only narrates them —
 * it never sees raw rows or does arithmetic. Cached in Redis per user+period.
 */
export async function getMonthlySummary(
  db: Db,
  redis: Redis,
  ai: AiProvider,
  userId: string,
  period: string,
  refresh = false,
): Promise<AiSummary> {
  const key = cacheKey(userId, period);
  if (!refresh) {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as AiSummary;
  }

  const [report, insights] = await Promise.all([
    buildReport(db, userId, { period: "monthly", key: period }),
    getInsights(db, userId, period),
  ]);

  const topCat = report.categories[0];
  const topMerchant = report.topMerchants[0];
  const facts: Record<string, string | number> = {
    income: formatINR(report.incomePaise),
    expenses: formatINR(report.expensePaise),
    net: formatINR(report.netPaise),
    savingsRatePct: report.savingsRatePct,
    topCategory: topCat ? `${topCat.name} (${formatINR(topCat.spentPaise)})` : "none",
    topMerchant: topMerchant ? `${topMerchant.merchant} (${formatINR(topMerchant.spentPaise)})` : "none",
    healthScore: insights.health.score,
    healthGrade: insights.health.grade,
  };

  const narrative = await ai.generateSummary({ period, facts });
  const summary: AiSummary = { period, narrative, facts, generatedAt: new Date().toISOString() };
  await redis.set(key, JSON.stringify(summary), "EX", TTL_SECONDS);
  return summary;
}
