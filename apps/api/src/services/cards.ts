import { and, desc, eq, sql } from "drizzle-orm";
import type {
  CardDetails,
  CardSummary,
  CreateRewardEntry,
  RewardEntry,
  UpsertCardDetails,
} from "@compass/shared";
import { formatINR, UpsertCardDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, alertLedger, cardDetails, rewardEntries } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createNotification } from "./notifications.ts";
import { currentPeriodKey } from "./periods.ts";

type DetailsRow = typeof cardDetails.$inferSelect;

function toDetails(d: DetailsRow): CardDetails {
  return {
    accountId: d.accountId,
    cycleDay: d.cycleDay,
    dueDay: d.dueDay,
    creditLimitPaise: d.creditLimitPaise,
    utilizationAlertPct: d.utilizationAlertPct,
    remindDays: d.remindDays,
    earnRatePer100: d.earnRatePer100,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Latest date with the given day-of-month (1–28) on or before `ref`. */
export function lastOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d >= day) return `${y}-${pad(m)}-${pad(day)}`;
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${pad(pm)}-${pad(day)}`;
}

/** First date with the given day-of-month (1–28) strictly after `ref`. */
export function nextOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d < day) return `${y}-${pad(m)}-${pad(day)}`;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function ownedCardAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (acc.type !== "credit_card") throw new HttpError(400, "Not a credit card account");
  return acc;
}

export async function upsertCardDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertCardDetails,
): Promise<CardDetails> {
  await ownedCardAccount(db, userId, accountId);
  const parsed = UpsertCardDetailsSchema.parse(input);
  const rows = await db
    .insert(cardDetails)
    .values({ ...parsed, accountId, userId })
    .onConflictDoUpdate({
      target: cardDetails.accountId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toDetails(rows[0]!);
}

export async function listCards(db: Db, userId: string, today?: string): Promise<CardSummary[]> {
  const ref = today ?? new Date().toISOString().slice(0, 10);
  const cards = await db.query.accounts.findMany({
    where: and(eq(accounts.userId, userId), eq(accounts.type, "credit_card")),
    orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.createdAt)],
  });
  if (cards.length === 0) return [];
  const details = await db.query.cardDetails.findMany({ where: eq(cardDetails.userId, userId) });
  const detailsByAccount = new Map(details.map((d) => [d.accountId, d]));

  const out: CardSummary[] = [];
  for (const acc of cards) {
    if (acc.archivedAt) continue;
    const d = detailsByAccount.get(acc.id);

    const sums = await db.execute(sql`
      select
        coalesce(sum(amount_paise), 0)::bigint as total,
        coalesce(sum(amount_paise) filter (where date <= ${d ? lastOccurrence(ref, d.cycleDay) : ref}), 0)::bigint as at_close,
        coalesce(sum(amount_paise) filter (where amount_paise < 0 and date > ${d ? lastOccurrence(ref, d.cycleDay) : ref}), 0)::bigint as current_spend
      from transactions
      where account_id = ${acc.id} and user_id = ${userId} and deleted_at is null and date <= ${ref}
    `);
    const row = sums.rows[0] as { total: string; at_close: string; current_spend: string };
    const balance = acc.openingBalancePaise + Number(row.total);

    const rewards = await db
      .select({ points: sql<number>`coalesce(sum(points), 0)::int` })
      .from(rewardEntries)
      .where(eq(rewardEntries.accountId, acc.id));

    if (!d) {
      out.push({
        accountId: acc.id,
        name: acc.name,
        details: null,
        balancePaise: balance,
        statementStart: null,
        statementEnd: null,
        amountDuePaise: Math.max(0, -balance),
        dueDate: null,
        currentSpendPaise: 0,
        utilizationPct: null,
        rewardPoints: rewards[0]!.points,
      });
      continue;
    }

    const lastClose = lastOccurrence(ref, d.cycleDay);
    const prevClose = lastOccurrence(dayBefore(lastClose), d.cycleDay);
    const owedAtClose = -(acc.openingBalancePaise + Number(row.at_close));
    out.push({
      accountId: acc.id,
      name: acc.name,
      details: toDetails(d),
      balancePaise: balance,
      statementStart: prevClose,
      statementEnd: lastClose,
      amountDuePaise: Math.max(0, owedAtClose),
      dueDate: nextOccurrence(lastClose, d.dueDay),
      currentSpendPaise: -Number(row.current_spend),
      utilizationPct:
        d.creditLimitPaise > 0
          ? Math.round((Math.max(0, -balance) / d.creditLimitPaise) * 1000) / 10
          : null,
      rewardPoints: rewards[0]!.points,
    });
  }
  return out;
}

/** Daily job: due-date reminders for every configured card, once per due date. */
export async function evaluateCardDueReminders(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await db.query.cardDetails.findMany();
  let sent = 0;
  for (const d of all) {
    const cards = await listCards(db, d.userId, today);
    const card = cards.find((c) => c.accountId === d.accountId);
    if (!card || card.dueDate === null || card.amountDuePaise <= 0) continue;
    const remindFrom = new Date(`${card.dueDate}T00:00:00Z`);
    remindFrom.setUTCDate(remindFrom.getUTCDate() - d.remindDays);
    if (today < remindFrom.toISOString().slice(0, 10) || today > card.dueDate) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId: d.userId, kind: "card-due", refKey: `${d.accountId}:${card.dueDate}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    await createNotification(db, d.userId, {
      type: "bill",
      title: `${card.name} payment due ${card.dueDate === today ? "today" : `on ${card.dueDate}`}`,
      body: `${formatINR(card.amountDuePaise)} due for the statement ending ${card.statementEnd ?? ""}.`,
      data: { accountId: d.accountId, dueDate: card.dueDate },
    });
    sent += 1;
  }
  return sent;
}

/** Alerts-queue detector: utilization crossing the per-card threshold, once per period. */
export async function evaluateCardUtilization(db: Db, userId: string): Promise<number> {
  const cards = await listCards(db, userId);
  const period = currentPeriodKey("monthly");
  let fired = 0;
  for (const c of cards) {
    if (!c.details || c.details.utilizationAlertPct === null || c.utilizationPct === null) continue;
    if (c.utilizationPct < c.details.utilizationAlertPct) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId, kind: "card-utilization", refKey: `${c.accountId}:${period}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    await createNotification(db, userId, {
      type: "budget",
      title: `${c.name} is at ${c.utilizationPct}% utilization`,
      body: `${formatINR(Math.max(0, -c.balancePaise))} of ${formatINR(c.details.creditLimitPaise)} limit.`,
      data: { accountId: c.accountId },
    });
    fired += 1;
  }
  return fired;
}

// ---------- rewards ----------

export async function listRewards(db: Db, userId: string, accountId: string): Promise<RewardEntry[]> {
  await ownedCardAccount(db, userId, accountId);
  const rows = await db.query.rewardEntries.findMany({
    where: and(eq(rewardEntries.userId, userId), eq(rewardEntries.accountId, accountId)),
    orderBy: [desc(rewardEntries.date), desc(rewardEntries.createdAt)],
    limit: 100,
  });
  return rows.map((r) => ({ id: r.id, accountId: r.accountId, date: r.date, points: r.points, note: r.note }));
}

export async function addRewardEntry(
  db: Db,
  userId: string,
  accountId: string,
  input: CreateRewardEntry & { points: number },
): Promise<RewardEntry> {
  await ownedCardAccount(db, userId, accountId);
  const rows = await db
    .insert(rewardEntries)
    .values({ userId, accountId, date: input.date, points: input.points, note: input.note ?? "" })
    .returning();
  const r = rows[0]!;
  return { id: r.id, accountId: r.accountId, date: r.date, points: r.points, note: r.note };
}

export async function deleteRewardEntry(
  db: Db,
  userId: string,
  accountId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(rewardEntries)
    .where(
      and(eq(rewardEntries.id, id), eq(rewardEntries.userId, userId), eq(rewardEntries.accountId, accountId)),
    )
    .returning({ id: rewardEntries.id });
  if (rows.length === 0) throw new HttpError(404, "Entry not found");
}
