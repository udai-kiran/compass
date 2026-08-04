import { formatINR } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { alertLedger } from "../../../db/schema.ts";
import { cardDetails } from "../schema.ts";
import { createNotification } from "../../../services/notifications.ts";
import { currentPeriodKey } from "../../../services/periods.ts";
import { listCardHolders } from "./cards.ts";

/** Daily job: due-date reminders for every configured card, once per due date. */
export async function evaluateCardDueReminders(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const users = await db.selectDistinct({ userId: cardDetails.userId }).from(cardDetails);
  let sent = 0;
  for (const { userId } of users) {
    const holders = await listCardHolders(db, userId, today);
    for (const holder of holders) {
      // Reminder lead time is an issuer-level setting; due dates stay per card.
      const remindDays = holder.settings?.remindDays ?? 3;
      for (const card of holder.cards) {
        if (card.dueDate === null || card.amountDuePaise <= 0) continue;
        const remindFrom = new Date(`${card.dueDate}T00:00:00Z`);
        remindFrom.setUTCDate(remindFrom.getUTCDate() - remindDays);
        if (today < remindFrom.toISOString().slice(0, 10) || today > card.dueDate) continue;
        const inserted = await db
          .insert(alertLedger)
          .values({ userId, kind: "card-due", refKey: `${card.accountId}:${card.dueDate}` })
          .onConflictDoNothing()
          .returning({ id: alertLedger.id });
        if (inserted.length === 0) continue;
        await createNotification(db, userId, {
          type: "bill",
          title: `${card.name} payment due ${card.dueDate === today ? "today" : `on ${card.dueDate}`}`,
          body: `${formatINR(card.amountDuePaise)} due for the statement ending ${card.statementEnd ?? ""}.`,
          data: { accountId: card.accountId, dueDate: card.dueDate },
        });
        sent += 1;
      }
    }
  }
  return sent;
}

/** Alerts-queue detector: combined utilization crossing a bank's threshold, once per period. */
export async function evaluateCardUtilization(db: Db, userId: string): Promise<number> {
  const holders = await listCardHolders(db, userId);
  const period = currentPeriodKey("monthly");
  let fired = 0;
  for (const h of holders) {
    if (h.institution === null || h.utilizationAlertPct === null || h.utilizationPct === null) continue;
    if (h.utilizationPct < h.utilizationAlertPct) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId, kind: "card-utilization", refKey: `${h.institution}:${period}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    await createNotification(db, userId, {
      type: "budget",
      title: `${h.bankName} cards at ${h.utilizationPct}% utilization`,
      body: `${formatINR(h.totalOwedPaise)} of ${formatINR(h.creditLimitPaise)} combined limit.`,
      data: { institution: h.institution },
    });
    fired += 1;
  }
  return fired;
}
