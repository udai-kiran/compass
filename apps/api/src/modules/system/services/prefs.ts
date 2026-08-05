import { and, eq, isNull, sql } from "drizzle-orm";
import type { NotificationPref, NotificationType, UpsertNotificationPref } from "@compass/shared";
import { formatINR, UpsertNotificationPrefSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { alertLedger, notificationPrefs } from "../schema.ts";
import { bankCashBalances } from "../../ledger/services/balances.ts";
import { createNotification } from "./notifications.ts";
import { assertOwnedAccount } from "../../../lib/ownership.ts";

type PrefRow = typeof notificationPrefs.$inferSelect;

function toPref(p: PrefRow): NotificationPref {
  return {
    type: p.type as NotificationType,
    accountId: p.accountId,
    enabled: p.enabled,
    thresholdPaise: p.thresholdPaise,
    leadDays: p.leadDays,
  };
}

export async function listPrefs(db: Db, userId: string): Promise<NotificationPref[]> {
  const rows = await db.query.notificationPrefs.findMany({
    where: eq(notificationPrefs.userId, userId),
    orderBy: (p, { asc }) => [asc(p.type), asc(p.createdAt)],
  });
  return rows.map(toPref);
}

export async function upsertPref(
  db: Db,
  userId: string,
  input: UpsertNotificationPref,
): Promise<NotificationPref> {
  const parsed = UpsertNotificationPrefSchema.parse(input);
  // A per-account pref must point at the caller's own account, or a low-balance
  // alert would fire on — and name — someone else's account.
  await assertOwnedAccount(db, userId, parsed.accountId);
  const existing = await db.query.notificationPrefs.findFirst({
    where: and(
      eq(notificationPrefs.userId, userId),
      eq(notificationPrefs.type, parsed.type),
      parsed.accountId === null
        ? isNull(notificationPrefs.accountId)
        : eq(notificationPrefs.accountId, parsed.accountId),
    ),
  });
  if (existing) {
    const rows = await db
      .update(notificationPrefs)
      .set({
        enabled: parsed.enabled,
        thresholdPaise: parsed.thresholdPaise,
        leadDays: parsed.leadDays,
        updatedAt: new Date(),
      })
      .where(eq(notificationPrefs.id, existing.id))
      .returning();
    return toPref(rows[0]!);
  }
  const rows = await db
    .insert(notificationPrefs)
    .values({ ...parsed, userId })
    .returning();
  return toPref(rows[0]!);
}

/** Kind-level kill switch: a user-wide pref row with enabled=false mutes the type. */
export async function prefEnabled(db: Db, userId: string, type: NotificationType): Promise<boolean> {
  const row = await db.query.notificationPrefs.findFirst({
    where: and(
      eq(notificationPrefs.userId, userId),
      eq(notificationPrefs.type, type),
      isNull(notificationPrefs.accountId),
    ),
  });
  return row?.enabled ?? true;
}

/**
 * Large-transaction detector (runs on the debounced alerts queue): any
 * non-transfer transaction from the last 7 days at or above the user's
 * threshold fires once, keyed by transaction id.
 */
export async function evaluateLargeTransactions(db: Db, userId: string): Promise<number> {
  const prefs = (await listPrefs(db, userId)).filter(
    (p) => p.type === "large_transaction" && p.enabled && p.thresholdPaise !== null,
  );
  let fired = 0;
  for (const pref of prefs) {
    const res = await db.execute(sql`
      select t.id, t.merchant, t.amount_paise, t.date
      from transactions t
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= current_date - interval '7 days'
        and abs(t.amount_paise) >= ${pref.thresholdPaise}
        and not t.is_opening
        ${pref.accountId === null ? sql`` : sql`and t.account_id = ${pref.accountId}`}
        and not exists (select 1 from transfer_links tl
          where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    `);
    for (const t of res.rows as Array<{ id: string; merchant: string; amount_paise: string; date: string }>) {
      const inserted = await db
        .insert(alertLedger)
        .values({ userId, kind: "large-tx", refKey: t.id })
        .onConflictDoNothing()
        .returning({ id: alertLedger.id });
      if (inserted.length === 0) continue;
      const amount = Number(t.amount_paise);
      await createNotification(db, userId, {
        type: "large_transaction",
        title: `Large ${amount < 0 ? "payment" : "credit"}: ${formatINR(Math.abs(amount))}`,
        body: `${t.merchant || "(no merchant)"} on ${t.date}`,
        data: { transactionId: t.id },
      });
      fired += 1;
    }
  }
  return fired;
}

/**
 * Low-balance detector: bank/cash balances under the threshold fire at most
 * once per account per day.
 */
export async function evaluateLowBalance(db: Db, userId: string): Promise<number> {
  const prefs = (await listPrefs(db, userId)).filter(
    (p) => p.type === "low_balance" && p.enabled && p.thresholdPaise !== null,
  );
  if (prefs.length === 0) return 0;
  // Posted balance (future-dated credits excluded): a low-balance alert reflects
  // money that has actually landed, not a scheduled salary that hasn't.
  const balances = await bankCashBalances(db, userId);
  const today = new Date().toISOString().slice(0, 10);
  let fired = 0;
  for (const pref of prefs) {
    for (const acc of balances) {
      if (pref.accountId !== null && pref.accountId !== acc.id) continue;
      const balance = acc.balancePaise;
      if (balance >= pref.thresholdPaise!) continue;
      const inserted = await db
        .insert(alertLedger)
        .values({ userId, kind: "low-balance", refKey: `${acc.id}:${today}` })
        .onConflictDoNothing()
        .returning({ id: alertLedger.id });
      if (inserted.length === 0) continue;
      await createNotification(db, userId, {
        type: "low_balance",
        title: `${acc.name} balance is low`,
        body: `${formatINR(balance)} — below your ${formatINR(pref.thresholdPaise!)} floor.`,
        data: { accountId: acc.id },
      });
      fired += 1;
    }
  }
  return fired;
}
