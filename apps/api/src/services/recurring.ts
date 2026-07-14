import { and, eq, isNull, lte } from "drizzle-orm";
import type {
  CreateRecurringTemplate,
  RecurringTemplate,
  UpdateRecurringTemplate,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { recurringTemplates, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type TemplateRow = typeof recurringTemplates.$inferSelect;

function toTemplate(r: TemplateRow): RecurringTemplate {
  return {
    id: r.id,
    accountId: r.accountId,
    categoryId: r.categoryId,
    merchant: r.merchant,
    amountPaise: r.amountPaise,
    notes: r.notes,
    frequency: r.frequency,
    interval: r.interval,
    nextDueDate: r.nextDueDate,
    endDate: r.endDate,
    paused: r.pausedAt !== null,
    kind: r.kind,
    remindDays: r.remindDays,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Advance a due date by one schedule step; month/year steps clamp the day (Jan 31 → Feb 28). */
export function advanceDate(
  date: string,
  frequency: RecurringTemplate["frequency"],
  interval: number,
): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  switch (frequency) {
    case "daily": {
      const t = new Date(Date.UTC(y, m - 1, d + interval));
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    }
    case "weekly": {
      const t = new Date(Date.UTC(y, m - 1, d + 7 * interval));
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    }
    case "monthly": {
      const total = m - 1 + interval;
      const ty = y + Math.floor(total / 12);
      const tm = (total % 12) + 1;
      const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      return `${ty}-${pad(tm)}-${pad(Math.min(d, lastDay))}`;
    }
    case "yearly": {
      const ty = y + interval;
      const lastDay = new Date(Date.UTC(ty, m, 0)).getUTCDate();
      return `${ty}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
    }
  }
}

export async function listTemplates(db: Db, userId: string): Promise<RecurringTemplate[]> {
  const rows = await db.query.recurringTemplates.findMany({
    where: eq(recurringTemplates.userId, userId),
    orderBy: (t, { asc }) => [asc(t.nextDueDate)],
  });
  return rows.map(toTemplate);
}

export async function createTemplate(
  db: Db,
  userId: string,
  input: CreateRecurringTemplate,
): Promise<RecurringTemplate> {
  const rows = await db
    .insert(recurringTemplates)
    .values({ ...input, userId })
    .returning();
  return toTemplate(rows[0]!);
}

export async function updateTemplate(
  db: Db,
  userId: string,
  id: string,
  input: UpdateRecurringTemplate,
): Promise<RecurringTemplate> {
  const { paused, ...rest } = input;
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (paused !== undefined) set.pausedAt = paused ? new Date() : null;
  const rows = await db
    .update(recurringTemplates)
    .set(set)
    .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Template not found");
  return toTemplate(rows[0]!);
}

export async function deleteTemplate(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(recurringTemplates)
    .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, userId)))
    .returning({ id: recurringTemplates.id });
  if (rows.length === 0) throw new HttpError(404, "Template not found");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Materialize every due instance across all users. Insert + pointer advance
 * happen in one DB transaction per template, so a crash can't double-create —
 * the daily job is idempotent. Returns the affected user ids.
 */
export async function materializeDue(db: Db): Promise<{ created: number; userIds: string[] }> {
  const today = todayIso();
  const due = await db.query.recurringTemplates.findMany({
    where: and(isNull(recurringTemplates.pausedAt), lte(recurringTemplates.nextDueDate, today)),
  });
  let created = 0;
  const userIds = new Set<string>();
  for (const t of due) {
    await db.transaction(async (trx) => {
      const dates: string[] = [];
      let next = t.nextDueDate;
      while (next <= today) {
        if (t.endDate !== null && next > t.endDate) break;
        dates.push(next);
        next = advanceDate(next, t.frequency, t.interval);
      }
      // claim by advancing the pointer first — a concurrent run loses the race
      const claimed = await trx
        .update(recurringTemplates)
        .set({ nextDueDate: next, updatedAt: new Date() })
        .where(
          and(
            eq(recurringTemplates.id, t.id),
            eq(recurringTemplates.nextDueDate, t.nextDueDate),
          ),
        )
        .returning({ id: recurringTemplates.id });
      if (claimed.length === 0 || dates.length === 0) return;
      await trx.insert(transactions).values(
        dates.map((date) => ({
          userId: t.userId,
          accountId: t.accountId,
          date,
          amountPaise: t.amountPaise,
          merchant: t.merchant,
          categoryId: t.categoryId,
          notes: t.notes,
          source: "recurring" as const,
        })),
      );
      created += dates.length;
      userIds.add(t.userId);
    });
  }
  return { created, userIds: [...userIds] };
}
