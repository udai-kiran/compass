import type { Redis } from "ioredis";
import type { GoalProgress } from "@compass/shared";
import { formatINR } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { alertLedger, users } from "../db/schema.ts";
import { getForecast } from "./cashflow.ts";
import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";
import { getGoalProgress, listGoals } from "./goals.ts";
import { createNotification } from "./notifications.ts";
import { prefEnabled } from "./prefs.ts";

/**
 * Outcome of a fan-out review. `errors` carries the per-user failures so the job
 * can log them with a userId (a bad signal for one user is caught so it doesn't
 * abort the others) and decide whether to fail the job — a review where *every*
 * user errored is a systemic fault (schema drift, dependency down), not an
 * isolated hiccup, and must surface as a failed job rather than a silent success.
 */
export interface ReviewResult {
  fired: number;
  processed: number;
  errors: Array<{ userId: string; error: unknown }>;
}

/**
 * Financial Autopilot — a scheduled per-user review that turns Compass's
 * deterministic signals into forward-looking heads-ups, so the user hears about
 * a problem *before* it happens instead of finding it in a dashboard afterwards.
 *
 * This is the orchestration spine: {@link runAutopilotReview} fans out over
 * every user and each `evaluate*` detector contributes candidates. The first
 * signal is the predictive cash-flow shortfall below — existing alerts
 * (low_balance, anomaly, …) are reactive; this one reads the 90-day forecast the
 * app already computes and warns when the projected balance is on track to run
 * low. Detection is fully deterministic; AI phrasing is layered on separately so
 * the review always works with AI disabled.
 */

/** Monday (UTC) of the week containing `iso` — the dedup key so a persisting
 * shortfall re-alerts at most once per week rather than every night. */
export function weekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // getUTCDay: 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export interface CashShortfall {
  /** true when the projected balance dips below `floorPaise` within the horizon */
  breaches: boolean;
  /** lowest projected balance in the window (the trough) */
  troughPaise: number;
  /** date of that trough */
  troughDate: string;
  /** first date the projection crosses below the floor, or null if it never does */
  breachDate: string | null;
}

/**
 * Scan the forecast's projected daily balances for a coming shortfall. Looks
 * ahead from *tomorrow* (index 1) through `horizonDays` — a low balance *today*
 * is the reactive low_balance alert's job; Autopilot is about what's ahead.
 * Reports the trough (deepest projected dip) and the first day the balance is
 * projected to fall below the floor.
 */
export function detectCashShortfall(
  days: Array<{ date: string; balancePaise: number }>,
  opts: { horizonDays?: number; floorPaise?: number } = {},
): CashShortfall {
  const horizonDays = opts.horizonDays ?? 30;
  const floorPaise = opts.floorPaise ?? 0;
  const window = days.slice(1, horizonDays + 1);
  if (window.length === 0) {
    return { breaches: false, troughPaise: 0, troughDate: "", breachDate: null };
  }
  let trough = window[0]!;
  let breachDate: string | null = null;
  for (const d of window) {
    if (d.balancePaise < trough.balancePaise) trough = d;
    if (breachDate === null && d.balancePaise < floorPaise) breachDate = d.date;
  }
  return {
    breaches: breachDate !== null,
    troughPaise: trough.balancePaise,
    troughDate: trough.date,
    breachDate,
  };
}

/**
 * Predictive cash-flow signal for one user: if the 90-day forecast projects the
 * balance dipping below zero within the next month, fire a single heads-up.
 * Pref-gated (`cash_runway`) and deduped by ISO week via the alert ledger.
 * Returns the number of notifications created (0 or 1).
 */
export async function evaluateCashRunway(db: Db, redis: Redis, userId: string): Promise<number> {
  if (!(await prefEnabled(db, userId, "cash_runway"))) return 0;
  const forecast = await getForecast(db, redis, userId);
  const shortfall = detectCashShortfall(forecast.days);
  if (!shortfall.breaches) return 0;

  const today = new Date().toISOString().slice(0, 10);
  // Ledger claim and notification commit together: if the notification insert
  // fails, the ledger row rolls back too, so the alert isn't permanently deduped
  // (skipped for the rest of the week) after never having been delivered.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(alertLedger)
      .values({ userId, kind: "cash-runway", refKey: weekKey(today) })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) return 0;

    await createNotification(tx, userId, {
      type: "cash_runway",
      title: "Cash-flow heads up",
      body:
        `Your balance is projected to dip to ${formatINR(shortfall.troughPaise)} ` +
        `by ${shortfall.troughDate} at your current pace. A quick review now beats an overdraft later.`,
      data: {
        troughDate: shortfall.troughDate,
        troughPaise: shortfall.troughPaise,
        breachDate: shortfall.breachDate,
      },
    });
    return 1;
  });
}

/**
 * Nightly Autopilot review — runs every signal for every user. Isolated
 * per-user so one user's transient failure never aborts the fan-out. Returns
 * the total number of heads-ups sent across all users.
 */
export async function runAutopilotReview(db: Db, redis: Redis): Promise<ReviewResult> {
  const allUsers = await db.select({ id: users.id }).from(users);
  let fired = 0;
  const errors: ReviewResult["errors"] = [];
  for (const u of allUsers) {
    try {
      fired += await evaluateCashRunway(db, redis, u.id);
    } catch (error) {
      // Isolate the user, but keep the failure so the caller can log/alarm on it.
      errors.push({ userId: u.id, error });
    }
  }
  return { fired, processed: allUsers.length, errors };
}

/** The one-line proposal for a goal that needs attention, or null when it's fine. */
export function goalPlanMessage(p: GoalProgress): { title: string; body: string } | null {
  const { plan } = p;
  const behind = plan.status === "behind" && (plan.recommendedMonthlyPaise ?? 0) > 0;
  if (!behind && !plan.allocationDrifted) return null;

  const parts: string[] = [];
  if (behind) {
    parts.push(
      `Behind target — invest about ${formatINR(plan.recommendedMonthlyPaise!)}/mo ` +
        `(${formatINR(plan.monthlyEquityPaise)} equity · ${formatINR(plan.monthlyDebtPaise)} debt) ` +
        `to reach it by ${p.targetDate ?? "the target date"}.`,
    );
  }
  if (plan.allocationDrifted) {
    const parkedInOther = plan.targetEquityPct > 0 && p.otherPct > OTHER_BAND_PCT;
    if (parkedInOther) {
      // Drift is dominated by uninvested cash/gold, not a skewed equity/debt ratio.
      parts.push(
        `${Math.round(p.otherPct)}% of this goal is sitting in cash/other — put it to work ` +
          `toward a ${plan.targetEquityPct}% equity / ${plan.targetDebtPct}% debt mix.`,
      );
    } else {
      // Report the equity share of the invested (equity+debt) portion — the same
      // basis the target is on — so the comparison reads consistently.
      const equityShare = Math.round(equityShareOfInvestable(p.equityPct, p.debtPct));
      parts.push(
        `Your mix is ${equityShare}% equity vs a suggested ${plan.targetEquityPct}% — ` +
          `consider rebalancing.`,
      );
    }
  }
  return {
    title: behind ? `“${p.name}” needs a boost` : `“${p.name}” has drifted`,
    body: parts.join(" "),
  };
}

/**
 * Weekly goal-plan signal for one user: for each active goal, check whether it's
 * behind pace or its allocation has drifted, and propose the fix (how much to
 * invest, split equity/debt). Pref-gated on `goal_plan` — its own switch, so this
 * unsolicited planning advice can be muted without losing goal *milestone* alerts
 * (`goal`). Deduped per goal per ISO week. Returns the number of proposals sent.
 */
export async function evaluateGoalPlans(db: Db, userId: string): Promise<number> {
  if (!(await prefEnabled(db, userId, "goal_plan"))) return 0;
  const goals = (await listGoals(db, userId)).filter((g) => !g.archived);
  const wk = weekKey(new Date().toISOString().slice(0, 10));
  let fired = 0;
  for (const g of goals) {
    const progress = await getGoalProgress(db, userId, g.id);
    const message = goalPlanMessage(progress);
    if (!message) continue;
    // Ledger + notification commit atomically — see evaluateCashRunway.
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(alertLedger)
        .values({ userId, kind: "goal-plan", refKey: `${g.id}:${wk}` })
        .onConflictDoNothing()
        .returning({ id: alertLedger.id });
      if (inserted.length === 0) return false;
      await createNotification(tx, userId, {
        type: "goal_plan",
        title: message.title,
        body: message.body,
        data: { goalId: g.id, status: progress.plan.status },
      });
      return true;
    });
    if (created) fired += 1;
  }
  return fired;
}

/**
 * Weekly goal review — proposes contributions/rebalances for every user's goals.
 * Isolated per-user like {@link runAutopilotReview}.
 */
export async function runGoalReview(db: Db): Promise<ReviewResult> {
  const allUsers = await db.select({ id: users.id }).from(users);
  let fired = 0;
  const errors: ReviewResult["errors"] = [];
  for (const u of allUsers) {
    try {
      fired += await evaluateGoalPlans(db, u.id);
    } catch (error) {
      errors.push({ userId: u.id, error });
    }
  }
  return { fired, processed: allUsers.length, errors };
}
