import { test } from "node:test";
import assert from "node:assert/strict";
import { positionCashFlows, xirrBps } from "./xirr.ts";

// ---------- xirrBps: known-answer accuracy ----------

test("single outflow/inflow exactly one year apart (2024, a leap year) computes ~10%", () => {
  // 2024-01-01 to 2024-12-31 is exactly 365 days (Jan 1 -> Dec 31 spans 365
  // days even though 2024 is a leap year — the leap day falls inside the
  // span, not outside it, so the day count is unaffected). t = 365/365 = 1.0
  // year exactly, so the annualised rate solves exactly to the one-period
  // return: 110,000/100,000 - 1 = 10.00% = 1000 bps, no rounding slop from a
  // fractional year.
  const flows = [
    { date: "2024-01-01", amountPaise: -10_000_000 }, // -₹1,00,000
    { date: "2024-12-31", amountPaise: 11_000_000 }, //  ₹1,10,000
  ];
  const result = xirrBps(flows);
  assert.notEqual(result, null);
  assert.ok(Math.abs(result! - 1000) <= 2, `expected ~1000 bps, got ${result}`);
});

test("doubling in ~1 year annualises to ~10000 bps (100%)", () => {
  const flows = [
    { date: "2024-01-01", amountPaise: -10_000_000 }, // -₹1,00,000
    { date: "2024-12-31", amountPaise: 20_000_000 }, //  ₹2,00,000 (exact double, 365-day span)
  ];
  const result = xirrBps(flows);
  assert.notEqual(result, null);
  assert.ok(Math.abs(result! - 10000) <= 5, `expected ~10000 bps, got ${result}`);
});

test("a loss (terminal value below cost) yields a negative rate", () => {
  const flows = [
    { date: "2024-01-01", amountPaise: -10_000_000 }, // -₹1,00,000
    { date: "2024-12-31", amountPaise: 8_000_000 }, //  ₹80,000 — a 20% loss over the year
  ];
  const result = xirrBps(flows);
  assert.notEqual(result, null);
  assert.ok(result! < 0, `expected a negative rate, got ${result}`);
});

test("a monthly SIP series with a terminal value converges to a plausible positive rate", () => {
  // 12 monthly buys of ₹10,000 each, terminal value ₹1,35,000 (invested
  // ₹1,20,000) roughly a year after the first buy — a healthy but not
  // absurd equity-fund return. Assert a plausible range rather than an
  // exact figure, since there's no closed form for an irregular series.
  const flows = [];
  for (let m = 1; m <= 12; m++) {
    const month = String(m).padStart(2, "0");
    flows.push({ date: `2024-${month}-01`, amountPaise: -1_000_000 }); // -₹10,000
  }
  flows.push({ date: "2025-01-01", amountPaise: 13_500_000 }); // ₹1,35,000 terminal
  const result = xirrBps(flows);
  assert.notEqual(result, null);
  assert.ok(result! > 500 && result! < 5000, `expected a plausible positive rate, got ${result}`);
});

test("order independence: shuffled flows produce an identical result", () => {
  const flows = [
    { date: "2024-01-01", amountPaise: -5_000_000 },
    { date: "2024-04-01", amountPaise: -3_000_000 },
    { date: "2024-08-01", amountPaise: -2_000_000 },
    { date: "2024-12-31", amountPaise: 12_000_000 },
  ];
  const shuffled = [flows[3]!, flows[0]!, flows[2]!, flows[1]!];
  const a = xirrBps(flows);
  const b = xirrBps(shuffled);
  assert.notEqual(a, null);
  assert.equal(a, b);
});

// ---------- xirrBps: null cases ----------

test("null: empty flows", () => {
  assert.equal(xirrBps([]), null);
});

test("null: a single flow", () => {
  assert.equal(xirrBps([{ date: "2024-01-01", amountPaise: -10_000_000 }]), null);
});

test("null: all-negative flows (no inflow)", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -10_000_000 },
      { date: "2024-06-01", amountPaise: -5_000_000 },
    ]),
    null,
  );
});

test("null: all-positive flows (no outflow)", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: 10_000_000 },
      { date: "2024-06-01", amountPaise: 5_000_000 },
    ]),
    null,
  );
});

test("null: span under 30 days", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -10_000_000 },
      { date: "2024-01-15", amountPaise: 10_500_000 },
    ]),
    null,
  );
});

// ---------- positionCashFlows ----------

test("positionCashFlows: buy is a negative outflow", () => {
  const flows = positionCashFlows(
    [{ type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 }],
    { date: "2024-06-01", valuePaise: 11_000_000 },
    100,
  );
  assert.notEqual(flows, null);
  assert.equal(flows![0]!.amountPaise, -10_000_000);
});

test("positionCashFlows: a dividend is a positive inflow", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "dividend", date: "2024-06-01", amountPaise: 50_000, units: null },
    ],
    { date: "2024-12-01", valuePaise: 11_000_000 },
    100,
  );
  assert.notEqual(flows, null);
  const dividendFlow = flows!.find((f) => f.amountPaise === 50_000);
  assert.notEqual(dividendFlow, undefined);
});

test("positionCashFlows: units still held with no terminal valuation returns null", () => {
  const flows = positionCashFlows(
    [{ type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 }],
    null,
    100,
  );
  assert.equal(flows, null);
});

test("positionCashFlows: a fully exited position (units ~0) needs no terminal flow, and is solvable", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "sell", date: "2024-12-31", amountPaise: 11_000_000, units: 100 },
    ],
    null,
    0,
  );
  assert.notEqual(flows, null);
  // No terminal flow appended — the series length equals the event count.
  assert.equal(flows!.length, 2);
  const result = xirrBps(flows!);
  assert.notEqual(result, null);
});

test("positionCashFlows: empty events returns null", () => {
  assert.equal(positionCashFlows([], null, 0), null);
});

test("positionCashFlows: a valuation older than the most recent buy returns null", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "buy", date: "2024-12-01", amountPaise: 10_000_000, units: 100 },
    ],
    { date: "2024-06-01", valuePaise: 21_000_000 },
    200,
  );
  assert.equal(flows, null);
});

test("positionCashFlows: a valuation on the same date as the most recent buy is accepted (boundary)", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "buy", date: "2024-12-01", amountPaise: 10_000_000, units: 100 },
    ],
    { date: "2024-12-01", valuePaise: 21_000_000 },
    200,
  );
  assert.notEqual(flows, null);
});

test("positionCashFlows: a valuation after the most recent buy is accepted and includes the terminal flow", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "buy", date: "2024-12-01", amountPaise: 10_000_000, units: 100 },
    ],
    { date: "2024-12-15", valuePaise: 21_000_000 },
    200,
  );
  assert.notEqual(flows, null);
  const terminalFlow = flows!.find((f) => f.date === "2024-12-15");
  assert.notEqual(terminalFlow, undefined);
  assert.equal(terminalFlow!.amountPaise, 21_000_000);
});

test("positionCashFlows: a dividend after the terminal valuation does not invalidate it", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "dividend", date: "2024-12-01", amountPaise: 50_000, units: null },
    ],
    { date: "2024-06-01", valuePaise: 11_000_000 },
    100,
  );
  assert.notEqual(flows, null);
});

// ---------- xirrBps: non-finite inputs (FIX 2) ----------

test("xirrBps: a malformed date string returns null, not a fabricated ~-9999 bps", () => {
  // Pre-fix, Date.parse("not-a-dateT00:00:00Z") is NaN, which propagates
  // through npv() as NaN and defeats every comparison in bisect(), causing
  // hi/lo to collapse onto the bisection bracket's lower bound (-0.9999)
  // and return ~-9999 bps instead of null.
  assert.equal(
    xirrBps([
      { date: "not-a-date", amountPaise: -10_000_000 },
      { date: "2024-12-31", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

test("xirrBps: an out-of-range date string (2024-13-45) returns null, not a fabricated ~-9999 bps", () => {
  assert.equal(
    xirrBps([
      { date: "2024-13-45", amountPaise: -10_000_000 },
      { date: "2024-12-31", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

test("xirrBps: a NaN amountPaise returns null", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: NaN },
      { date: "2024-12-31", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

// ---------- xirrBps: non-finite intermediates (FIX A) ----------

test("xirrBps: an Infinity amountPaise returns null", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -10_000_000 },
      { date: "2024-12-31", amountPaise: Infinity },
    ]),
    null,
  );
});

test("xirrBps: a -Infinity amountPaise returns null", () => {
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -Infinity },
      { date: "2024-12-31", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

test("xirrBps: finite amounts whose absolute magnitudes SUM to Infinity return null", () => {
  // Both amounts are individually finite (Number.MAX_VALUE), and opposite in
  // sign so the all-one-sign guard does not short-circuit first — but
  // Math.abs(-MAX_VALUE) + Math.abs(MAX_VALUE) overflows to Infinity, which
  // would make `tolerance` Infinity. Pre-fix, this made the very first
  // `Math.abs(f) < tolerance` check in the Newton loop pass immediately,
  // "converging" at the initial guess r=0.1 and returning a fabricated 1000
  // bps despite the series never actually having been solved.
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -Number.MAX_VALUE },
      { date: "2024-12-31", amountPaise: Number.MAX_VALUE },
    ]),
    null,
  );
});

test("xirrBps: the calendar-invalid date 2024-02-30 returns null", () => {
  // STEP 0 finding: Date.parse("2024-02-30T00:00:00Z") does NOT return NaN in
  // Node 24 — it silently rolls over to 2024-03-01T00:00:00.000Z. The strict
  // round-trip validation in parseStrictUtcDate catches this and rejects it.
  assert.equal(
    xirrBps([
      { date: "2024-02-30", amountPaise: -10_000_000 },
      { date: "2025-02-28", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

test("xirrBps: 2023-02-29 (Feb 29 in a non-leap year) returns null", () => {
  // STEP 0 finding: Date.parse("2023-02-29T00:00:00Z") silently normalizes to
  // 2023-03-01T00:00:00.000Z (2023 is not a leap year) instead of NaN. The
  // round-trip check catches the mismatched day and rejects it.
  assert.equal(
    xirrBps([
      { date: "2023-02-29", amountPaise: -10_000_000 },
      { date: "2024-02-28", amountPaise: 11_000_000 },
    ]),
    null,
  );
});

test("xirrBps: a valid leap day (2024-02-29) is accepted", () => {
  // Proves the strict validation does not over-reject a genuinely valid
  // calendar date. Paired with a flow ~1 year later (2025-02-28, a 365-day
  // span) so the result should be a well-defined, non-null rate.
  const result = xirrBps([
    { date: "2024-02-29", amountPaise: -10_000_000 },
    { date: "2025-02-28", amountPaise: 11_000_000 },
  ]);
  assert.notEqual(result, null);
});

test("xirrBps: a 29-day span (just under the 30-day minimum) returns null", () => {
  // 2024-01-01 -> 2024-01-30 is 29 days (verified: (Date.parse(...) -
  // Date.parse(...)) / MS_PER_DAY === 29).
  assert.equal(
    xirrBps([
      { date: "2024-01-01", amountPaise: -10_000_000 },
      { date: "2024-01-30", amountPaise: 10_500_000 },
    ]),
    null,
  );
});

test("xirrBps: a 31-day span (just over the 30-day minimum) returns non-null", () => {
  // 2024-01-01 -> 2024-02-01 is 31 days (verified: (Date.parse(...) -
  // Date.parse(...)) / MS_PER_DAY === 31).
  const result = xirrBps([
    { date: "2024-01-01", amountPaise: -10_000_000 },
    { date: "2024-02-01", amountPaise: 10_500_000 },
  ]);
  assert.notEqual(result, null);
});

// ---------- positionCashFlows: additional guards ----------

test("positionCashFlows: a valuation older than the most recent sell returns null", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 20_000_000, units: 200 },
      { type: "sell", date: "2024-12-01", amountPaise: 5_500_000, units: 50 },
    ],
    { date: "2024-06-01", valuePaise: 16_500_000 },
    150,
  );
  assert.equal(flows, null);
});

test("positionCashFlows: a fully exited position with a valuation supplied still appends no terminal flow", () => {
  const flows = positionCashFlows(
    [
      { type: "buy", date: "2024-01-01", amountPaise: 10_000_000, units: 100 },
      { type: "sell", date: "2024-12-31", amountPaise: 11_000_000, units: 100 },
    ],
    { date: "2025-01-15", valuePaise: 500_000 }, // supplied but must be ignored
    0,
  );
  assert.notEqual(flows, null);
  // Series length equals the event count (2) — the valuation is ignored
  // rather than double-counting the exit.
  assert.equal(flows!.length, 2);
});
