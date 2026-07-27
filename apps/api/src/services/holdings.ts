import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  AssetClass,
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
import { assetClassHasUnits } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { holdingEvents, holdings, holdingValuations, sips } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { fetchNavByCode } from "./amfi.ts";
import { assertOwnedGoal } from "./ownership.ts";
import { defaultTaxClass } from "./tax-lots.ts";
import { positionCashFlows, xirrBps, type CashFlow } from "./xirr.ts";

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

/**
 * Whether an event must carry a quantity. Only a unitised class needs one, and
 * only for a position-changing event — a dividend is cash in either case. This
 * is the rule the shared `CreateHoldingEventSchema` deliberately can't enforce:
 * the request body has no asset class, only the loaded holding does.
 */
export function eventNeedsUnits(assetClass: AssetClass, type: HoldingEvent["type"]): boolean {
  return type !== "dividend" && assetClassHasUnits(assetClass);
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

/** Message for the "holding is a SIP target for a different/no goal" edit guard — pure, testable without a DB. */
export function sipTargetHoldingBlockedMessage(count: number): string {
  return `Holding is the target of ${count} SIP(s) for this goal — delete or repoint them first`;
}

/** Message for the "holding is a SIP target, and would be archived out from under it" guard. */
export function sipTargetHoldingArchiveBlockedMessage(count: number): string {
  return `Holding is the target of ${count} SIP(s) — delete or repoint them before archiving`;
}

/**
 * Whether an UpdateHolding patch's goalId would break a SIP that targets this
 * holding. Pure/DB-free so it's unit-testable: `undefined` means "not touched"
 * (UpdateHoldingSchema partial-patch semantics — matches `resolveSipDateRange`'s
 * convention), and only an actual value change (not a same-value patch, and not
 * an unrelated field edit) counts as a conflict. Any SIP counts, active or
 * paused — a paused SIP resumes with its existing target binding.
 */
export function holdingGoalEditConflictsWithSip(
  patch: { goalId?: string | null },
  current: { goalId: string | null },
  sipTargetCount: number,
): boolean {
  return sipTargetCount > 0 && patch.goalId !== undefined && patch.goalId !== current.goalId;
}

/**
 * Whether an UpdateHolding patch would archive a holding that a SIP still
 * targets (active or paused). Pure/DB-free, mirroring
 * `holdingGoalEditConflictsWithSip`: an archived folio would drop out of the
 * goal's asset totals while the SIP kept counting it as committed funding.
 * Only a fresh archive (not already archived, not an unarchive) is a conflict.
 */
export function holdingArchiveConflictsWithSip(
  patch: { archived?: boolean },
  current: { archivedAt: Date | string | null },
  sipTargetCount: number,
): boolean {
  return sipTargetCount > 0 && patch.archived === true && current.archivedAt === null;
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

  return db.transaction(async (tx) => {
    // Lock the holding row first — this is what serializes against a
    // concurrent SIP creation/update targeting this holding (sips.ts's
    // ownedHoldingGoal locks the same row before its own checks).
    const currentRows = await tx
      .select()
      .from(holdings)
      .where(and(eq(holdings.id, id), eq(holdings.userId, userId)))
      .for("update");
    const current = currentRows[0];
    if (!current) throw new HttpError(404, "Holding not found");

    const goalChanging = rest.goalId !== undefined && rest.goalId !== current.goalId;
    const archiving = archived === true && current.archivedAt === null;

    // A SIP that targets this holding keeps reducing its goal's funding gap
    // using this holding's value — unmapping/remapping its goal, or archiving
    // it, out from under an active or paused SIP would silently break that
    // invariant. Only queries when the patch could actually matter.
    if (goalChanging || archiving) {
      const sipTargetRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sips)
        .where(eq(sips.targetHoldingId, id));
      const sipTargetCount = sipTargetRows[0]!.count;
      if (goalChanging && holdingGoalEditConflictsWithSip(rest, current, sipTargetCount)) {
        throw new HttpError(409, sipTargetHoldingBlockedMessage(sipTargetCount));
      }
      if (archiving && holdingArchiveConflictsWithSip({ archived }, current, sipTargetCount)) {
        throw new HttpError(409, sipTargetHoldingArchiveBlockedMessage(sipTargetCount));
      }
    }

    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (archived !== undefined) set.archivedAt = archived ? new Date() : null;
    const rows = await tx
      .update(holdings)
      .set(set)
      .where(and(eq(holdings.id, id), eq(holdings.userId, userId)))
      .returning();
    if (rows.length === 0) throw new HttpError(404, "Holding not found");
    return toHolding(rows[0]!);
  });
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
  const nav = input.nav ?? null;
  await db
    .insert(holdingValuations)
    .values({ holdingId, date: input.date, valuePaise: input.valuePaise, nav })
    .onConflictDoUpdate({
      target: [holdingValuations.holdingId, holdingValuations.date],
      set: { valuePaise: input.valuePaise, nav },
    });
}

/**
 * The next intra-day seq given the events already booked that day — one past
 * the highest, treating a null seq as "unsequenced" (-1) so the first event
 * of a day lands at 0. Pure so it's unit-testable without a DB; the query
 * that feeds it lives in `nextSeqForDate`.
 */
export function nextSeq(sameDay: Array<{ seq: number | null }>): number {
  return sameDay.reduce((max, e) => Math.max(max, e.seq ?? -1), -1) + 1;
}

/**
 * Next intra-day seq for a (holding, date) — one past whatever's already
 * booked that day (imported or manual), so a newly appended event sits after
 * the existing FIFO order rather than colliding with it. Shared by `addEvent`
 * and `services/sips.ts`'s `recordSipInstallment`, which also appends a
 * same-day manual event.
 */
export async function nextSeqForDate(db: DbOrTx, holdingId: string, date: string): Promise<number> {
  const sameDay = await db.query.holdingEvents.findMany({
    where: and(eq(holdingEvents.holdingId, holdingId), eq(holdingEvents.date, date)),
  });
  return nextSeq(sameDay);
}

export async function addEvent(
  db: Db,
  userId: string,
  holdingId: string,
  input: CreateHoldingEvent,
): Promise<HoldingEvent> {
  const holding = await ownedHolding(db, userId, holdingId);
  if (eventNeedsUnits(holding.assetClass, input.type) && (input.units ?? null) === null) {
    throw new HttpError(400, "buy and sell events require units");
  }
  // Manual events carry a real intra-day seq too (appended within their date), so
  // the FIFO engine can place them among imported lots — and the user can reorder.
  const nextSeq = await nextSeqForDate(db, holdingId, input.date);
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
  // Parallel to `positions`, indexed the same: each holding's cash-flow series
  // for XIRR (null when not computable), plus whether it's archived — used
  // below to build the active-only aggregate series.
  const positionFlows: Array<{ archived: boolean; flows: CashFlow[] | null }> = [];
  const positions: HoldingPosition[] = rows.map((h) => {
    const evts = events.filter((e) => e.holdingId === h.id);
    // Only posted (date <= today) events and valuations shape the *current*
    // position: a future-dated buy or valuation must not move today's numbers.
    const posted = evts.filter((e) => e.date <= today);
    const { remainingCostPaise, realizedPaise } = costBasis(posted);
    const dividends = posted
      .filter((e) => e.type === "dividend")
      .reduce((s, e) => s + e.amountPaise, 0);
    // valuations are date-desc, so the first two posted ones are today's and the
    // prior day's — their difference is the day's move (naive value delta).
    const hVals = valuations.filter((v) => v.holdingId === h.id && v.date <= today);
    const latest = hVals[0] ?? null;
    const previous = hVals[1] ?? null;
    const value = latest?.valuePaise ?? remainingCostPaise;
    // Prefer the true market move from the stored NAVs — (navToday − navPrev) on
    // the held units, derived from the latest value so a same-day buy can't
    // distort it. Fall back to the raw value delta when a NAV wasn't recorded.
    const dayChangePaise =
      latest && previous
        ? latest.nav !== null && previous.nav !== null && latest.nav > 0
          ? Math.round((latest.valuePaise * (latest.nav - previous.nav)) / latest.nav)
          : latest.valuePaise - previous.valuePaise
        : null;
    // XIRR over the posted events: terminal value is the latest *valuation*
    // (never the display `value`, which falls back to cost basis when there's
    // no valuation and would fabricate a fake ~0% return).
    const units = unitsHeld(posted);
    const flows = positionCashFlows(
      posted,
      latest ? { date: latest.date, valuePaise: latest.valuePaise } : null,
      units,
    );
    positionFlows.push({ archived: h.archivedAt !== null, flows });
    return {
      ...toHolding(h),
      investedPaise: remainingCostPaise,
      currentValuePaise: value,
      dayChangePaise,
      unrealizedPaise: value - remainingCostPaise,
      realizedPaise,
      dividendsPaise: dividends,
      lastValuationDate: latest?.date ?? null,
      xirrBps: flows === null ? null : xirrBps(flows),
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

  // Aggregate XIRR: concatenate active (non-archived) positions' cash-flow
  // series. A position whose series is null (units held with no usable
  // terminal value) is excluded ENTIRELY — flows and all — rather than
  // included at cost, which would understate the aggregate return by
  // pretending an unvalued position contributed zero gain.
  const aggregateFlows: CashFlow[] = positionFlows
    .filter((pf) => !pf.archived && pf.flows !== null)
    .flatMap((pf) => pf.flows!);

  return {
    totalInvestedPaise: active.reduce((s, p) => s + p.investedPaise, 0),
    totalValuePaise: active.reduce((s, p) => s + p.currentValuePaise, 0),
    totalDayChangePaise: active.reduce((s, p) => s + (p.dayChangePaise ?? 0), 0),
    totalDividendsPaise: active.reduce((s, p) => s + p.dividendsPaise, 0),
    totalXirrBps: xirrBps(aggregateFlows),
    positions,
    allocation: [...allocationMap.entries()]
      .map(([assetClass, a]) => ({ assetClass: assetClass as Portfolio["allocation"][number]["assetClass"], ...a }))
      .sort((a, b) => b.valuePaise - a.valuePaise),
    growth,
  };
}

/** Total current portfolio value (latest valuation per active holding, cost basis as fallback). */
export async function portfolioValue(db: Db, userId: string, asOf?: string): Promise<number> {
  // Only the no-asOf path needs the full portfolio (positions, allocation, 24
  // months of growth). Building it for a point-in-time query was pure waste, and
  // the nightly recompute calls this once per user per day.
  if (!asOf) return (await getPortfolio(db, userId)).totalValuePaise;
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
    await setValuation(db, userId, h.id, {
      date: nav.date,
      valuePaise: Math.max(0, valuePaise),
      nav: nav.nav,
    });
    asOf = nav.date;
    refreshed += 1;
  }
  return { refreshed, skipped: held.length - refreshed, asOf };
}
