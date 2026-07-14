import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type {
  CreateGoal,
  Goal,
  GoalContribution,
  GoalProgress,
  UpdateGoal,
} from "@compass/shared";
import { CreateGoalSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { alertLedger, goalContributions, goals, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createNotification } from "./notifications.ts";
import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "./periods.ts";
import { prefEnabled } from "./prefs.ts";

type GoalRow = typeof goals.$inferSelect;

function toGoal(g: GoalRow): Goal {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    targetPaise: g.targetPaise,
    targetMonths: g.targetMonths,
    targetDate: g.targetDate,
    accountId: g.accountId,
    archived: g.archivedAt !== null,
  };
}

async function ownedGoal(db: Db, userId: string, id: string): Promise<GoalRow> {
  const g = await db.query.goals.findFirst({ where: and(eq(goals.id, id), eq(goals.userId, userId)) });
  if (!g) throw new HttpError(404, "Goal not found");
  return g;
}

export async function listGoals(db: Db, userId: string): Promise<Goal[]> {
  const rows = await db.query.goals.findMany({
    where: eq(goals.userId, userId),
    orderBy: (g, { asc }) => [asc(g.createdAt)],
  });
  return rows.map(toGoal);
}

export async function createGoal(db: Db, userId: string, input: CreateGoal): Promise<Goal> {
  const parsed = CreateGoalSchema.parse(input);
  const rows = await db.insert(goals).values({ ...parsed, userId }).returning();
  return toGoal(rows[0]!);
}

export async function updateGoal(
  db: Db,
  userId: string,
  id: string,
  input: UpdateGoal,
): Promise<Goal> {
  const { archived, ...rest } = input;
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (archived !== undefined) set.archivedAt = archived ? new Date() : null;
  const rows = await db
    .update(goals)
    .set(set)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Goal not found");
  return toGoal(rows[0]!);
}

export async function deleteGoal(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.userId, userId)))
    .returning({ id: goals.id });
  if (rows.length === 0) throw new HttpError(404, "Goal not found");
}

/** Emergency-fund preset: target = N months × trailing 6-month average expenses. */
async function effectiveTarget(db: Db, userId: string, g: GoalRow): Promise<number> {
  if (g.targetPaise !== null) return g.targetPaise;
  if (g.type === "emergency_fund" && g.targetMonths !== null) {
    let key = prevPeriodKey("monthly", currentPeriodKey("monthly"));
    let total = 0;
    for (let i = 0; i < 6; i += 1) {
      const { from, to } = periodRange("monthly", key);
      const { expensePaise } = await incomeExpense(db, userId, from, to);
      total += expensePaise;
      key = prevPeriodKey("monthly", key);
    }
    return Math.round(total / 6) * g.targetMonths;
  }
  return 0;
}

/** Auto-record inflows to the linked account as contributions (idempotent). */
async function syncLinkedContributions(db: Db, userId: string, g: GoalRow): Promise<void> {
  if (!g.accountId) return;
  const inflows = await db
    .select({ id: transactions.id, amountPaise: transactions.amountPaise, date: transactions.date })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, g.accountId),
        gt(transactions.amountPaise, 0),
        isNull(transactions.deletedAt),
        sql`${transactions.date} >= ${g.createdAt.toISOString().slice(0, 10)}`,
      ),
    );
  if (inflows.length === 0) return;
  await db
    .insert(goalContributions)
    .values(
      inflows.map((t) => ({
        goalId: g.id,
        transactionId: t.id,
        amountPaise: t.amountPaise,
        date: t.date,
        note: "linked account inflow",
      })),
    )
    .onConflictDoNothing();
}

const MILESTONES = [100, 75, 50, 25] as const;

/** Milestone notifications (25/50/75/100%), each fired exactly once per goal. */
export async function checkGoalMilestones(
  db: Db,
  userId: string,
  goalId: string,
  percent: number,
  goalName: string,
): Promise<void> {
  if (!(await prefEnabled(db, userId, "goal"))) return;
  for (const m of MILESTONES) {
    if (percent < m) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId, kind: "goal-milestone", refKey: `${goalId}:${m}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length > 0) {
      await createNotification(db, userId, {
        type: "goal",
        title: m >= 100 ? `Goal “${goalName}” reached! 🎉` : `“${goalName}” is ${m}% funded`,
        data: { goalId, milestone: m },
      });
    }
    break; // only the highest newly-crossed milestone
  }
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (30.44 * 24 * 3600 * 1000);
}

export async function getGoalProgress(db: Db, userId: string, id: string): Promise<GoalProgress> {
  const g = await ownedGoal(db, userId, id);
  await syncLinkedContributions(db, userId, g);

  const contribs = await db.query.goalContributions.findMany({
    where: eq(goalContributions.goalId, g.id),
    orderBy: [desc(goalContributions.date), desc(goalContributions.createdAt)],
  });
  const saved = contribs.reduce((s, c) => s + c.amountPaise, 0);
  const target = await effectiveTarget(db, userId, g);
  const remaining = Math.max(0, target - saved);
  const percent = target > 0 ? (saved / target) * 100 : 0;

  // trailing 3-month contribution rate
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 91);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recent = contribs.filter((c) => c.date >= cutoffIso).reduce((s, c) => s + c.amountPaise, 0);
  const monthlyRate = Math.round(recent / 3);

  const projectedMonths = remaining === 0 ? 0 : monthlyRate > 0 ? remaining / monthlyRate : null;
  let projectedDate: string | null = null;
  if (projectedMonths !== null) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Math.round(projectedMonths * 30.44));
    projectedDate = d.toISOString().slice(0, 10);
  }

  let requiredMonthly: number | null = null;
  let onTrack: boolean | null = null;
  if (g.targetDate) {
    const monthsLeft = Math.max(0.1, monthsBetween(new Date(), new Date(`${g.targetDate}T00:00:00Z`)));
    requiredMonthly = Math.ceil(remaining / monthsLeft);
    onTrack = remaining === 0 || monthlyRate >= requiredMonthly;
  }

  await checkGoalMilestones(db, userId, g.id, percent, g.name);

  return {
    ...toGoal(g),
    effectiveTargetPaise: target,
    savedPaise: saved,
    remainingPaise: remaining,
    percent: Math.round(percent * 10) / 10,
    monthlyRatePaise: monthlyRate,
    projectedMonths: projectedMonths === null ? null : Math.round(projectedMonths * 10) / 10,
    projectedDate,
    requiredMonthlyPaise: requiredMonthly,
    onTrack,
    contributions: contribs.slice(0, 50).map(
      (c): GoalContribution => ({
        id: c.id,
        transactionId: c.transactionId,
        amountPaise: c.amountPaise,
        date: c.date,
        note: c.note,
      }),
    ),
  };
}

export async function addContribution(
  db: Db,
  userId: string,
  goalId: string,
  input: { amountPaise: number; date: string; note: string },
): Promise<GoalProgress> {
  const g = await ownedGoal(db, userId, goalId);
  await db.insert(goalContributions).values({ goalId: g.id, ...input });
  return getGoalProgress(db, userId, goalId);
}

export async function deleteContribution(
  db: Db,
  userId: string,
  goalId: string,
  contributionId: string,
): Promise<void> {
  await ownedGoal(db, userId, goalId);
  const rows = await db
    .delete(goalContributions)
    .where(and(eq(goalContributions.id, contributionId), eq(goalContributions.goalId, goalId)))
    .returning({ id: goalContributions.id });
  if (rows.length === 0) throw new HttpError(404, "Contribution not found");
}
