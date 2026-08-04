import { and, desc, eq } from "drizzle-orm";
import type { CreateRewardEntry, RewardEntry } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { cardDetails, rewardEntries } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { ownedCardAccount } from "./cards.ts";

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

// ---------- reward earn-rate interface (tasks/008-migrate-credit — new, not a relocation) ----------

/**
 * Looks up a credit card's configured flat reward-earn rate (points per ₹100
 * spent). Reuses `ownedCardAccount`'s ownership+credit-card checks (404 if the
 * account isn't the user's, 400 if it isn't a credit card), then reads
 * `card_details.earn_rate_per_100` for that account. Returns `null` — not `0`
 * — when no `card_details` row exists at all, distinguishing "no card details
 * configured yet" from a genuinely-stored rate of `0`.
 */
export async function getCardEarnRate(db: Db, userId: string, accountId: string): Promise<number | null> {
  await ownedCardAccount(db, userId, accountId);
  const row = await db.query.cardDetails.findFirst({
    where: and(eq(cardDetails.accountId, accountId), eq(cardDetails.userId, userId)),
    columns: { earnRatePer100: true },
  });
  return row ? row.earnRatePer100 : null;
}

/**
 * Pure calculator: reward points earned on a spend, at a flat per-₹100 rate —
 * `points = floor(spendPaise * earnRatePer100 / 10_000)` (₹100 = 10,000
 * paise). Operates only on already-validated inputs; both parameters are
 * caller-supplied non-negative magnitudes, never the signed ledger
 * `transactions.amountPaise` convention (which stores spend as negative) — the
 * `spendPaise` name signals that a caller must pass the non-negative
 * magnitude explicitly, not `Math.abs()` it here.
 *
 * Rejects (throws `HttpError(400, ...)`, never silently coerces):
 * - a negative `spendPaise` or `earnRatePer100`
 * - either input, or their product, failing `Number.isSafeInteger` — checked
 *   on the product BEFORE dividing by 10,000, since precision loss happens at
 *   the multiplication step, not the division. `Number.isSafeInteger` also
 *   subsumes "is an integer": a non-integer input is never a safe integer, so
 *   one check covers both the non-integer-input and the safe-integer-bounds
 *   rejection rules.
 *
 * Simplified base-rate estimate only: this does not model category-specific
 * rates, spend caps, milestone bonuses, point valuation, or expiry — a single
 * flat multiplier against the card's configured base rate, nothing more.
 */
export function earnedRewardPoints(spendPaise: number, earnRatePer100: number): number {
  if (spendPaise < 0) throw new HttpError(400, "spendPaise must not be negative");
  if (earnRatePer100 < 0) throw new HttpError(400, "earnRatePer100 must not be negative");
  if (!Number.isSafeInteger(spendPaise)) {
    throw new HttpError(400, "spendPaise must be a safe integer");
  }
  if (!Number.isSafeInteger(earnRatePer100)) {
    throw new HttpError(400, "earnRatePer100 must be a safe integer");
  }
  const product = spendPaise * earnRatePer100;
  if (!Number.isSafeInteger(product)) {
    throw new HttpError(400, "spendPaise * earnRatePer100 exceeded a safe integer — refusing to lose precision");
  }
  return Math.floor(product / 10_000);
}
