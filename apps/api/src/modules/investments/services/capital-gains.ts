import { asc, desc, eq, inArray } from "drizzle-orm";
import type { CapitalGainsSlice, CapitalGainsStatement } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { holdingEvents, holdings } from "../schema.ts";
import { realizeGains } from "./tax-lots.ts";

/** Indian financial year label for a date, e.g. 2025-06-01 → "2025-26". */
export function fyOf(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** [startInclusive, endInclusive] ISO dates for an FY label like "2025-26". */
export function fyRange(fy: string): [string, string] {
  const startYear = Number(fy.slice(0, 4));
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

/** Current FY label from today's date. */
function currentFy(): string {
  return fyOf(new Date().toISOString().slice(0, 10));
}

/**
 * FIFO capital-gains statement for one financial year. Every active or archived
 * holding is realized (a fully-exited fund is often archived, but its gains
 * still belong on the statement), each sell matched to its buys oldest-first,
 * classified short/long-term and grandfathered per tax-lots.ts. Slices
 * are then filtered to the requested FY and rolled up per holding.
 *
 * When `fy` is omitted the latest FY that has any realized slice is used, or the
 * current FY if the user has never sold anything.
 */
/**
 * Bucket a set of slices into the three gain totals plus proceeds/cost.
 *
 * Split out of the statement builder so the tax-exclusion invariant is unit
 * testable without a database: an exempt gain must never reach a taxable
 * total. The `realizeGains` tests cover the same rule one layer down, but a
 * regression *here* — e.g. collapsing the branch back to "short else long" —
 * would leave every one of those passing while the statement over-reported.
 */
export function sumSlices(slices: Array<Pick<CapitalGainsSlice, "term" | "gainPaise" | "proceedsPaise" | "costPaise">>): {
  shortTermGainPaise: number;
  longTermGainPaise: number;
  exemptGainPaise: number;
  proceedsPaise: number;
  costPaise: number;
} {
  let shortTermGainPaise = 0;
  let longTermGainPaise = 0;
  let exemptGainPaise = 0;
  let proceedsPaise = 0;
  let costPaise = 0;
  for (const s of slices) {
    if (s.term === "exempt") exemptGainPaise += s.gainPaise;
    else if (s.term === "short") shortTermGainPaise += s.gainPaise;
    else longTermGainPaise += s.gainPaise;
    proceedsPaise += s.proceedsPaise;
    costPaise += s.costPaise;
  }
  return { shortTermGainPaise, longTermGainPaise, exemptGainPaise, proceedsPaise, costPaise };
}

export async function getCapitalGains(
  db: Db,
  userId: string,
  fy?: string,
  today?: string,
): Promise<CapitalGainsStatement> {
  const ref = today ?? new Date().toISOString().slice(0, 10);
  const rows = await db.query.holdings.findMany({
    where: eq(holdings.userId, userId),
    orderBy: (h, { asc }) => [asc(h.createdAt)],
  });
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db.query.holdingEvents.findMany({
        where: inArray(holdingEvents.holdingId, ids),
        // realizeGains re-sorts with seq/createdAt/id tie-breakers; order stably here too.
        orderBy: [
          desc(holdingEvents.date),
          asc(holdingEvents.seq),
          asc(holdingEvents.createdAt),
          asc(holdingEvents.id),
        ],
      })
    : [];

  // Realize every holding once; keep each slice tagged with its holding. Only
  // posted (date <= today) events realize — a scheduled future redemption must
  // not book gains or open a future FY, mirroring getPortfolio's `posted` cut.
  const allSlices: CapitalGainsSlice[] = [];
  for (const h of rows) {
    const evts = events.filter((e) => e.holdingId === h.id && e.date <= ref);
    if (evts.length === 0) continue;
    const gains = realizeGains(evts, {
      taxClass: h.gainsTaxClass,
      grandfatherNavPaise: h.grandfatherNavPaise,
    });
    for (const s of gains.slices) {
      allSlices.push({
        holdingId: h.id,
        holdingName: h.name,
        assetClass: h.assetClass,
        buyDate: s.buyDate,
        sellDate: s.sellDate,
        units: s.units,
        proceedsPaise: s.proceedsPaise,
        costPaise: s.costPaise,
        gainPaise: s.gainPaise,
        term: s.term,
        heldDays: s.heldDays,
        grandfathered: s.grandfathered,
      });
    }
  }

  const availableFys = [...new Set(allSlices.map((s) => fyOf(s.sellDate)))].sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  const targetFy = fy ?? availableFys[0] ?? currentFy();
  const [start, end] = fyRange(targetFy);
  const inFy = allSlices.filter((s) => s.sellDate >= start && s.sellDate <= end);

  // Group into per-holding rollups, preserving the createdAt order of `rows`.
  const byHolding = new Map<string, CapitalGainsSlice[]>();
  for (const s of inFy) {
    const arr = byHolding.get(s.holdingId) ?? [];
    arr.push(s);
    byHolding.set(s.holdingId, arr);
  }

  const holdingRollups = rows
    .filter((h) => byHolding.has(h.id))
    .map((h) => {
      const slices = byHolding
        .get(h.id)!
        .sort((a, b) => (a.sellDate < b.sellDate ? -1 : a.sellDate > b.sellDate ? 1 : 0));
      return {
        holdingId: h.id,
        holdingName: h.name,
        assetClass: h.assetClass,
        ...sumSlices(slices),
        slices,
      };
    });

  const shortTermGainPaise = holdingRollups.reduce((s, h) => s + h.shortTermGainPaise, 0);
  const longTermGainPaise = holdingRollups.reduce((s, h) => s + h.longTermGainPaise, 0);
  return {
    fy: targetFy,
    availableFys,
    shortTermGainPaise,
    longTermGainPaise,
    exemptGainPaise: holdingRollups.reduce((s, h) => s + h.exemptGainPaise, 0),
    // Taxable only — exempt gains are reported beside this, never inside it.
    totalGainPaise: shortTermGainPaise + longTermGainPaise,
    totalProceedsPaise: holdingRollups.reduce((s, h) => s + h.proceedsPaise, 0),
    totalCostPaise: holdingRollups.reduce((s, h) => s + h.costPaise, 0),
    holdings: holdingRollups,
  };
}
