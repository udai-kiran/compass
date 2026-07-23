import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { BillOccurrence, SubscriptionSuggestion } from "@compass/shared";
import { formatINR } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { recurringTemplates, subscriptionDismissals, alertLedger } from "../db/schema.ts";
import { createNotification } from "./notifications.ts";
import { prefEnabled } from "./prefs.ts";
import { advanceDate } from "./recurring.ts";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every bill/subscription occurrence due in the next `days` days, soonest first. */
export async function upcomingBills(db: Db, userId: string, days: number): Promise<BillOccurrence[]> {
  const templates = await db.query.recurringTemplates.findMany({
    where: and(eq(recurringTemplates.userId, userId), ne(recurringTemplates.kind, "none")),
  });
  const today = todayIso();
  const horizon = isoPlusDays(today, days);
  const out: BillOccurrence[] = [];
  for (const t of templates) {
    let due = t.nextDueDate;
    while (due <= horizon) {
      if (t.endDate !== null && due > t.endDate) break;
      out.push({
        templateId: t.id,
        merchant: t.merchant,
        amountPaise: t.amountPaise,
        dueDate: due,
        kind: t.kind,
        accountId: t.accountId,
        categoryId: t.categoryId,
        paused: t.pausedAt !== null,
      });
      due = advanceDate(due, t.frequency, t.interval);
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * Daily job: notify once per (template, due date) when a bill enters its
 * reminder window. Lead = remindDays, defaulting to 14 for yearly bills
 * (insurance premiums need runway) and 3 otherwise.
 */
export async function evaluateBillReminders(db: Db): Promise<number> {
  const today = todayIso();
  const templates = await db.query.recurringTemplates.findMany({
    where: and(ne(recurringTemplates.kind, "none"), isNull(recurringTemplates.pausedAt)),
  });
  let sent = 0;
  const muted = new Map<string, boolean>();
  for (const t of templates) {
    if (t.endDate !== null && t.nextDueDate > t.endDate) continue;
    const lead = t.remindDays ?? (t.frequency === "yearly" ? 14 : 3);
    if (t.nextDueDate > isoPlusDays(today, lead)) continue;
    if (!muted.has(t.userId)) muted.set(t.userId, !(await prefEnabled(db, t.userId, "bill")));
    if (muted.get(t.userId)) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId: t.userId, kind: "bill-reminder", refKey: `${t.id}:${t.nextDueDate}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    await createNotification(db, t.userId, {
      type: "bill",
      title: `${t.merchant} due ${t.nextDueDate === today ? "today" : `on ${t.nextDueDate}`}`,
      body: `${formatINR(Math.abs(t.amountPaise))} · ${t.kind}`,
      data: { templateId: t.id, dueDate: t.nextDueDate },
    });
    sent += 1;
  }
  return sent;
}

const MONTHLY_GAP = [28, 33] as const;
const YEARLY_GAP = [350, 380] as const;

/**
 * Forgotten-subscription detection: same merchant, steady amount (±10% of the
 * mean), regular cadence — 3+ occurrences ~monthly or 2+ ~yearly. Merchants
 * already templated or explicitly dismissed are excluded.
 */
export async function suggestSubscriptions(db: Db, userId: string): Promise<SubscriptionSuggestion[]> {
  const res = await db.execute(sql`
    select t.merchant, t.date, t.amount_paise, t.account_id, t.category_id
    from transactions t
    where t.user_id = ${userId} and t.deleted_at is null and t.amount_paise < 0
      and t.merchant <> '' and t.date >= current_date - interval '400 days'
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    order by t.merchant, t.date
  `);
  const rows = res.rows as Array<{
    merchant: string;
    date: string;
    amount_paise: string;
    account_id: string;
    category_id: string | null;
  }>;

  const [templates, dismissals] = await Promise.all([
    db.query.recurringTemplates.findMany({ where: eq(recurringTemplates.userId, userId) }),
    db.query.subscriptionDismissals.findMany({ where: eq(subscriptionDismissals.userId, userId) }),
  ]);
  const excluded = new Set([
    ...templates.map((t) => t.merchant.toLowerCase()),
    ...dismissals.map((d) => d.merchant.toLowerCase()),
  ]);

  const byMerchant = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.merchant.toLowerCase();
    if (excluded.has(key)) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(r);
    byMerchant.set(key, list);
  }

  const out: SubscriptionSuggestion[] = [];
  for (const group of byMerchant.values()) {
    if (group.length < 2) continue;
    const amounts = group.map((r) => -Number(r.amount_paise));
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (!amounts.every((a) => Math.abs(a - avg) <= avg * 0.1)) continue;

    const gaps: number[] = [];
    for (let i = 1; i < group.length; i += 1) {
      gaps.push(
        (new Date(`${group[i]!.date}T00:00:00Z`).getTime() -
          new Date(`${group[i - 1]!.date}T00:00:00Z`).getTime()) /
          86_400_000,
      );
    }
    const monthly =
      group.length >= 3 && gaps.every((g) => g >= MONTHLY_GAP[0] && g <= MONTHLY_GAP[1]);
    const yearly =
      !monthly && group.length >= 2 && gaps.every((g) => g >= YEARLY_GAP[0] && g <= YEARLY_GAP[1]);
    if (!monthly && !yearly) continue;

    const last = group[group.length - 1]!;
    out.push({
      merchant: last.merchant,
      avgAmountPaise: -Math.round(avg),
      occurrences: group.length,
      periodicity: monthly ? "monthly" : "yearly",
      lastDate: last.date,
      nextExpectedDate: isoPlusDays(last.date, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)),
      accountId: last.account_id,
      categoryId: last.category_id,
    });
  }
  return out.sort((a, b) => a.avgAmountPaise - b.avgAmountPaise);
}

export async function dismissSubscription(db: Db, userId: string, merchant: string): Promise<void> {
  await db.insert(subscriptionDismissals).values({ userId, merchant }).onConflictDoNothing();
}
