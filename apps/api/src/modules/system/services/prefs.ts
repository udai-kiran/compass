import { and, eq, isNull, sql } from "drizzle-orm";
import type { NotificationPref, NotificationType, UpsertNotificationPref } from "@compass/shared";
import { formatINR, UpsertNotificationPrefSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { alertLedger, notificationPrefs } from "../schema.ts";
import { bankCashBalances } from "../../ledger/services/balances.ts";
import { createNotification } from "./notifications.ts";
import { assertOwnedAccount } from "../../../lib/ownership.ts";
import { HttpError } from "../../../lib/errors.ts";
import { hasCategoryDimension } from "../../../lib/ledger-sql.ts";

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
      select t.id, t.merchant, p.amount_paise, t.date
      from postings p
      join accounts a on a.id = p.account_id
      join transactions t on t.id = p.transaction_id
      where t.user_id = ${userId} and t.deleted_at is null
        and t.date >= current_date - interval '7 days'
        and abs(p.amount_paise) >= ${pref.thresholdPaise}
        and a.system_kind is null
        ${pref.accountId === null ? sql`` : sql`and a.id = ${pref.accountId}`}
        and ${hasCategoryDimension()}
    `);
    for (const t of res.rows as Array<{ id: string; merchant: string; amount_paise: string; date: string }>) {
      const amount = Number(t.amount_paise);
      if (!Number.isSafeInteger(amount)) {
        throw new HttpError(500, "Transaction amount exceeded a safe integer — refusing to lose paise");
      }
      const inserted = await db
        .insert(alertLedger)
        .values({ userId, kind: "large-tx", refKey: t.id })
        .onConflictDoNothing()
        .returning({ id: alertLedger.id });
      if (inserted.length === 0) continue;
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
