import { eq } from "drizzle-orm";
import type { AnomalySensitivity } from "@compass/shared";
import { formatINR } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { alertLedger, categories } from "../db/schema.ts";
import { createNotification } from "../modules/system/services/notifications.ts";
import { listPrefs } from "../modules/system/services/prefs.ts";
import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "./periods.ts";

/** Sensitivity → z-score threshold; null disables detection. Lower fires more readily. */
export function sensitivityThreshold(s: AnomalySensitivity): number | null {
  switch (s) {
    case "off":
      return null;
    case "low":
      return 2.5;
    case "normal":
      return 2.0;
    case "high":
      return 1.5;
  }
}

/**
 * Flag the current value as an anomaly when it exceeds the trailing mean by more
 * than `threshold` standard deviations (z-score). Only over-spending is flagged;
 * needs at least 3 months of history. `ratio` = current / mean, for the
 * "N× your usual" explanation.
 */
export function detectAnomaly(
  currentPaise: number,
  historyPaise: number[],
  sensitivity: AnomalySensitivity,
): { anomaly: boolean; ratio: number; meanPaise: number } {
  const threshold = sensitivityThreshold(sensitivity);
  const hist = historyPaise.filter((v) => v > 0);
  if (threshold === null || hist.length < 3) return { anomaly: false, ratio: 1, meanPaise: 0 };
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const meanPaise = Math.round(mean);
  if (mean <= 0 || currentPaise <= mean) return { anomaly: false, ratio: 1, meanPaise };
  const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
  const std = Math.sqrt(variance);
  const z = std > 0 ? (currentPaise - mean) / std : Infinity;
  return { anomaly: z >= threshold, ratio: Math.round((currentPaise / mean) * 10) / 10, meanPaise };
}

function prefToSensitivity(
  pref: { enabled: boolean; leadDays: number | null } | undefined,
): AnomalySensitivity {
  if (!pref) return "normal"; // on by default; needs no threshold config
  if (!pref.enabled) return "off";
  return pref.leadDays === 1 ? "low" : pref.leadDays === 3 ? "high" : "normal";
}

/**
 * Per-category spending anomaly detector (runs on the alerts queue): compares
 * this month's spend per category against the trailing 6 months, firing once per
 * category per month via the alert ledger.
 */
export async function evaluateAnomalies(db: Db, userId: string): Promise<number> {
  const pref = (await listPrefs(db, userId)).find((p) => p.type === "anomaly" && p.accountId === null);
  const sensitivity = prefToSensitivity(pref);
  if (sensitivity === "off") return 0;

  const period = currentPeriodKey("monthly");
  // trailing months (oldest first) + current
  const keys: string[] = [period];
  let k = period;
  for (let i = 0; i < 6; i += 1) {
    k = prevPeriodKey("monthly", k);
    keys.unshift(k);
  }
  const perMonth = new Map<string, Map<string | null, number>>();
  for (const key of keys) {
    const { from, to } = periodRange("monthly", key);
    perMonth.set(key, await spentByCategory(db, userId, from, to));
  }
  const currentMap = perMonth.get(period)!;
  const historyKeys = keys.slice(0, -1);

  const catRows = await db.query.categories.findMany({ where: eq(categories.userId, userId) });
  const catName = new Map(catRows.map((c) => [c.id, c.name]));

  let fired = 0;
  for (const [categoryId, currentSpend] of currentMap.entries()) {
    if (categoryId === null || currentSpend <= 0) continue;
    const history = historyKeys.map((key) => perMonth.get(key)!.get(categoryId) ?? 0);
    const { anomaly, ratio, meanPaise } = detectAnomaly(currentSpend, history, sensitivity);
    if (!anomaly) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId, kind: "anomaly", refKey: `${categoryId}:${period}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    const name = catName.get(categoryId) ?? "a category";
    await createNotification(db, userId, {
      type: "anomaly",
      title: `Unusual spending on ${name}`,
      body: `${formatINR(currentSpend)} this month — about ${ratio}× your usual ${formatINR(meanPaise)}.`,
      data: { categoryId, period, ratio },
    });
    fired += 1;
  }
  return fired;
}
