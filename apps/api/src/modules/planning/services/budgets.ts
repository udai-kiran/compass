import { and, eq } from "drizzle-orm";
import type {
  Budget,
  BudgetComparison,
  BudgetPeriod,
  BudgetUtilization,
  CreateBudget,
  UtilizationLine,
} from "@compass/shared";
import { CreateBudgetSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { budgetLines, budgets } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedCategory } from "../../../lib/ownership.ts";
import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../lib/periods.ts";

/** Past periods are closed: viewable with their then-current budget, never editable. */
export function isClosed(period: BudgetPeriod, key: string): boolean {
  return key < currentPeriodKey(period);
}

function assertWritable(period: BudgetPeriod, key: string): void {
  if (isClosed(period, key)) throw new HttpError(409, "Past periods are closed and immutable");
}

async function findBudget(db: Db, userId: string, period: BudgetPeriod, key: string) {
  return db.query.budgets.findFirst({
    where: and(eq(budgets.userId, userId), eq(budgets.period, period), eq(budgets.periodKey, key)),
  });
}

export async function getBudget(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
): Promise<Budget | null> {
  const b = await findBudget(db, userId, period, key);
  if (!b) return null;
  const lines = await db.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, b.id) });
  return {
    id: b.id,
    period: b.period,
    periodKey: b.periodKey,
    lines: lines.map((l) => ({
      id: l.id,
      categoryId: l.categoryId,
      amountPaise: l.amountPaise,
      rollover: l.rollover,
    })),
  };
}

/** Create or fully replace the budget for a period. */
export async function upsertBudget(
  db: Db,
  userId: string,
  input: CreateBudget,
): Promise<Budget> {
  const parsed = CreateBudgetSchema.parse(input);
  assertWritable(parsed.period, parsed.periodKey);
  for (const l of parsed.lines) await assertOwnedCategory(db, userId, l.categoryId);
  const budget = await db.transaction(async (t) => {
    let b = await t.query.budgets.findFirst({
      where: and(
        eq(budgets.userId, userId),
        eq(budgets.period, parsed.period),
        eq(budgets.periodKey, parsed.periodKey),
      ),
    });
    if (!b) {
      const rows = await t
        .insert(budgets)
        .values({ userId, period: parsed.period, periodKey: parsed.periodKey })
        .returning();
      b = rows[0]!;
    }
    await t.delete(budgetLines).where(eq(budgetLines.budgetId, b.id));
    await t.insert(budgetLines).values(
      parsed.lines.map((l) => ({
        budgetId: b.id,
        categoryId: l.categoryId,
        amountPaise: l.amountPaise,
        rollover: l.rollover,
      })),
    );
    return b;
  });
  return (await getBudget(db, userId, budget.period, budget.periodKey))!;
}

/** Upsert one line, creating the period's budget if needed (inline edit path). */
export async function upsertBudgetLine(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
  line: { categoryId: string; amountPaise: number; rollover: boolean },
): Promise<Budget> {
  assertWritable(period, key);
  await assertOwnedCategory(db, userId, line.categoryId);
  await db.transaction(async (t) => {
    let b = await t.query.budgets.findFirst({
      where: and(eq(budgets.userId, userId), eq(budgets.period, period), eq(budgets.periodKey, key)),
    });
    if (!b) {
      const rows = await t.insert(budgets).values({ userId, period, periodKey: key }).returning();
      b = rows[0]!;
    }
    await t
      .insert(budgetLines)
      .values({ budgetId: b.id, ...line })
      .onConflictDoUpdate({
        target: [budgetLines.budgetId, budgetLines.categoryId],
        set: { amountPaise: line.amountPaise, rollover: line.rollover, updatedAt: new Date() },
      });
  });
  return (await getBudget(db, userId, period, key))!;
}

export async function deleteBudgetLine(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
  categoryId: string,
): Promise<void> {
  assertWritable(period, key);
  const b = await findBudget(db, userId, period, key);
  if (!b) throw new HttpError(404, "No budget for this period");
  await db
    .delete(budgetLines)
    .where(and(eq(budgetLines.budgetId, b.id), eq(budgetLines.categoryId, categoryId)));
}

type RawLine = { categoryId: string; budgetedPaise: number; rollover: boolean; carryPaise: number; spentPaise: number };

/**
 * Utilization with rollover: a rollover line carries the previous period's
 * remaining (budgeted + its carry − spent, possibly negative) forward.
 * Walks back through consecutive budgeted periods, bounded.
 */
async function utilizationRaw(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
  depth: number,
): Promise<Map<string, RawLine>> {
  const out = new Map<string, RawLine>();
  const b = await findBudget(db, userId, period, key);
  if (!b) return out;
  const lines = await db.query.budgetLines.findMany({ where: eq(budgetLines.budgetId, b.id) });
  if (lines.length === 0) return out;
  const { from, to } = periodRange(period, key);
  const spent = await spentByCategory(db, userId, from, to);
  const needCarry = lines.some((l) => l.rollover) && depth > 0;
  const prev = needCarry
    ? await utilizationRaw(db, userId, period, prevPeriodKey(period, key), depth - 1)
    : new Map<string, RawLine>();
  for (const l of lines) {
    let carry = 0;
    if (l.rollover) {
      const p = prev.get(l.categoryId);
      if (p) carry = p.budgetedPaise + p.carryPaise - p.spentPaise;
    }
    out.set(l.categoryId, {
      categoryId: l.categoryId,
      budgetedPaise: l.amountPaise,
      rollover: l.rollover,
      carryPaise: carry,
      spentPaise: spent.get(l.categoryId) ?? 0,
    });
  }
  return out;
}

export async function getUtilization(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
): Promise<BudgetUtilization> {
  const b = await findBudget(db, userId, period, key);
  const raw = await utilizationRaw(db, userId, period, key, 24);
  const lines: UtilizationLine[] = [...raw.values()].map((l) => ({
    categoryId: l.categoryId,
    budgetedPaise: l.budgetedPaise,
    carryPaise: l.carryPaise,
    spentPaise: l.spentPaise,
    remainingPaise: l.budgetedPaise + l.carryPaise - l.spentPaise,
    rollover: l.rollover,
  }));
  lines.sort((a, b2) => b2.spentPaise - a.spentPaise);
  return {
    budgetId: b?.id ?? null,
    period,
    periodKey: key,
    closed: isClosed(period, key),
    lines,
    totalBudgetedPaise: lines.reduce((s, l) => s + l.budgetedPaise + l.carryPaise, 0),
    totalSpentPaise: lines.reduce((s, l) => s + l.spentPaise, 0),
  };
}

/** Deterministic wizard input: trailing 3 full months of average spend per category. */
export async function suggestBudget(
  db: Db,
  userId: string,
): Promise<Array<{ categoryId: string; avgMonthlyPaise: number }>> {
  const current = currentPeriodKey("monthly");
  const m1 = prevPeriodKey("monthly", current);
  const m3 = prevPeriodKey("monthly", prevPeriodKey("monthly", m1));
  const { from } = periodRange("monthly", m3);
  const { to } = periodRange("monthly", m1);
  const spent = await spentByCategory(db, userId, from, to);
  return [...spent.entries()]
    .filter((e): e is [string, number] => e[0] !== null && e[1] > 0)
    .map(([categoryId, total]) => ({
      categoryId,
      avgMonthlyPaise: Math.round(total / 3 / 100) * 100, // round to whole rupees
    }))
    .sort((a, b) => b.avgMonthlyPaise - a.avgMonthlyPaise);
}

export async function copyFromPreviousPeriod(
  db: Db,
  userId: string,
  period: BudgetPeriod,
  key: string,
): Promise<Budget> {
  assertWritable(period, key);
  const prev = await getBudget(db, userId, period, prevPeriodKey(period, key));
  if (!prev || prev.lines.length === 0) {
    throw new HttpError(404, "No budget in the previous period to copy");
  }
  if (await findBudget(db, userId, period, key)) {
    throw new HttpError(409, "This period already has a budget");
  }
  return upsertBudget(db, userId, {
    period,
    periodKey: key,
    lines: prev.lines.map((l) => ({
      categoryId: l.categoryId,
      amountPaise: l.amountPaise,
      rollover: l.rollover,
    })),
  });
}

/** This month vs last month vs trailing 3-month average, per category. */
export async function comparePeriods(
  db: Db,
  userId: string,
  key: string,
): Promise<BudgetComparison> {
  const last = prevPeriodKey("monthly", key);
  const m3 = prevPeriodKey("monthly", prevPeriodKey("monthly", last));
  const cur = periodRange("monthly", key);
  const lastR = periodRange("monthly", last);
  const avgR = { from: periodRange("monthly", m3).from, to: lastR.to };
  const [curSpent, lastSpent, avgSpent, budget] = await Promise.all([
    spentByCategory(db, userId, cur.from, cur.to),
    spentByCategory(db, userId, lastR.from, lastR.to),
    spentByCategory(db, userId, avgR.from, avgR.to),
    getBudget(db, userId, "monthly", key),
  ]);
  const budgeted = new Map(budget?.lines.map((l) => [l.categoryId, l.amountPaise]) ?? []);
  const cats = new Set<string>();
  for (const m of [curSpent, lastSpent, avgSpent]) {
    for (const c of m.keys()) if (c !== null) cats.add(c);
  }
  for (const c of budgeted.keys()) cats.add(c);
  return {
    periodKey: key,
    lines: [...cats]
      .map((categoryId) => ({
        categoryId,
        budgetedPaise: budgeted.get(categoryId) ?? null,
        spentPaise: curSpent.get(categoryId) ?? 0,
        lastSpentPaise: lastSpent.get(categoryId) ?? 0,
        avg3moPaise: Math.round((avgSpent.get(categoryId) ?? 0) / 3),
      }))
      .sort((a, b) => b.spentPaise - a.spentPaise),
  };
}
