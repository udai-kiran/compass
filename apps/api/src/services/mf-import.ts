import { eq, inArray } from "drizzle-orm";
import type { MfImportPreview, MfImportResult } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { holdingEvents, holdings, holdingValuations } from "../db/schema.ts";
import { fetchNavByCode } from "./amfi.ts";
import { resolveScheme } from "./mf-scheme-map.ts";
import { unitsHeld } from "./holdings.ts";

type EventType = "buy" | "sell" | "dividend";

interface ParsedRow {
  line: number;
  date: string;
  folio: string | null;
  fundName: string;
  type: EventType;
  units: number | null;
  currentNav: number | null;
  amountPaise: number;
}

export interface MfParse {
  rows: ParsedRow[];
  skipped: Array<{ line: number; reason: string }>;
}

const HEADER_RE = /name of the fund/i;

/** True only for a real calendar date — rejects e.g. 2026-13-40. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toIsoDate(s: string): string | null {
  const t = s.trim();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t); // 2026-07-06
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t); // 06/07/2026
  let y: number, m: number, d: number;
  if (ymd) [y, m, d] = [+ymd[1]!, +ymd[2]!, +ymd[3]!];
  else if (dmy) [y, m, d] = [+dmy[3]!, +dmy[2]!, +dmy[1]!];
  else return null;
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toType(order: string): EventType | null {
  const o = order.trim().toLowerCase();
  if (o === "buy" || o === "purchase") return "buy";
  if (o === "sell" || o === "redeem" || o === "redemption") return "sell";
  if (o === "dividend" || o === "idcw") return "dividend";
  return null;
}

/**
 * Parses the transaction CSV. Columns by header position, tolerant of the
 * "Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav,
 * Amount (INR)" layout. Bad rows are reported in `skipped`, never dropped
 * silently — a row that won't parse is something the user should see.
 */
export function parseMfCsv(text: string): MfParse {
  const rows: ParsedRow[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    if (HEADER_RE.test(raw)) continue; // header row
    const c = raw.split(",").map((s) => s.trim());
    const line = i + 1;
    if (c.length < 8) {
      skipped.push({ line, reason: `expected 8 columns, got ${c.length}` });
      continue;
    }
    const [dateS, folioS, fundName, orderS, unitsS, , currentNavS, amountS] = c;
    const date = toIsoDate(dateS!);
    const type = toType(orderS!);
    const amount = Number(amountS);
    if (!date) { skipped.push({ line, reason: `unrecognised date "${dateS}"` }); continue; }
    if (!type) { skipped.push({ line, reason: `unrecognised order "${orderS}"` }); continue; }
    if (!fundName) { skipped.push({ line, reason: "missing fund name" }); continue; }
    if (!Number.isFinite(amount) || amount <= 0) { skipped.push({ line, reason: `bad amount "${amountS}"` }); continue; }
    const units = Number(unitsS);
    const currentNav = Number(currentNavS);
    rows.push({
      line,
      date,
      folio: folioS ? folioS : null,
      fundName,
      type,
      units: Number.isFinite(units) && units > 0 ? units : null,
      currentNav: Number.isFinite(currentNav) && currentNav > 0 ? currentNav : null,
      amountPaise: Math.round(amount * 100),
    });
  }
  return { rows, skipped };
}

interface FundGroup {
  fundName: string;
  folio: string | null;
  schemeCode: number | null;
  canonicalName: string | null;
  rows: ParsedRow[];
}

/** Groups parsed rows by fund and resolves each to its AMFI scheme. */
function groupByFund(parse: MfParse): FundGroup[] {
  const map = new Map<string, FundGroup>();
  for (const r of parse.rows) {
    let g = map.get(r.fundName);
    if (!g) {
      const scheme = resolveScheme(r.fundName);
      g = {
        fundName: r.fundName,
        folio: r.folio,
        schemeCode: scheme?.schemeCode ?? null,
        canonicalName: scheme?.canonicalName ?? null,
        rows: [],
      };
      map.set(r.fundName, g);
    }
    g.folio ??= r.folio;
    g.rows.push(r);
  }
  return [...map.values()];
}

export async function previewMfImport(text: string): Promise<MfImportPreview> {
  const parse = parseMfCsv(text);
  const groups = groupByFund(parse);
  const codes = groups.map((g) => g.schemeCode).filter((c): c is number => c !== null);
  const navByCode = codes.length ? await fetchNavByCode().catch(() => null) : null;

  const funds = groups.map((g) => {
    const buys = g.rows.filter((r) => r.type === "buy");
    const sells = g.rows.filter((r) => r.type === "sell");
    return {
      fundName: g.fundName,
      folioNumber: g.folio,
      amfiSchemeCode: g.schemeCode,
      canonicalName: g.canonicalName,
      latestNav: g.schemeCode && navByCode ? (navByCode.get(g.schemeCode)?.nav ?? null) : null,
      buyCount: buys.length,
      sellCount: sells.length,
      netUnits: unitsHeld(g.rows),
      investedPaise: buys.reduce((s, r) => s + r.amountPaise, 0) - sells.reduce((s, r) => s + r.amountPaise, 0),
    };
  });
  return { funds, totalRows: parse.rows.length, skippedRows: parse.skipped };
}

export async function commitMfImport(
  db: Db,
  userId: string,
  text: string,
): Promise<MfImportResult> {
  const groups = groupByFund(parseMfCsv(text));
  const result: MfImportResult = {
    holdingsCreated: 0,
    holdingsMatched: 0,
    eventsInserted: 0,
    eventsDuplicate: 0,
    valuationsSet: 0,
  };

  for (const g of groups) {
    // Match an existing holding by scheme code (when mapped) else by exact name,
    // so a re-import lands on the same holding rather than duplicating it.
    const existing = await db.query.holdings.findMany({
      where: eq(holdings.userId, userId),
    });
    let holding = existing.find((h) =>
      g.schemeCode !== null ? h.amfiSchemeCode === g.schemeCode : h.name === g.fundName,
    );

    if (!holding) {
      const inserted = await db
        .insert(holdings)
        .values({
          userId,
          name: g.fundName,
          assetClass: "mutual_fund",
          amfiSchemeCode: g.schemeCode,
          folioNumber: g.folio,
        })
        .returning();
      holding = inserted[0]!;
      result.holdingsCreated += 1;
    } else {
      result.holdingsMatched += 1;
      // Backfill scheme code / folio if the holding predated the mapping.
      if ((holding.amfiSchemeCode === null && g.schemeCode !== null) ||
          (holding.folioNumber === null && g.folio !== null)) {
        await db
          .update(holdings)
          .set({
            amfiSchemeCode: holding.amfiSchemeCode ?? g.schemeCode,
            folioNumber: holding.folioNumber ?? g.folio,
            updatedAt: new Date(),
          })
          .where(eq(holdings.id, holding.id));
      }
    }

    // Dedupe against events already on this holding: same date+type+units+amount.
    const priorEvents = await db.query.holdingEvents.findMany({
      where: inArray(holdingEvents.holdingId, [holding.id]),
    });
    const seen = new Set(
      priorEvents.map((e) => `${e.date}|${e.type}|${e.units ?? ""}|${e.amountPaise}`),
    );

    for (const r of g.rows) {
      const key = `${r.date}|${r.type}|${r.units ?? ""}|${r.amountPaise}`;
      if (seen.has(key)) { result.eventsDuplicate += 1; continue; }
      seen.add(key);
      await db.insert(holdingEvents).values({
        holdingId: holding.id,
        type: r.type,
        date: r.date,
        amountPaise: r.amountPaise,
        units: r.units,
      });
      result.eventsInserted += 1;
    }

    // Seed a valuation from the CSV's Current Nav so value is meaningful before
    // the first AMFI refresh. Uses the latest-dated row that carries a NAV.
    const withNav = g.rows.filter((r) => r.currentNav !== null);
    const latest = withNav.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (latest && latest.currentNav !== null) {
      const units = unitsHeld(g.rows);
      const valuePaise = Math.max(0, Math.round(units * latest.currentNav * 100));
      await db
        .insert(holdingValuations)
        .values({ holdingId: holding.id, date: latest.date, valuePaise })
        .onConflictDoUpdate({
          target: [holdingValuations.holdingId, holdingValuations.date],
          set: { valuePaise },
        });
      result.valuationsSet += 1;
    }
  }
  return result;
}
