/**
 * 1:1 detail extensions for asset classes that carry scheme-specific fields.
 * Mirrors services/retirement.ts on the accounts side.
 */
import { and, eq } from "drizzle-orm";
import type {
  AssetClass,
  GoldDetails,
  NpsDetails,
  UpsertGoldDetails,
  UpsertNpsDetails,
} from "@compass/shared";
import { UpsertGoldDetailsSchema, UpsertNpsDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { goldDetails, holdings, npsDetails } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type NpsRow = typeof npsDetails.$inferSelect;
type GoldRow = typeof goldDetails.$inferSelect;

function toNps(d: NpsRow): NpsDetails {
  return {
    holdingId: d.holdingId,
    pran: d.pran,
    tier: d.tier,
    equityPct: d.equityPct,
    corporatePct: d.corporatePct,
    govtPct: d.govtPct,
  };
}

function toGold(d: GoldRow): GoldDetails {
  return {
    holdingId: d.holdingId,
    form: d.form,
    purityKarat: d.purityKarat,
    maturityDate: d.maturityDate,
  };
}

async function ownedHoldingOfClass(db: Db, userId: string, holdingId: string, cls: AssetClass) {
  const h = await db.query.holdings.findFirst({
    where: and(eq(holdings.id, holdingId), eq(holdings.userId, userId)),
  });
  if (!h) throw new HttpError(404, "Holding not found");
  if (h.assetClass !== cls) throw new HttpError(400, `Not a ${cls} holding`);
  return h;
}

export async function getNpsDetails(
  db: Db,
  userId: string,
  holdingId: string,
): Promise<NpsDetails | null> {
  await ownedHoldingOfClass(db, userId, holdingId, "nps");
  const row = await db.query.npsDetails.findFirst({
    where: and(eq(npsDetails.holdingId, holdingId), eq(npsDetails.userId, userId)),
  });
  return row ? toNps(row) : null;
}

export async function upsertNpsDetails(
  db: Db,
  userId: string,
  holdingId: string,
  input: UpsertNpsDetails,
): Promise<NpsDetails> {
  await ownedHoldingOfClass(db, userId, holdingId, "nps");
  const parsed = UpsertNpsDetailsSchema.parse(input);
  const rows = await db
    .insert(npsDetails)
    .values({ ...parsed, holdingId, userId })
    .onConflictDoUpdate({
      target: npsDetails.holdingId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toNps(rows[0]!);
}

export async function getGoldDetails(
  db: Db,
  userId: string,
  holdingId: string,
): Promise<GoldDetails | null> {
  await ownedHoldingOfClass(db, userId, holdingId, "gold");
  const row = await db.query.goldDetails.findFirst({
    where: and(eq(goldDetails.holdingId, holdingId), eq(goldDetails.userId, userId)),
  });
  return row ? toGold(row) : null;
}

export async function upsertGoldDetails(
  db: Db,
  userId: string,
  holdingId: string,
  input: UpsertGoldDetails,
): Promise<GoldDetails> {
  await ownedHoldingOfClass(db, userId, holdingId, "gold");
  const parsed = UpsertGoldDetailsSchema.parse(input);
  const rows = await db
    .insert(goldDetails)
    .values({ ...parsed, holdingId, userId })
    .onConflictDoUpdate({
      target: goldDetails.holdingId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return toGold(rows[0]!);
}
