import { eq } from "drizzle-orm";
import { formatINR } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { alertLedger, userTasks, users } from "../../../db/schema.ts";
import { cardDetails } from "../schema.ts";
import { listCardHolders } from "./cards.ts";

/**
 * Materialises credit-card due dates as `user_tasks` rows so they show up on
 * the Tasks page, not only as a `notifications` reminder
 * (`evaluateCardDueReminders`). This module reuses `listCardHolders` for every
 * bit of cycle/due-date/amount arithmetic — it never recomputes any of that
 * itself — and its eligibility window mirrors `evaluateCardDueReminders`
 * exactly (see `alerts.ts`'s `evaluateCardDueReminders`, same sibling
 * `services/` directory).
 *
 * **No delete path, no update path.** This module only ever inserts. A stale
 * generated task (e.g. after `cycleDay`/`dueDay` changes mid-window) is left
 * as-is — visible, provenance-labelled, and deletable by the user in one
 * click — rather than silently mutated or removed. See TASK.md's "Config
 * drift" section for why: every mechanism that prunes it needs the service to
 * guess user intent about a user-visible row, and every such guess tried so
 * far has independently been rejected in review.
 */

const CARD_DUE_TASK_KIND = "card-due-task";

/** The provenance key shared by the `alert_ledger` claim and the task's `sourceKey` — built once, in one place, so both always agree. */
function cardDueSourceKey(accountId: string, dueDate: string): string {
  return `${accountId}:${dueDate}`;
}

/**
 * Truncate to at most 200 UTF-16 code units (the `user_tasks.title` cap
 * enforced by `CreateUserTaskSchema`, which this insert bypasses), then drop a
 * trailing unmatched high surrogate. A bare `slice(0, 200)` can split a
 * surrogate pair in two, leaving a lone high surrogate that PostgreSQL's UTF-8
 * encoding may reject outright — defeating the very insertion-safety this
 * exists for.
 */
export function truncateTaskTitle(title: string, maxLength = 200): string {
  if (title.length <= maxLength) return title;
  const truncated = title.slice(0, maxLength);
  const lastCode = truncated.charCodeAt(truncated.length - 1);
  const isUnmatchedHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return isUnmatchedHighSurrogate ? truncated.slice(0, -1) : truncated;
}

/**
 * Enumerate every credit card due for payment right now, across every
 * non-demo user, and materialise a task for it — exactly once per
 * `(accountId, dueDate)` key, ever. Returns the number of tasks created.
 *
 * Demo users are excluded before anything is materialised (joined out at the
 * user-enumeration query, not filtered after the fact). Each user's work is
 * isolated in its own try/catch: one user's failure is logged and skipped, not
 * allowed to abort the pass for everyone after them. Within a user, each
 * card's own claim+insert is additionally isolated in its own try/catch, so
 * one card colliding with a stale/forged `sourceKey` cannot suppress that
 * user's other cards in the same pass.
 *
 * `today` mirrors `listCardHolders(db, userId, today?)` / `getCardActivity`'s
 * existing convention: optional, defaulting to the current UTC date, so
 * production behaviour is unchanged while tests can pin a fixed date instead
 * of depending on the wall clock.
 */
export async function materializeCardDueTasks(db: Db, today?: string): Promise<number> {
  const ref = today ?? new Date().toISOString().slice(0, 10);

  const eligibleUsers = await db
    .selectDistinct({ userId: cardDetails.userId })
    .from(cardDetails)
    .innerJoin(users, eq(users.id, cardDetails.userId))
    .where(eq(users.isDemo, false));

  let created = 0;
  for (const { userId } of eligibleUsers) {
    try {
      const holders = await listCardHolders(db, userId, ref);
      for (const holder of holders) {
        // Reminder lead time is an issuer-level setting; due dates stay per card
        // — same default as evaluateCardDueReminders (alerts.ts).
        const remindDays = holder.settings?.remindDays ?? 3;
        for (const card of holder.cards) {
          if (card.dueDate === null || card.amountDuePaise <= 0) continue;
          const remindFrom = new Date(`${card.dueDate}T00:00:00Z`);
          remindFrom.setUTCDate(remindFrom.getUTCDate() - remindDays);
          if (ref < remindFrom.toISOString().slice(0, 10) || ref > card.dueDate) continue;

          const sourceKey = cardDueSourceKey(card.accountId, card.dueDate);

          try {
            // Claim the ledger and insert the task in one transaction: a failed
            // insert (e.g. the partial unique index rejecting a duplicate
            // sourceKey left by a stale/forged row) must roll the claim back
            // too, or that key would be permanently suppressed with no task to
            // show for it.
            const wasCreated = await db.transaction(async (tx) => {
              const claimed = await tx
                .insert(alertLedger)
                .values({ userId, kind: CARD_DUE_TASK_KIND, refKey: sourceKey })
                .onConflictDoNothing()
                .returning({ id: alertLedger.id });
              if (claimed.length === 0) return false; // already materialised (or claimed and rolled back before)

              await tx.insert(userTasks).values({
                userId,
                title: truncateTaskTitle(`Pay ${card.name} bill`),
                notes: `${formatINR(card.amountDuePaise)} due (ledger-derived) for the statement ending ${card.statementEnd ?? ""}.`,
                dueDate: card.dueDate,
                source: "card-due",
                sourceKey,
              });
              return true;
            });
            if (wasCreated) created += 1;
          } catch (err) {
            // Isolated per card, not just per user: one card colliding with a
            // stale/forged sourceKey (AC6) must not suppress this user's other
            // eligible cards in the same pass. The transaction above already
            // rolled itself back; this only stops the failure propagating.
            console.error("materializeCardDueTasks: failed for card", { userId, accountId: card.accountId, err });
          }
        }
      }
    } catch (err) {
      console.error("materializeCardDueTasks: failed for user", { userId, err });
    }
  }
  return created;
}
