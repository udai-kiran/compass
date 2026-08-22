import { and, eq, gte } from "drizzle-orm";
import type { CardOffer, CreateCardOffer } from "@compass/shared";
import { CreateCardOfferSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { cardOffers } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type OfferRow = typeof cardOffers.$inferSelect;

function toCardOffer(row: OfferRow): CardOffer {
  return {
    id: row.id,
    platform: row.platform,
    issuer: row.issuer,
    cardProductName: row.cardProductName ?? null,
    discountKind: row.discountKind,
    discountRateBps: row.discountRateBps,
    maxCapPaise: row.maxCapPaise ?? null,
    minSpendPaise: row.minSpendPaise ?? null,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    stackable: row.stackable,
    isReviewed: row.isReviewed,
    sourceEmailId: row.sourceEmailId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** List all offers for the user. Pass `includeExpired: false` to only return non-expired ones. */
export async function listOffers(
  db: Db,
  userId: string,
  opts?: { includeExpired?: boolean },
): Promise<CardOffer[]> {
  const includeExpired = opts?.includeExpired ?? true;
  const conditions = [eq(cardOffers.userId, userId)];
  if (!includeExpired) {
    conditions.push(gte(cardOffers.validUntil, new Date()));
  }
  const rows = await db.query.cardOffers.findMany({
    where: and(...conditions),
    orderBy: (t, { desc }) => [desc(t.validUntil)],
  });
  return rows.map(toCardOffer);
}

/** Create a new offer for the user. isReviewed is always false on creation. */
export async function createOffer(
  db: Db,
  userId: string,
  data: CreateCardOffer,
): Promise<CardOffer> {
  // Parse to obtain output type (Date objects for validFrom/validUntil).
  const parsed = CreateCardOfferSchema.parse(data);
  const rows = await db
    .insert(cardOffers)
    .values({
      userId,
      platform: parsed.platform,
      issuer: parsed.issuer,
      cardProductName: parsed.cardProductName ?? null,
      discountKind: parsed.discountKind,
      discountRateBps: parsed.discountRateBps,
      maxCapPaise: parsed.maxCapPaise ?? null,
      minSpendPaise: parsed.minSpendPaise ?? null,
      validFrom: parsed.validFrom,
      validUntil: parsed.validUntil,
      stackable: parsed.stackable ?? false,
      isReviewed: false,
      raw: parsed.raw ?? null,
    })
    .returning();
  return toCardOffer(rows[0]!);
}

/** Set isReviewed=true for the given offer. 404 if the offer doesn't belong to userId. */
export async function reviewOffer(
  db: Db,
  userId: string,
  offerId: string,
): Promise<CardOffer> {
  const rows = await db
    .update(cardOffers)
    .set({ isReviewed: true, updatedAt: new Date() })
    .where(and(eq(cardOffers.id, offerId), eq(cardOffers.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Card offer not found");
  return toCardOffer(rows[0]!);
}

/** Delete an offer. 404 if the offer doesn't belong to userId. */
export async function deleteOffer(
  db: Db,
  userId: string,
  offerId: string,
): Promise<void> {
  const rows = await db
    .delete(cardOffers)
    .where(and(eq(cardOffers.id, offerId), eq(cardOffers.userId, userId)))
    .returning({ id: cardOffers.id });
  if (rows.length === 0) throw new HttpError(404, "Card offer not found");
}

/** Returns only offers that are reviewed AND not yet expired (validUntil >= now). */
export async function getActiveOffers(db: Db, userId: string): Promise<CardOffer[]> {
  const now = new Date();
  const rows = await db.query.cardOffers.findMany({
    where: and(
      eq(cardOffers.userId, userId),
      eq(cardOffers.isReviewed, true),
      gte(cardOffers.validUntil, now),
    ),
    orderBy: (t, { desc }) => [desc(t.validUntil)],
  });
  return rows.map(toCardOffer);
}
