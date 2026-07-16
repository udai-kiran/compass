import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventDedupeKey,
  groupByPosition,
  parseMfCsv,
  partitionEvents,
  type ParsedRow,
} from "./mf-import.ts";
import { MF_SCHEME_MAP, resolveScheme } from "./mf-scheme-map.ts";
import { parseAmfiDate, parseNavAll } from "./amfi.ts";
import { unitsHeld } from "./holdings.ts";

/** Minimal parsed row for grouping/partition tests. */
function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    line: 1,
    date: "2026-07-06",
    folio: "F1",
    fundName: "Parag Parikh Flexi Cap Growth Direct Plan",
    type: "buy",
    units: 100,
    currentNav: 90,
    amountPaise: 900000,
    ...over,
  };
}

const SAMPLE =
  "Date, Folio Number, Name of the Fund, Order, Units, NAV, Current Nav, Amount (INR)\n" +
  "2026-07-06,11216780,Parag Parikh Flexi Cap Growth Direct Plan,buy,393.813,91.4093,90.9438,35998.2";

test("parses the sample transaction row", () => {
  const { rows, skipped } = parseMfCsv(SAMPLE);
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.date, "2026-07-06");
  assert.equal(r.folio, "11216780");
  assert.equal(r.type, "buy");
  assert.equal(r.units, 393.813);
  assert.equal(r.currentNav, 90.9438);
  // 35998.2 rupees → paise, no float drift
  assert.equal(r.amountPaise, 3599820);
});

test("the header row is ignored, not parsed as data", () => {
  const { rows } = parseMfCsv(SAMPLE);
  assert.equal(rows.length, 1);
});

test("Kuvera Save and Withdraw orders map to purchases and redemptions", () => {
  const csv =
    "2026-07-06,F1,Some Fund,Save,10,50,55,500\n" +
    "2026-07-07,F1,Some Fund,Withdraw,4,55,55,220";
  const { rows, skipped } = parseMfCsv(csv);
  assert.equal(skipped.length, 0);
  assert.deepEqual(rows.map((r) => r.type), ["buy", "sell"]);
  assert.deepEqual(rows.map((r) => r.units), [10, 4]);
  assert.equal(unitsHeld(rows), 6);
});

test("Kuvera SaveSmart bookkeeping rows are ignored without import errors", () => {
  const csv =
    '2023-06-21,"",Kuvera SaveSmart,Withdraw,"","","",464.0\n' +
    '2023-06-08,"",Kuvera SaveSmart,Save,"","","",7999.6';
  const { rows, skipped, ignored } = parseMfCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 0);
  assert.equal(ignored.length, 2);
  assert.match(ignored[0]!.reason, /cash movement/);
});

test("quoted fields with embedded commas keep their columns aligned", () => {
  // A broker export may quote a thousands-separated amount, or a fund name with
  // a comma. Splitting on bare commas would shift every column after it.
  const csv =
    '2026-07-06,11216780,"Some Fund, Direct Growth",buy,"1,234.567",90,"90.9438","1,35,998.20"';
  const { rows, skipped } = parseMfCsv(csv);
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.fundName, "Some Fund, Direct Growth");
  assert.equal(r.units, 1234.567);
  assert.equal(r.currentNav, 90.9438);
  assert.equal(r.amountPaise, 13599820); // ₹1,35,998.20
});

test("a buy or sell without valid units is skipped, not stored unitless", () => {
  // Money with no units would carry an amount but add nothing to the position,
  // so every valuation and NAV refresh would understate the holding.
  const csv =
    "2026-07-06,F1,Some Fund,buy,,90,90,5000\n" + // blank units
    "2026-07-06,F1,Some Fund,sell,0,90,90,5000"; // zero units
  const { rows, skipped } = parseMfCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0]!.reason, /units/);
  assert.match(skipped[1]!.reason, /units/);
});

test("a dividend legitimately carries no units", () => {
  const { rows, skipped } = parseMfCsv("2026-07-06,F1,Some Fund,dividend,,90,90,1500");
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.type, "dividend");
  assert.equal(rows[0]!.units, null);
});

test("bad rows are reported, not silently dropped", () => {
  const csv =
    "2026-13-40,F1,Some Fund,buy,10,5,5,50\n" + // impossible date
    "2026-07-06,F1,Some Fund,teleport,10,5,5,50\n" + // bad order
    "2026-07-06,F1,Some Fund,buy,10,5,5,notmoney"; // bad amount
  const { rows, skipped } = parseMfCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 3);
  assert.match(skipped[0]!.reason, /date/);
  assert.match(skipped[1]!.reason, /order/);
  assert.match(skipped[2]!.reason, /amount/);
});

test("scheme map resolves case- and space-insensitively", () => {
  assert.equal(resolveScheme("Parag Parikh Flexi Cap Growth Direct Plan")?.schemeCode, 122639);
  assert.equal(resolveScheme("  parag parikh flexi cap growth direct plan ")?.schemeCode, 122639);
  assert.equal(resolveScheme("Some Fund Nobody Owns"), null);
});

test("an unmapped-by-design fund resolves to a null code, not to nothing", () => {
  // Kuvera SaveSmart is in the map but has no AMFI scheme — distinct from unknown.
  const kuvera = resolveScheme("Kuvera SaveSmart");
  assert.notEqual(kuvera, null);
  assert.equal(kuvera!.schemeCode, null);
});

test("no CSV name is mapped twice, and every code is 6 digits", () => {
  const seen = new Set<string>();
  for (const e of MF_SCHEME_MAP) {
    const key = e.csvName.trim().toLowerCase();
    assert.ok(!seen.has(key), `${e.csvName} appears twice`);
    seen.add(key);
    if (e.schemeCode !== null) {
      assert.ok(e.schemeCode >= 100000 && e.schemeCode <= 999999, `${e.csvName} code not 6 digits`);
    }
  }
});

test("the same fund in two folios is two positions, not one merged holding", () => {
  // Units are transacted per (fund, folio), so folio is part of identity.
  const parse = {
    rows: [
      row({ folio: "F1", units: 100 }),
      row({ folio: "F2", units: 50 }),
      row({ folio: "F1", units: 25, date: "2026-08-01" }),
    ],
    skipped: [],
  };
  const groups = groupByPosition(parse);
  assert.equal(groups.length, 2);
  const f1 = groups.find((g) => g.folio === "F1")!;
  const f2 = groups.find((g) => g.folio === "F2")!;
  assert.equal(f1.rows.length, 2);
  assert.equal(f2.rows.length, 1);
  // Both resolve to the same scheme — same fund, different folio.
  assert.equal(f1.schemeCode, f2.schemeCode);
});

test("rows of one fund in one folio group into a single position", () => {
  const parse = { rows: [row({ date: "2026-06-05" }), row({ date: "2026-07-06" })], skipped: [] };
  const groups = groupByPosition(parse);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.rows.length, 2);
});

test("re-importing the same rows inserts nothing (idempotent dedupe)", () => {
  const rows = [row({ date: "2026-06-05" }), row({ date: "2026-07-06", units: 50 })];
  const first = partitionEvents([], rows);
  assert.equal(first.toInsert.length, 2);
  assert.equal(first.duplicates, 0);
  // Second run, with the first run's events already present.
  const existing = first.toInsert.map(eventDedupeKey);
  const second = partitionEvents(existing, rows);
  assert.equal(second.toInsert.length, 0);
  assert.equal(second.duplicates, 2);
});

test("two genuinely identical same-day transactions are both kept", () => {
  // Multiset matching: without an existing event to match, an identical repeat
  // is a separate real transaction (e.g. two same-day SIP executions), not a dup.
  const r = row({});
  const first = partitionEvents([], [r, r]);
  assert.equal(first.toInsert.length, 2);
  assert.equal(first.duplicates, 0);
  // But re-importing that file matches both existing events — nothing new.
  const existing = [eventDedupeKey(r), eventDedupeKey(r)];
  const second = partitionEvents(existing, [r, r]);
  assert.equal(second.toInsert.length, 0);
  assert.equal(second.duplicates, 2);
  // A third identical row (existing has only two) inserts just the one extra.
  const third = partitionEvents(existing, [r, r, r]);
  assert.equal(third.toInsert.length, 1);
  assert.equal(third.duplicates, 2);
});

test("a buy and sell of equal units/amount on one day stay distinct events", () => {
  // The dedupe key includes direction, so these must not collapse.
  const buy = row({ type: "buy", units: 10, amountPaise: 1000 });
  const sell = row({ type: "sell", units: 10, amountPaise: 1000 });
  const { toInsert } = partitionEvents([], [buy, sell]);
  assert.equal(toInsert.length, 2);
});

test("units held: buys add, sells subtract, dividends carry no units", () => {
  assert.equal(unitsHeld([{ type: "buy", units: 100 }]), 100);
  assert.equal(unitsHeld([{ type: "buy", units: 100 }, { type: "sell", units: 30 }]), 70);
  assert.equal(unitsHeld([{ type: "buy", units: 100 }, { type: "dividend", units: null }]), 100);
});

test("AMFI date parses to ISO", () => {
  assert.equal(parseAmfiDate("15-Jul-2026"), "2026-07-15");
  assert.equal(parseAmfiDate("01-Jan-2020"), "2020-01-01");
  assert.equal(parseAmfiDate("garbage"), null);
});

test("NAVAll parser keeps scheme rows and drops banners, blanks, and N.A.", () => {
  const feed = [
    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
    "",
    "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
    "122639;INF879O01027;;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;91.1262;15-Jul-2026",
    "999999;INF000000000;;Suspended Fund;N.A.;15-Jul-2026",
  ].join("\n");
  const m = parseNavAll(feed);
  assert.equal(m.size, 1);
  assert.equal(m.get(122639)?.nav, 91.1262);
  assert.equal(m.get(122639)?.date, "2026-07-15");
  assert.equal(m.has(999999), false);
});
