import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMfCsv } from "./mf-import.ts";
import { MF_SCHEME_MAP, resolveScheme } from "./mf-scheme-map.ts";
import { parseAmfiDate, parseNavAll } from "./amfi.ts";
import { unitsHeld } from "./holdings.ts";

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
