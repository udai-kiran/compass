import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type {
  CreateHolding,
  CreateHoldingEvent,
  Holding,
  HoldingEvent,
  HoldingPosition,
  Portfolio,
  RefreshNavResult,
  SetValuation,
  UpdateHolding,
} from "@compass/shared";
import type { Db } from "../db/index.ts";
import { holdingEvents, holdings, holdingValuations } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { fetchNavByCode } from "./amfi.ts";
import { assertOwnedGoal } from "./ownership.ts";
import { defaultTaxClass } from "./tax-lots.ts";

type HoldingRow = typeof holdings.$inferSelect;

function toHolding(h: HoldingRow): Holding {
  return {
    id: h.id,
    name: h.name,
    assetClass: h.assetClass,
    notes: h.notes,
    targetPct: h.targetPct,
    amfiSchemeCode: h.amfiSchemeCode,
    folioNumber: h.folioNumber,
    grandfatherNavPaise: h.grandfatherNavPaise,
    gainsTaxClass: h.gainsTaxClass,
    goalId: h.goalId,
    archived: h.archivedAt !== null,
  };
}

/** Net units held: buys add, sells subtract, dividends are cash (no units). */
export function unitsHeld(events: Array<{ type: string; units: number | null }>): number {
  return events.reduce(
    (s, e) => s + (e.units ?? 0) * (e.type === "buy" ? 1 : e.type === "sell" ? -1 : 0),
    0,
  );
}

/**
 * Average-cost accounting over a holding's events, processed in date order.
 * Returns the remaining cost basis (what the still-held units cost), the gain
 * realized on sells, and units held.
 *
 * Raw buy-minus-sell cash flow — the old "invested" — goes negative after a
 * profitable exit and folds realized gain into what should be unrealized.
 * Remaining cost basis does neither: a sell removes the *average cost* of the
 * units sold, and the difference from the proceeds is booked as realized gain.
 */
export function costBasis(
  events: Array<{ type: string; date: string; units: number | null; amountPaise: number }>,
): { remainingCostPaise: number; realizedPaise: number; units: number } {
  const ordered = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let units = 0;
  let cost = 0;
  let realized = 0;
  for (const e of ordered) {
    if (e.type === "buy" && e.units !== null) {
      units += e.units;
      cost += e.amountPaise;
    } else if (e.type === "sell" && e.units !== null) {
      const avg = units > 0 ? cost / units : 0;
      const soldUnits = Math.min(e.units, units); // can't sell more than held
      const costOut = Math.round(avg * soldUnits);
      realized += e.amountPaise - costOut;
      cost = Math.max(0, cost - costOut);
      units = Math.max(0, units - e.units);
    }
    // dividend: cash, no unit or cost change
  }
  return { remainingCostPaise: Math.round(cost), realizedPaise: realized, units };
}

async function ownedHolding(db: Db, userId: string, id: string): Promise<HoldingRow> {
  const h = await db.query.holdings.findFirst({
    where: and(eq(holdings.id, id), eq(holdings.userId, userId)),
  });
  if (!h) throw new HttpError(404, "Holding not found");
  return h;
}

export async function createHolding(db: Db, userId: string, input: CreateHolding): Promise<Holding> {
  const gainsTaxClass = input.gainsTaxClass ?? defaultTaxClass(input.assetClass);
  const rows = await db
    .insert(holdings)
    .values({ ...input, gainsTaxClass, userId })
    .returning();
  return toHolding(rows[0]!);
}

export async function updateHolding(
  db: Db,
  userId: string,
  id: string,
  input: UpdateHolding,
): Promise<Holding> {
  const { archived, ...rest } = input;
  // Earmarking to a goal must point at the caller's own goal.
  await assertOwnedGoal(db, userId, rest.goalId);
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
  // Manual events carry a real intra-day seq too (appended within their date), so
  // the FIFO engine can place them among imported lots — and the user can reorder.
  const sameDay = await db.query.holdingEvents.findMany({
    where: and(eq(holdingEvents.holdingId, holdingId), eq(holdingEvents.date, input.date)),
  });
  const nextSeq = sameDay.reduce((max, e) => Math.max(max, e.seq ?? -1), -1) + 1;
  const rows = await db
    .insert(holdingEvents)
    .values({ ...input, holdingId, seq: nextSeq, source: "manual" })
    .returning();
  const e = rows[0]!;
  return { id: e.id, type: e.type, date: e.date, amountPaise: e.amountPaise, units: e.units, note: e.note };
}

/**
 * Swap an event's intra-day order with its neighbour, letting the user fix
 * same-day chronology (e.g. a manual sale that actually preceded an imported
 * buy). "up" moves it earlier in FIFO (lower seq); no-ops at a day's edge.
 */
export async function moveEvent(
  db: Db,
  userId: string,
  holdingId: string,
  eventId: string,
  direction: "up" | "down",
): Promise<void> {
  await ownedHolding(db, userId, holdingId);
  const ev = await db.query.holdingEvents.findFirst({
    where: and(eq(holdingEvents.id, eventId), eq(holdingEvents.holdingId, holdingId)),
  });
  if (!ev) throw new HttpError(404, "Event not found");
  const sameDay = await db.query.holdingEvents.findMany({
    where: and(eq(holdingEvents.holdingId, holdingId), eq(holdingEvents.date, ev.date)),
    orderBy: [asc(holdingEvents.seq), asc(holdingEvents.createdAt), asc(holdingEvents.id)],
  });
  const idx = sameDay.findIndex((e) => e.id === eventId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sameDay.length) return; // already at the edge
  const a = sameDay[idx]!;
  const b = sameDay[swapIdx]!;
  await db.transaction(async (tx) => {
    await tx.update(holdingEvents).set({ seq: b.seq ?? swapIdx }).where(eq(holdingEvents.id, a.id));
    await tx.update(holdingEvents).set({ seq: a.seq ?? idx }).where(eq(holdingEvents.id, b.id));
  });
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
          // Newest day first; within a day, FIFO order (seq asc) so same-date
          // events display contiguously in the order the tax engine consumes them.
          orderBy: [
            desc(holdingEvents.date),
            asc(holdingEvents.seq),
            asc(holdingEvents.createdAt),
            asc(holdingEvents.id),
          ],
        }),
        db.query.holdingValuations.findMany({
          where: inArray(holdingValuations.holdingId, ids),
          orderBy: [desc(holdingValuations.date)],
        }),
      ])
    : [[], []];

  const today = new Date().toISOString().slice(0, 10);
  const positions: HoldingPosition[] = rows.map((h) => {
    const evts = events.filter((e) => e.holdingId === h.id);
    // Only posted (date <= today) events and valuations shape the *current*
    // position: a future-dated buy or valuation must not move today's numbers.
    const posted = evts.filter((e) => e.date <= today);
    const { remainingCostPaise, realizedPaise } = costBasis(posted);
    const dividends = posted
      .filter((e) => e.type === "dividend")
      .reduce((s, e) => s + e.amountPaise, 0);
    const latest = valuations.find((v) => v.holdingId === h.id && v.date <= today) ?? null;
    const value = latest?.valuePaise ?? remainingCostPaise;
    return {
      ...toHolding(h),
      investedPaise: remainingCostPaise,
      currentValuePaise: value,
      unrealizedPaise: value - remainingCostPaise,
      realizedPaise,
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
      // No valuation yet at this date: fall back to remaining cost basis of
      // whatever was held as of asOf.
      const { remainingCostPaise } = costBasis(
        events.filter((e) => e.holdingId === id && e.date <= asOf),
      );
      total += remainingCostPaise;
    }
  }
  return total;
}

/**
 * Pulls AMFI's latest NAVs and re-values every active holding that has a scheme
 * code: value = unitsHeld × NAV, recorded as a valuation at AMFI's as-of date
 * (reusing setValuation's upsert, so re-running the same day is idempotent).
 * Holdings with no code, or a code AMFI doesn't list, are left untouched.
 */
export async function refreshNav(db: Db, userId: string): Promise<RefreshNavResult> {
  const held = await db.query.holdings.findMany({
    where: and(eq(holdings.userId, userId), isNull(holdings.archivedAt)),
  });
  const mapped = held.filter((h) => h.amfiSchemeCode !== null);
  if (mapped.length === 0) return { refreshed: 0, skipped: held.length, asOf: null };

  const navByCode = await fetchNavByCode();
  const events = await db.query.holdingEvents.findMany({
    where: inArray(holdingEvents.holdingId, mapped.map((h) => h.id)),
  });

  let refreshed = 0;
  let asOf: string | null = null;
  for (const h of mapped) {
    const nav = navByCode.get(h.amfiSchemeCode!);
    if (!nav) continue; // code not in today's feed (new/suspended scheme)
    const units = unitsHeld(events.filter((e) => e.holdingId === h.id));
    const valuePaise = Math.round(units * nav.nav * 100);
    await setValuation(db, userId, h.id, { date: nav.date, valuePaise: Math.max(0, valuePaise) });
    asOf = nav.date;
    refreshed += 1;
  }
  return { refreshed, skipped: held.length - refreshed, asOf };
}
