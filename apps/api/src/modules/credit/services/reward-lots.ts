import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { CreateRewardPointLot, RewardPointLot } from "@compass/shared";
import { CreateRewardPointLotSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { cardDetails, rewardPointLots } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type LotRow = typeof rewardPointLots.$inferSelect;

function toRewardPointLot(row: LotRow): RewardPointLot {
  return {
    id: row.id,
    cardDetailsAccountId: row.cardDetailsAccountId,
    earnedAt: row.earnedAt,
    points: row.points,
    expiresAt: row.expiresAt ?? null,
    isRedeemed: row.isRedeemed,
    description: row.description ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Add a new point lot for a user. Verifies that cardDetailsAccountId belongs
 * to the user. Throws 404 if the card account is not found or doesn't belong
 * to the user.
 *
 * reward_point_lots is additive metadata — it never subtracts from or interacts
 * with reward_entries (the signed point ledger).
 */
export async function addLot(
  db: Db,
  userId: string,
  data: CreateRewardPointLot,
): Promise<RewardPointLot> {
  const parsed = CreateRewardPointLotSchema.parse(data);

  // Verify the card account belongs to this user
  const card = await db.query.cardDetails.findFirst({
    where: and(
      eq(cardDetails.accountId, parsed.cardDetailsAccountId),
      eq(cardDetails.userId, userId),
    ),
    columns: { accountId: true },
  });
  if (!card) throw new HttpError(404, "Card account not found");

  const rows = await db
    .insert(rewardPointLots)
    .values({
      userId,
      cardDetailsAccountId: parsed.cardDetailsAccountId,
      earnedAt: parsed.earnedAt,
      points: parsed.points,
      expiresAt: parsed.expiresAt ?? null,
      description: parsed.description ?? null,
      isRedeemed: false,
    })
    .returning();
  return toRewardPointLot(rows[0]!);
}

/**
 * List lots that are not yet redeemed and expire within the given number of days.
 * Only returns lots with an expiresAt set (null expiresAt = no expiry = not included).
 *
 * @param withinDays - look ahead window in days (default 30)
 * @param now - reference point for "now" (default: new Date())
 */
export async function listExpiringLots(
  db: Db,
  userId: string,
  withinDays = 30,
  now?: Date,
): Promise<RewardPointLot[]> {
  const ref = now ?? new Date();
  const cutoff = new Date(ref.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const rows = await db.query.rewardPointLots.findMany({
    where: and(
      eq(rewardPointLots.userId, userId),
      eq(rewardPointLots.isRedeemed, false),
      isNotNull(rewardPointLots.expiresAt),
      lte(rewardPointLots.expiresAt, cutoff),
    ),
    orderBy: (t, { asc }) => [asc(t.expiresAt)],
  });
  return rows.map(toRewardPointLot);
}

/**
 * Mark a lot as redeemed. Throws 404 if the lot doesn't belong to userId or
 * doesn't exist.
 */
export async function markRedeemed(
  db: Db,
  userId: string,
  lotId: string,
): Promise<RewardPointLot> {
  const rows = await db
    .update(rewardPointLots)
    .set({ isRedeemed: true })
    .where(and(eq(rewardPointLots.id, lotId), eq(rewardPointLots.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Reward point lot not found");
  return toRewardPointLot(rows[0]!);
}
