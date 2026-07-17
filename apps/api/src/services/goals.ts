import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type {
  CreateGoal,
  Goal,
  GoalAssetProgress,
  GoalProgress,
  UpdateGoal,
} from "@compass/shared";
import { CreateGoalSchema, isRetirementAccount } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { alertLedger, goals, holdingEvents, retirementDetails, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { listAccounts } from "./accounts.ts";
import { getPortfolio } from "./holdings.ts";
import { accountReturnBps, assetClassReturnBps } from "./goal-returns.ts";
import { projectGoal } from "./goal-projection.ts";
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

/**
 * Ongoing contribution rate into a goal's mapped assets, paise/month.
 *
 * "Money in" is measured where it actually lands: positive transactions into the
 * mapped accounts (PPF/EPF deposits, cash top-ups) plus net purchases — buys
 * minus sells — into the mapped holdings, since MF/stock contributions arrive as
 * purchase events, not as bank transactions on the account. A single trailing
 * 12-month window then averages to a month, smoothing lumpy SIP timing and
 * one-off lump sums. Floored at 0: a net redemption isn't a contribution.
 */
async function mappedContributionRate(
  db: Db,
  userId: string,
  accountIds: string[],
  holdingIds: string[],
): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  let total = 0;
  if (accountIds.length > 0) {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${transactions.amountPaise}), 0)::bigint` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.accountId, accountIds),
          gt(transactions.amountPaise, 0),
          isNull(transactions.deletedAt),
          sql`${transactions.date} >= ${cutoffIso}`,
          sql`${transactions.date} <= ${today}`,
        ),
      );
    total += Number(row?.total ?? 0);
  }
  if (holdingIds.length > 0) {
    // amount_paise is always positive; the event type carries direction.
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(case
          when ${holdingEvents.type} = 'buy' then ${holdingEvents.amountPaise}
          when ${holdingEvents.type} = 'sell' then -${holdingEvents.amountPaise}
          else 0 end), 0)::bigint`,
      })
      .from(holdingEvents)
      .where(
        and(
          inArray(holdingEvents.holdingId, holdingIds),
          sql`${holdingEvents.date} >= ${cutoffIso}`,
          sql`${holdingEvents.date} <= ${today}`,
        ),
      );
    total += Number(row?.total ?? 0);
  }
  return Math.max(0, Math.round(total / 12));
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

  const [accountList, portfolio, target] = await Promise.all([
    listAccounts(db, userId),
    getPortfolio(db, userId),
    effectiveTarget(db, userId, g),
  ]);

  const mappedAccounts = accountList.filter((a) => a.goalId === g.id && a.archivedAt === null);
  const mappedHoldings = portfolio.positions.filter((p) => p.goalId === g.id && !p.archived);

  // Credited-rate accounts (PPF/EPF/SSY) project at their stored rate, not a guess.
  const retirementIds = mappedAccounts.filter((a) => isRetirementAccount(a.type)).map((a) => a.id);
  const rateRows = retirementIds.length
    ? await db
        .select({ accountId: retirementDetails.accountId, bps: retirementDetails.annualRateBps })
        .from(retirementDetails)
        .where(inArray(retirementDetails.accountId, retirementIds))
    : [];
  const rateByAccount = new Map(rateRows.map((r) => [r.accountId, r.bps]));

  const assets: GoalAssetProgress[] = [
    ...mappedAccounts.map(
      (a): GoalAssetProgress => ({
        kind: "account",
        id: a.id,
        name: a.name,
        subtitle: a.accountLast4 ? `•••• ${a.accountLast4}` : a.type,
        valuePaise: a.balancePaise,
        annualReturnBps: accountReturnBps(a.type, rateByAccount.get(a.id) ?? null),
      }),
    ),
    ...mappedHoldings.map(
      (p): GoalAssetProgress => ({
        kind: "holding",
        id: p.id,
        name: p.name,
        subtitle: p.folioNumber ? `Folio ${p.folioNumber}` : p.assetClass,
        valuePaise: p.currentValuePaise,
        annualReturnBps: assetClassReturnBps(p.assetClass),
      }),
    ),
  ];

  const monthlyInflowPaise = await mappedContributionRate(
    db,
    userId,
    mappedAccounts.map((a) => a.id),
    mappedHoldings.map((p) => p.id),
  );
  const monthsToTarget = g.targetDate
    ? Math.max(0, monthsBetween(new Date(), new Date(`${g.targetDate}T00:00:00Z`)))
    : null;

  const proj = projectGoal({
    assets: assets.map((a) => ({ valuePaise: a.valuePaise, annualReturnBps: a.annualReturnBps })),
    targetPaise: target,
    monthsToTarget,
    monthlyInflowPaise,
  });

  const funded = proj.fundedPaise;
  const remaining = Math.max(0, target - funded);
  const percent = target > 0 ? (funded / target) * 100 : 0;

  let projectedDate: string | null = null;
  if (proj.projectedMonths !== null) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Math.round(proj.projectedMonths * 30.44));
    projectedDate = d.toISOString().slice(0, 10);
  }

  await checkGoalMilestones(db, userId, g.id, percent, g.name);

  return {
    ...toGoal(g),
    effectiveTargetPaise: target,
    fundedPaise: funded,
    remainingPaise: remaining,
    percent: Math.round(percent * 10) / 10,
    blendedReturnBps: proj.blendedReturnBps,
    monthlyInflowPaise,
    projectedValuePaise: proj.projectedValuePaise,
    shortfallPaise: proj.shortfallPaise,
    projectedMonths: proj.projectedMonths === null ? null : Math.round(proj.projectedMonths * 10) / 10,
    projectedDate,
    requiredMonthlyPaise: proj.requiredMonthlyPaise,
    onTrack: proj.onTrack,
    assets,
  };
}
