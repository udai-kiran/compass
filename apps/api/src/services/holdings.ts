import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  CreateHolding,
  CreateHoldingEvent,
  Holding,
  HoldingEvent,
  HoldingPosition,
  Portfolio,
  SetValuation,
  UpdateHolding,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { holdingEvents, holdings, holdingValuations } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";

type HoldingRow = typeof holdings.$inferSelect;

function toHolding(h: HoldingRow): Holding {
  return {
    id: h.id,
    name: h.name,
    assetClass: h.assetClass,
    notes: h.notes,
    targetPct: h.targetPct,
    archived: h.archivedAt !== null,
  };
}

async function ownedHolding(db: Db, userId: string, id: string): Promise<HoldingRow> {
  const h = await db.query.holdings.findFirst({
    where: and(eq(holdings.id, id), eq(holdings.userId, userId)),
  });
  if (!h) throw new HttpError(404, "Holding not found");
  return h;
}

export async function createHolding(db: Db, userId: string, input: CreateHolding): Promise<Holding> {
  const rows = await db.insert(holdings).values({ ...input, userId }).returning();
  return toHolding(rows[0]!);
}

export async function updateHolding(
  db: Db,
  userId: string,
  id: string,
  input: UpdateHolding,
): Promise<Holding> {
  const { archived, ...rest } = input;
  const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (archived !== undefined) set.archivedAt = archived ? new Date() : null;
  const rows = await db
    .update(holdings)
    .set(set)
    .where(and(eq(holdings.id, id), eq(holdings.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Holding not found");
  return toHolding(rows[0]!);
}

export async function deleteHolding(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(holdings)
    .where(and(eq(holdings.id, id), eq(holdings.userId, userId)))
    .returning({ id: holdings.id });
  if (rows.length === 0) throw new HttpError(404, "Holding not found");
}

export async function setValuation(
  db: Db,
  userId: string,
  holdingId: string,
  input: SetValuation,
): Promise<void> {
  await ownedHolding(db, userId, holdingId);
  await db
    .insert(holdingValuations)
    .values({ holdingId, date: input.date, valuePaise: input.valuePaise })
    .onConflictDoUpdate({
      target: [holdingValuations.holdingId, holdingValuations.date],
      set: { valuePaise: input.valuePaise },
    });
}

export async function addEvent(
  db: Db,
  userId: string,
  holdingId: string,
  input: CreateHoldingEvent,
): Promise<HoldingEvent> {
  await ownedHolding(db, userId, holdingId);
  const rows = await db
    .insert(holdingEvents)
    .values({ ...input, holdingId })
    .returning();
  const e = rows[0]!;
  return { id: e.id, type: e.type, date: e.date, amountPaise: e.amountPaise, units: e.units, note: e.note };
}

export async function deleteEvent(
  db: Db,
  userId: string,
  holdingId: string,
  eventId: string,
): Promise<void> {
  await ownedHolding(db, userId, holdingId);
  const rows = await db
    .delete(holdingEvents)
    .where(and(eq(holdingEvents.id, eventId), eq(holdingEvents.holdingId, holdingId)))
    .returning({ id: holdingEvents.id });
  if (rows.length === 0) throw new HttpError(404, "Event not found");
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export async function getPortfolio(db: Db, userId: string): Promise<Portfolio> {
  const rows = await db.query.holdings.findMany({
    where: eq(holdings.userId, userId),
    orderBy: (h, { asc }) => [asc(h.createdAt)],
  });
  const ids = rows.map((r) => r.id);
  const [events, valuations] = ids.length
    ? await Promise.all([
        db.query.holdingEvents.findMany({
          where: inArray(holdingEvents.holdingId, ids),
          orderBy: [desc(holdingEvents.date), desc(holdingEvents.createdAt)],
        }),
        db.query.holdingValuations.findMany({
          where: inArray(holdingValuations.holdingId, ids),
          orderBy: [desc(holdingValuations.date)],
        }),
      ])
    : [[], []];

  const positions: HoldingPosition[] = rows.map((h) => {
    const evts = events.filter((e) => e.holdingId === h.id);
    const invested = evts.reduce(
      (s, e) => s + (e.type === "buy" ? e.amountPaise : e.type === "sell" ? -e.amountPaise : 0),
      0,
    );
    const dividends = evts
      .filter((e) => e.type === "dividend")
      .reduce((s, e) => s + e.amountPaise, 0);
    const latest = valuations.find((v) => v.holdingId === h.id) ?? null;
    const value = latest?.valuePaise ?? Math.max(0, invested);
    return {
      ...toHolding(h),
      investedPaise: invested,
      currentValuePaise: value,
      unrealizedPaise: value - Math.max(0, invested),
      dividendsPaise: dividends,
      lastValuationDate: latest?.date ?? null,
      events: evts.slice(0, 20).map((e) => ({
        id: e.id,
        type: e.type,
        date: e.date,
        amountPaise: e.amountPaise,
        units: e.units,
        note: e.note,
      })),
    };
  });

  const active = positions.filter((p) => !p.archived);
  const allocationMap = new Map<string, { valuePaise: number; targetPct: number | null }>();
  for (const p of active) {
    const cur = allocationMap.get(p.assetClass) ?? { valuePaise: 0, targetPct: null };
    cur.valuePaise += p.currentValuePaise;
    if (p.targetPct !== null) cur.targetPct = (cur.targetPct ?? 0) + p.targetPct;
    allocationMap.set(p.assetClass, cur);
  }

  // monthly growth: cumulative invested vs portfolio value (last valuation per holding ≤ month end)
  const monthSet = new Set<string>([
    ...events.map((e) => monthKey(e.date)),
    ...valuations.map((v) => monthKey(v.date)),
  ]);
  const monthsSorted = [...monthSet].sort();
  const growth = monthsSorted.slice(-24).map((month) => {
    const end = `${month}-31`;
    const invested = events
      .filter((e) => e.date <= end)
      .reduce((s, e) => s + (e.type === "buy" ? e.amountPaise : e.type === "sell" ? -e.amountPaise : 0), 0);
    let value = 0;
    for (const id of ids) {
      const latest = valuations.find((v) => v.holdingId === id && v.date <= end);
      if (latest) value += latest.valuePaise;
      else {
        const inv = events
          .filter((e) => e.holdingId === id && e.date <= end)
          .reduce((s, e) => s + (e.type === "buy" ? e.amountPaise : e.type === "sell" ? -e.amountPaise : 0), 0);
        value += Math.max(0, inv);
      }
    }
    return { month, investedPaise: invested, valuePaise: value };
  });

  return {
    totalInvestedPaise: active.reduce((s, p) => s + p.investedPaise, 0),
    totalValuePaise: active.reduce((s, p) => s + p.currentValuePaise, 0),
    totalDividendsPaise: active.reduce((s, p) => s + p.dividendsPaise, 0),
    positions,
    allocation: [...allocationMap.entries()]
      .map(([assetClass, a]) => ({ assetClass: assetClass as Portfolio["allocation"][number]["assetClass"], ...a }))
      .sort((a, b) => b.valuePaise - a.valuePaise),
    growth,
  };
}

/** Total current portfolio value (latest valuation per active holding, cost basis as fallback). */
export async function portfolioValue(db: Db, userId: string, asOf?: string): Promise<number> {
  const p = await getPortfolio(db, userId);
  if (!asOf) return p.totalValuePaise;
  // point-in-time value for net-worth backfill
  const rows = await db.query.holdings.findMany({ where: eq(holdings.userId, userId) });
  const ids = rows.filter((h) => h.archivedAt === null).map((h) => h.id);
  if (ids.length === 0) return 0;
  const [events, valuations] = await Promise.all([
    db.query.holdingEvents.findMany({ where: inArray(holdingEvents.holdingId, ids) }),
    db.query.holdingValuations.findMany({
      where: inArray(holdingValuations.holdingId, ids),
      orderBy: [desc(holdingValuations.date)],
    }),
  ]);
  let total = 0;
  for (const id of ids) {
    const latest = valuations.find((v) => v.holdingId === id && v.date <= asOf);
    if (latest) total += latest.valuePaise;
    else {
      const inv = events
        .filter((e) => e.holdingId === id && e.date <= asOf)
        .reduce((s, e) => s + (e.type === "buy" ? e.amountPaise : e.type === "sell" ? -e.amountPaise : 0), 0);
      total += Math.max(0, inv);
    }
  }
  return total;
}
