import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Notification } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { budgetAlerts, categories, notifications } from "../db/schema.ts";
import { formatINR } from "@compass/shared";
import { currentPeriodKey } from "./periods.ts";
import { getUtilization } from "./budgets.ts";

function toNotification(n: typeof notifications.$inferSelect): Notification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(
  db: Db,
  userId: string,
): Promise<{ items: Notification[]; unreadCount: number }> {
  const [items, unread] = await Promise.all([
    db.query.notifications.findMany({
      where: and(eq(notifications.userId, userId), isNull(notifications.archivedAt)),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      ),
  ]);
  return { items: items.map(toNotification), unreadCount: unread[0]!.count };
}

export async function markNotificationRead(db: Db, userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(db: Db, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** Archived notifications leave the center but stay in the table for history. */
export async function archiveNotification(db: Db, userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ archivedAt: new Date(), readAt: sql`coalesce(read_at, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function createNotification(
  db: DbOrTx,
  userId: string,
  input: { type: string; title: string; body?: string; data?: unknown },
): Promise<void> {
  await db.insert(notifications).values({
    userId,
    type: input.type,
    title: input.title,
    body: input.body ?? "",
    data: input.data ?? null,
  });
}

const THRESHOLDS = [100, 80] as const;

/**
 * Queued after ledger writes (debounced) — never inline in the write path.
 * The budget_alerts unique index guarantees each (period, category, threshold)
 * fires exactly once.
 */
export async function evaluateBudgetAlerts(db: Db, userId: string): Promise<number> {
  const key = currentPeriodKey("monthly");
  const util = await getUtilization(db, userId, "monthly", key);
  let fired = 0;
  for (const line of util.lines) {
    const available = line.budgetedPaise + line.carryPaise;
    if (available <= 0) continue;
    const pct = (line.spentPaise / available) * 100;
    for (const threshold of THRESHOLDS) {
      if (pct < threshold) continue;
      const inserted = await db
        .insert(budgetAlerts)
        .values({ userId, periodKey: key, categoryId: line.categoryId, threshold })
        .onConflictDoNothing()
        .returning({ id: budgetAlerts.id });
      if (inserted.length > 0) {
        const cat = await db.query.categories.findFirst({
          where: eq(categories.id, line.categoryId),
        });
        const name = cat?.name ?? "A category";
        await createNotification(db, userId, {
          type: "budget-alert",
          title:
            threshold >= 100
              ? `${name} is over budget`
              : `${name} has used ${Math.floor(pct)}% of its budget`,
          body: `Spent ${formatINR(line.spentPaise)} of ${formatINR(available)} in ${key}.`,
          data: { categoryId: line.categoryId, periodKey: key, threshold },
        });
        fired += 1;
      }
      break; // only the highest crossed threshold per evaluation
    }
  }
  return fired;
}
