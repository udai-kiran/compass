/**
 * Predictive cart draft generation (task 11.2).
 *
 * The functional core is deliberately separate from the database queries: it
 * only proposes a draft and never places an order or changes the pantry.
 */

import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import type { CartDraftWithItems, NormalizedUnit } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import {
  cartDraftItems,
  cartDrafts,
  catalogItems,
  habitProfiles,
  pantryItems,
  priceObservations,
} from "../schema.ts";
import { MS_PER_DAY } from "./consumption-rate.ts";
import { STALE_DAYS } from "./price-observations.ts";

export const DEPLETION_WINDOW_DAYS = 7;
export const PRICE_SPIKE_PCT = 120;

type PantryForDraft = Pick<
  typeof pantryItems.$inferSelect,
  "quantityBase" | "unit" | "expectedDepletionAt"
>;
type HabitForDraft = Pick<typeof habitProfiles.$inferSelect, "consumptionBasePerMonth" | "unit">;

/** True when a learned item is empty/unknown or due to run out within seven days. */
export function shouldReplenish(
  pantryItem: PantryForDraft,
  habitProfile: HabitForDraft | null,
  now = new Date(),
): boolean {
  if (
    habitProfile?.consumptionBasePerMonth === null ||
    habitProfile?.consumptionBasePerMonth === undefined ||
    habitProfile.consumptionBasePerMonth === 0 ||
    habitProfile.unit === null ||
    habitProfile.unit === undefined
  ) {
    return false;
  }
  if (pantryItem.quantityBase === null || pantryItem.quantityBase === 0) return true;
  if (pantryItem.expectedDepletionAt === null) return false;
  return pantryItem.expectedDepletionAt.getTime() <= now.getTime() + DEPLETION_WINDOW_DAYS * MS_PER_DAY;
}

/** Propose exactly one (integer) 30-day month of learned consumption. */
export function suggestQuantity(habitProfile: HabitForDraft): {
  quantityBase: number;
  unit: NormalizedUnit;
} {
  if (habitProfile.consumptionBasePerMonth === null || habitProfile.unit === null) {
    throw new Error("A consumption rate and unit are required to suggest a quantity");
  }
  return {
    quantityBase: Math.floor(habitProfile.consumptionBasePerMonth),
    unit: habitProfile.unit as NormalizedUnit,
  };
}

/** Price must be strictly greater than 120% of the 30-day integer average. */
export function isPriceSpiked(currentPricePaise: number | null, avgPricePaise: number | null): boolean {
  return currentPricePaise !== null && avgPricePaise !== null && currentPricePaise * 100 > avgPricePaise * PRICE_SPIKE_PCT;
}

/** Sum display total without accidentally charging for removed or unpriced proposals. */
export function calculateDraftTotalPaise(
  items: Array<{ suggestedPricePaise: number | null; isRemoved: boolean }>,
): number {
  return items.reduce((total, item) => total + (item.isRemoved ? 0 : (item.suggestedPricePaise ?? 0)), 0);
}

/** Teaching signal for a removed proposal, never below the schema's zero floor. */
export function decrementObservationCount(observationCount: number): number {
  return Math.max(0, observationCount - 1);
}

function latestPriceCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_DAYS * MS_PER_DAY);
}

function averagePriceCutoff(now = new Date()): Date {
  return new Date(now.getTime() - 30 * MS_PER_DAY);
}

/** Get an item's most recently observed non-stale price, optionally at one source. */
async function latestPrice(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
  sourceId?: string,
  now = new Date(),
) {
  const conditions = [
    eq(priceObservations.userId, userId),
    eq(priceObservations.catalogItemId, catalogItemId),
    gte(priceObservations.observedAt, latestPriceCutoff(now)),
  ];
  if (sourceId) conditions.push(eq(priceObservations.priceSourceId, sourceId));
  return db.query.priceObservations.findFirst({
    where: and(...conditions),
    orderBy: [desc(priceObservations.observedAt)],
  });
}

export interface PriceSpikeResult {
  isSpiked: boolean;
  currentPricePaise: number | null;
  avgPricePaise: number | null;
  deltaPaise: number | null;
}

/** Compare the latest non-stale source unit price to its 30-day unit-price history. */
export async function detectPriceSpike(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
  sourceId: string,
): Promise<PriceSpikeResult> {
  const now = new Date();
  const current = await latestPrice(db, userId, catalogItemId, sourceId, now);
  if (!current || !current.packQuantityBase || current.packQuantityBase <= 0 || !current.unit) {
    return { isSpiked: false, currentPricePaise: null, avgPricePaise: null, deltaPaise: null };
  }

  const history = await db
    .select({
      pricePaise: priceObservations.pricePaise,
      packQuantityBase: priceObservations.packQuantityBase,
      unit: priceObservations.unit,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.userId, userId),
        eq(priceObservations.catalogItemId, catalogItemId),
        eq(priceObservations.priceSourceId, sourceId),
        gte(priceObservations.observedAt, averagePriceCutoff(now)),
      ),
    );
  const currentPricePaise = unitPrice(current.pricePaise, current.packQuantityBase);
  const comparable = history.filter(
    (row) => row.packQuantityBase !== null && row.packQuantityBase > 0 && row.unit === current.unit,
  );
  if (comparable.length === 0) {
    return { isSpiked: false, currentPricePaise, avgPricePaise: null, deltaPaise: null };
  }
  const avgPricePaise = Math.floor(
    comparable.reduce((sum, row) => sum + unitPrice(row.pricePaise, row.packQuantityBase!), 0) /
      comparable.length,
  );
  return {
    isSpiked: isPriceSpiked(currentPricePaise, avgPricePaise),
    currentPricePaise,
    avgPricePaise,
    deltaPaise: currentPricePaise - avgPricePaise,
  };
}

export interface Substitution {
  substituteCatalogItemId: string;
  pricePaise: number;
  sourceId: string;
  /** Difference in the displayed pack prices; may be negative for a larger substitute pack. */
  deltaPaise: number;
}

function unitPrice(pricePaise: number, packQuantityBase: number): number {
  return Math.floor((pricePaise * 1000) / packQuantityBase);
}

/** Find the lowest current same-unit alternative only when it is cheaper per base unit. */
export async function findSubstitution(
  db: DbOrTx,
  userId: string,
  catalogItemId: string,
  unit: NormalizedUnit,
): Promise<Substitution | null> {
  const now = new Date();
  const usual = await latestPrice(db, userId, catalogItemId, undefined, now);
  if (!usual || usual.unit !== unit || !usual.packQuantityBase || usual.packQuantityBase <= 0) return null;
  const usualUnitPrice = unitPrice(usual.pricePaise, usual.packQuantityBase);
  const candidates = await db.query.catalogItems.findMany({
    where: and(eq(catalogItems.userId, userId), eq(catalogItems.unit, unit), ne(catalogItems.id, catalogItemId)),
    columns: { id: true },
  });

  let best: (Substitution & { unitPrice: number }) | null = null;
  for (const candidate of candidates) {
    const price = await latestPrice(db, userId, candidate.id, undefined, now);
    if (!price || price.unit !== unit || !price.packQuantityBase || price.packQuantityBase <= 0) continue;
    const candidateUnitPrice = unitPrice(price.pricePaise, price.packQuantityBase);
    if (candidateUnitPrice >= usualUnitPrice || (best && candidateUnitPrice >= best.unitPrice)) continue;
    best = {
      substituteCatalogItemId: candidate.id,
      pricePaise: price.pricePaise,
      sourceId: price.priceSourceId,
      deltaPaise: usualUnitPrice - candidateUnitPrice,
      unitPrice: candidateUnitPrice,
    };
  }
  if (!best) return null;
  const { unitPrice: _unitPrice, ...substitution } = best;
  return substitution;
}

function utcDayBounds(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
  };
}

export async function getDraftWithItems(
  db: DbOrTx,
  draftId: string,
): Promise<CartDraftWithItems | null> {
  const draft = await db.query.cartDrafts.findFirst({ where: eq(cartDrafts.id, draftId) });
  if (!draft) return null;
  const items = await db.query.cartDraftItems.findMany({
    where: eq(cartDraftItems.cartDraftId, draftId),
    orderBy: [cartDraftItems.createdAt],
  });
  return {
    ...draft,
    priceSourceId: draft.priceSourceId ?? null,
    items: items.map((item) => ({
      ...item,
      catalogItemId: item.catalogItemId ?? null,
      quantityBase: item.quantityBase ?? null,
      unit: (item.unit as NormalizedUnit | null) ?? null,
      suggestedPricePaise: item.suggestedPricePaise ?? null,
      suggestedSourceId: item.suggestedSourceId ?? null,
      substitutionForItemId: item.substitutionForItemId ?? null,
      priceDeltaPaise: item.priceDeltaPaise ?? null,
    })),
  };
}

/** Create or return today's advisory draft. The transaction makes the normal path idempotent. */
export async function generateDraft(db: Db, userId: string): Promise<CartDraftWithItems> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const { start, end } = utcDayBounds(now);
    const existing = await tx.query.cartDrafts.findFirst({
      where: and(
        eq(cartDrafts.userId, userId),
        eq(cartDrafts.status, "draft"),
        gte(cartDrafts.generatedAt, start),
        lt(cartDrafts.generatedAt, end),
      ),
      orderBy: [desc(cartDrafts.generatedAt)],
    });
    if (existing) return (await getDraftWithItems(tx, existing.id))!;

    const pantry = await tx.query.pantryItems.findMany({ where: eq(pantryItems.userId, userId) });
    const proposed: Array<Omit<typeof cartDraftItems.$inferInsert, "cartDraftId">> = [];
    for (const pantryItem of pantry) {
      const habit = await tx.query.habitProfiles.findFirst({
        where: and(eq(habitProfiles.userId, userId), eq(habitProfiles.catalogItemId, pantryItem.catalogItemId)),
      });
      if (!shouldReplenish(pantryItem, habit ?? null, now) || !habit) continue;
      const quantity = suggestQuantity(habit);
      const latest = await latestPrice(tx, userId, pantryItem.catalogItemId, undefined, now);
      let catalogItemId = pantryItem.catalogItemId;
      let suggestedPricePaise = latest?.pricePaise ?? null;
      let suggestedSourceId = latest?.priceSourceId ?? null;
      let substitutionForItemId: string | null = null;
      let priceDeltaPaise: number | null = null;
      let reason = "Expected to run out within 7 days";

      if (latest && habit.unit) {
        const spike = await detectPriceSpike(tx, userId, pantryItem.catalogItemId, latest.priceSourceId);
        if (spike.isSpiked) {
          const substitution = await findSubstitution(tx, userId, pantryItem.catalogItemId, habit.unit as NormalizedUnit);
          if (substitution) {
            catalogItemId = substitution.substituteCatalogItemId;
            suggestedPricePaise = substitution.pricePaise;
            suggestedSourceId = substitution.sourceId;
            substitutionForItemId = pantryItem.catalogItemId;
            priceDeltaPaise = substitution.deltaPaise;
            reason = "Usual price is over 120% of its 30-day average; cheaper same-unit substitute suggested";
          }
        }
      }
      proposed.push({
        catalogItemId,
        quantityBase: quantity.quantityBase,
        unit: quantity.unit,
        reason,
        suggestedPricePaise,
        suggestedSourceId,
        substitutionForItemId,
        priceDeltaPaise,
      });
    }

    const totalPaise = calculateDraftTotalPaise(proposed.map((item) => ({
      suggestedPricePaise: item.suggestedPricePaise ?? null,
      isRemoved: false,
    })));
    const [draft] = await tx.insert(cartDrafts).values({ userId, totalPaise, generatedAt: now }).returning();
    if (proposed.length > 0) {
      await tx.insert(cartDraftItems).values(proposed.map((item) => ({ ...item, cartDraftId: draft!.id })));
    }
    return (await getDraftWithItems(tx, draft!.id))!;
  });
}
