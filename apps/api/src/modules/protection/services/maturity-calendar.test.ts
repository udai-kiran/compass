/**
 * Tests for computeMaturityCalendar and ppfMaturityDate (task 14.3).
 * Uses node:test — no Jest/Vitest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMaturityCalendar, ppfMaturityDate } from "./maturity-calendar.ts";
import type { CalendarInput } from "./maturity-calendar.ts";

/** Minimal empty input. */
function emptyInput(today = "2026-08-26"): CalendarInput {
  return {
    today,
    insurancePolicies: [],
    schemeAccounts: [],
    sgbHoldings: [],
    deposits: [],
    elssHoldings: [],
  };
}

describe("ppfMaturityDate", () => {
  it("computes 15 years from FY end for an account opened in May (Apr-Mar FY)", () => {
    // Opened May 2010 → FY 2010-11 → FY end = 31 Mar 2011 → maturity = 31 Mar 2026
    assert.equal(ppfMaturityDate("2010-05-15"), "2026-03-31");
  });

  it("computes 15 years from FY end for an account opened in January (same FY ends Mar same year)", () => {
    // Opened Jan 2011 → FY 2010-11 → FY end = 31 Mar 2011 → maturity = 31 Mar 2026
    assert.equal(ppfMaturityDate("2011-01-10"), "2026-03-31");
  });

  it("computes 15 years from FY end for an account opened in April (Apr is start of new FY)", () => {
    // Opened Apr 2011 → FY 2011-12 → FY end = 31 Mar 2012 → maturity = 31 Mar 2027
    assert.equal(ppfMaturityDate("2011-04-01"), "2027-03-31");
  });

  it("computes 15 years from FY end for an account opened in March", () => {
    // Opened Mar 2011 → FY 2010-11 → FY end = 31 Mar 2011 → maturity = 31 Mar 2026
    assert.equal(ppfMaturityDate("2011-03-31"), "2026-03-31");
  });
});

describe("computeMaturityCalendar — empty input", () => {
  it("returns empty calendar gracefully", () => {
    const result = computeMaturityCalendar(emptyInput());
    assert.equal(result.events.length, 0);
    assert.equal(result.upcomingCount, 0);
    assert.equal(result.pastCount, 0);
    assert.equal(result.maturedIdleCount, 0);
  });
});

describe("computeMaturityCalendar — insurance", () => {
  it("produces a renewal event for a health policy with renewalDate", () => {
    const input = emptyInput("2026-01-01");
    input.insurancePolicies = [
      {
        id: "p1",
        name: "Star Health",
        kind: "health",
        maturityDate: null,
        renewalDate: "2026-12-01",
        sumAssuredPaise: 50000000,
        premiumPaise: 1500000,
      },
    ];
    const result = computeMaturityCalendar(input);
    const renewals = result.events.filter((e) => e.source === "insurance_renewal");
    assert.equal(renewals.length, 1);
    assert.equal(renewals[0]!.date, "2026-12-01");
    assert.equal(renewals[0]!.entityId, "p1");
    assert.equal(renewals[0]!.isPast, false);
  });

  it("produces a maturity event for a life policy with maturityDate", () => {
    const input = emptyInput("2026-01-01");
    input.insurancePolicies = [
      {
        id: "p2",
        name: "LIC Jeevan Anand",
        kind: "life",
        maturityDate: "2035-06-15",
        renewalDate: "2026-06-15",
        sumAssuredPaise: 100000000,
        premiumPaise: 5000000,
      },
    ];
    const result = computeMaturityCalendar(input);
    const maturities = result.events.filter((e) => e.source === "insurance_maturity");
    assert.equal(maturities.length, 1);
    assert.equal(maturities[0]!.date, "2035-06-15");
    assert.equal(maturities[0]!.amountPaise, 100000000);
  });

  it("does not produce a maturity event for a health policy", () => {
    const input = emptyInput("2026-01-01");
    input.insurancePolicies = [
      {
        id: "p3",
        name: "HDFC Ergo",
        kind: "health",
        maturityDate: null,
        renewalDate: "2026-11-01",
        sumAssuredPaise: 50000000,
        premiumPaise: 2000000,
      },
    ];
    const result = computeMaturityCalendar(input);
    const maturities = result.events.filter((e) => e.source === "insurance_maturity");
    assert.equal(maturities.length, 0);
  });
});

describe("computeMaturityCalendar — deposits", () => {
  it("produces fd_maturity event for FD deposit", () => {
    const input = emptyInput("2026-01-01");
    input.deposits = [
      {
        holdingId: "h1",
        holdingName: "SBI FD",
        depositKind: "fd",
        startDate: "2024-01-01",
        maturityDate: "2026-06-01",
        autoRenewal: false,
        principalPaise: 50000000,
        installmentPaise: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const fds = result.events.filter((e) => e.source === "fd_maturity");
    assert.equal(fds.length, 1);
    assert.equal(fds[0]!.date, "2026-06-01");
    assert.equal(fds[0]!.amountPaise, 50000000);
    assert.equal(fds[0]!.warnings.length, 0);
  });

  it("adds auto-renewal warning for FD with autoRenewal=true", () => {
    const input = emptyInput("2026-01-01");
    input.deposits = [
      {
        holdingId: "h2",
        holdingName: "HDFC FD",
        depositKind: "fd",
        startDate: "2025-01-01",
        maturityDate: "2027-01-01",
        autoRenewal: true,
        principalPaise: 10000000,
        installmentPaise: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "fd_maturity");
    assert.ok(ev);
    assert.ok(ev.warnings.some((w) => w.includes("worse rate")));
  });

  it("does NOT add auto-renewal warning for RD", () => {
    const input = emptyInput("2026-01-01");
    input.deposits = [
      {
        holdingId: "h3",
        holdingName: "PNB RD",
        depositKind: "rd",
        startDate: "2024-06-01",
        maturityDate: "2027-06-01",
        autoRenewal: true, // should be ignored for RD
        principalPaise: null,
        installmentPaise: 500000,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "rd_maturity");
    assert.ok(ev);
    assert.equal(ev.warnings.length, 0);
  });

  it("produces nsc_maturity event for NSC deposit", () => {
    const input = emptyInput("2026-01-01");
    input.deposits = [
      {
        holdingId: "h4",
        holdingName: "Post Office NSC",
        depositKind: "nsc",
        startDate: "2021-01-01",
        maturityDate: "2026-01-01",
        autoRenewal: false,
        principalPaise: 100000,
        installmentPaise: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "nsc_maturity");
    assert.ok(ev);
    assert.equal(ev.date, "2026-01-01");
  });
});

describe("computeMaturityCalendar — PPF", () => {
  it("computes PPF maturity from schemeOpenedDate when no explicit maturityDate", () => {
    const input = emptyInput("2026-01-01");
    input.schemeAccounts = [
      {
        id: "a1",
        name: "My PPF",
        type: "ppf",
        schemeOpenedDate: "2010-05-15",
        balancePaise: 500000000,
        maturityDate: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "ppf_maturity");
    assert.ok(ev);
    assert.equal(ev.date, "2026-03-31");
    assert.equal(ev.entityId, "a1");
  });

  it("uses explicit maturityDate from retirement_details when provided", () => {
    const input = emptyInput("2026-01-01");
    input.schemeAccounts = [
      {
        id: "a2",
        name: "PPF Account",
        type: "ppf",
        schemeOpenedDate: "2010-05-15",
        balancePaise: 0,
        maturityDate: "2025-04-15", // explicit override
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "ppf_maturity");
    assert.ok(ev);
    assert.equal(ev.date, "2025-04-15");
  });

  it("generates 3 PPF extension block events after maturity", () => {
    const input = emptyInput("2020-01-01");
    input.schemeAccounts = [
      {
        id: "a3",
        name: "PPF",
        type: "ppf",
        schemeOpenedDate: "2005-05-01", // FY 2005-06 → end 31 Mar 2006 → maturity 31 Mar 2021
        balancePaise: 0,
        maturityDate: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const exts = result.events.filter((e) => e.source === "ppf_extension");
    assert.equal(exts.length, 3);
    // Extension blocks: +5, +10, +15 years from maturity date (2021-03-31)
    assert.equal(exts[0]!.date, "2026-03-31"); // maturity + 5
    assert.equal(exts[1]!.date, "2031-03-31"); // maturity + 10
    assert.equal(exts[2]!.date, "2036-03-31"); // maturity + 15
  });
});

describe("computeMaturityCalendar — SSY", () => {
  it("produces ssy_maturity event 21 years from account opening", () => {
    const input = emptyInput("2026-01-01");
    input.schemeAccounts = [
      {
        id: "s1",
        name: "Ammu SSY",
        type: "ssy",
        schemeOpenedDate: "2015-06-01",
        balancePaise: 100000000,
        maturityDate: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "ssy_maturity");
    assert.ok(ev);
    assert.equal(ev.date, "2036-06-01");
  });

  it("produces ssy_partial_withdrawal event 18 years from opening", () => {
    const input = emptyInput("2026-01-01");
    input.schemeAccounts = [
      {
        id: "s2",
        name: "Ammu SSY",
        type: "ssy",
        schemeOpenedDate: "2015-06-01",
        balancePaise: 100000000,
        maturityDate: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "ssy_partial_withdrawal");
    assert.ok(ev);
    assert.equal(ev.date, "2033-06-01");
  });
});

describe("computeMaturityCalendar — SGB", () => {
  it("produces sgb_maturity and sgb_exit_window events", () => {
    const input = emptyInput("2026-01-01");
    input.sgbHoldings = [
      {
        id: "g1",
        name: "SGB Nov 2020",
        maturityDate: "2028-11-10",
        valuePaise: 80000000,
      },
    ];
    const result = computeMaturityCalendar(input);

    const matEv = result.events.find((e) => e.source === "sgb_maturity");
    assert.ok(matEv);
    assert.equal(matEv.date, "2028-11-10");

    const exitEv = result.events.find((e) => e.source === "sgb_exit_window");
    assert.ok(exitEv);
    // Exit window = maturity - 3 years = 2025-11-10
    assert.equal(exitEv.date, "2025-11-10");
  });

  it("exit window date is 3 years before maturity (year 5 of 8-year tenure)", () => {
    const input = emptyInput("2026-01-01");
    input.sgbHoldings = [
      {
        id: "g2",
        name: "SGB 2022",
        maturityDate: "2030-04-15",
        valuePaise: 0,
      },
    ];
    const result = computeMaturityCalendar(input);
    const exitEv = result.events.find((e) => e.source === "sgb_exit_window");
    assert.ok(exitEv);
    assert.equal(exitEv.date, "2027-04-15");
  });

  it("skips SGB with no maturityDate", () => {
    const input = emptyInput("2026-01-01");
    input.sgbHoldings = [
      { id: "g3", name: "Unknown SGB", maturityDate: null, valuePaise: 0 },
    ];
    const result = computeMaturityCalendar(input);
    assert.equal(result.events.length, 0);
  });
});

describe("computeMaturityCalendar — ELSS per-instalment lock-in", () => {
  it("produces one elss_unlock event per buy event (SIP rolling lock-in)", () => {
    const input = emptyInput("2026-01-01");
    input.elssHoldings = [
      {
        holdingId: "e1",
        holdingName: "Axis ELSS",
        buyEvents: [
          { date: "2023-01-15", amountPaise: 500000, units: 50.123 },
          { date: "2023-02-15", amountPaise: 500000, units: 49.876 },
          { date: "2023-03-15", amountPaise: 500000, units: 51.001 },
        ],
      },
    ];
    const result = computeMaturityCalendar(input);
    const unlocks = result.events.filter((e) => e.source === "elss_unlock");
    assert.equal(unlocks.length, 3);
    // Each unlock is 3 years from buy date
    assert.equal(unlocks.find((e) => e.key.includes("2023-01-15"))?.date, "2026-01-15");
    assert.equal(unlocks.find((e) => e.key.includes("2023-02-15"))?.date, "2026-02-15");
    assert.equal(unlocks.find((e) => e.key.includes("2023-03-15"))?.date, "2026-03-15");
  });

  it("generates stable keys per holding+date for ELSS", () => {
    const input = emptyInput("2026-01-01");
    input.elssHoldings = [
      {
        holdingId: "e2",
        holdingName: "Mirae ELSS",
        buyEvents: [{ date: "2022-06-10", amountPaise: 1000000, units: null }],
      },
    ];
    const result = computeMaturityCalendar(input);
    const ev = result.events.find((e) => e.source === "elss_unlock");
    assert.ok(ev);
    assert.equal(ev.key, "elss_unlock:e2:2022-06-10");
    assert.equal(ev.date, "2025-06-10");
  });
});

describe("computeMaturityCalendar — isPast and maturedIdleCount", () => {
  it("flags past events with isPast=true", () => {
    const input = emptyInput("2026-08-26");
    input.deposits = [
      {
        holdingId: "past1",
        holdingName: "Old FD",
        depositKind: "fd",
        startDate: "2020-01-01",
        maturityDate: "2023-01-01", // in the past
        autoRenewal: false,
        principalPaise: 100000,
        installmentPaise: null,
      },
      {
        holdingId: "future1",
        holdingName: "New FD",
        depositKind: "fd",
        startDate: "2025-01-01",
        maturityDate: "2027-01-01", // in the future
        autoRenewal: false,
        principalPaise: 200000,
        installmentPaise: null,
      },
    ];
    const result = computeMaturityCalendar(input);
    const past = result.events.find((e) => e.entityId === "past1");
    const future = result.events.find((e) => e.entityId === "future1");
    assert.ok(past?.isPast);
    assert.equal(future?.isPast, false);
    assert.equal(result.pastCount, 1);
    assert.equal(result.upcomingCount, 1);
  });

  it("counts maturedIdleCount for past maturity events only", () => {
    const input = emptyInput("2026-08-26");
    input.deposits = [
      {
        holdingId: "d1",
        holdingName: "Past FD",
        depositKind: "fd",
        startDate: "2020-01-01",
        maturityDate: "2022-06-01", // past maturity
        autoRenewal: false,
        principalPaise: 100000,
        installmentPaise: null,
      },
    ];
    input.sgbHoldings = [
      {
        id: "sg1",
        name: "SGB Old",
        maturityDate: "2024-01-01", // past maturity
        valuePaise: 0,
      },
    ];
    const result = computeMaturityCalendar(input);
    // fd_maturity (past) + sgb_maturity (past) = 2
    assert.equal(result.maturedIdleCount, 2);
  });

  it("does not count extension or exit-window events in maturedIdleCount", () => {
    const input = emptyInput("2030-01-01");
    input.schemeAccounts = [
      {
        id: "ppf1",
        name: "PPF",
        type: "ppf",
        schemeOpenedDate: "2010-01-15",
        balancePaise: 0,
        maturityDate: null,
        // ppf_maturity = 2026-03-31 (past), ppf_extension events
      },
    ];
    const result = computeMaturityCalendar(input);
    // Only ppf_maturity source ends with "_maturity"; ppf_extension does not
    const maturedIdle = result.maturedIdleCount;
    // Should count only the ppf_maturity (which is past), not extensions
    const ppfMatEvent = result.events.find((e) => e.source === "ppf_maturity");
    assert.ok(ppfMatEvent?.isPast);
    assert.equal(maturedIdle, 1);
  });
});

describe("computeMaturityCalendar — consolidated calendar", () => {
  it("consolidates events from all sources, sorted by date ascending", () => {
    const input = emptyInput("2026-01-01");
    input.insurancePolicies = [
      {
        id: "pol1",
        name: "Term Life",
        kind: "life",
        maturityDate: "2040-01-01",
        renewalDate: "2026-07-01",
        sumAssuredPaise: 500000000,
        premiumPaise: 3000000,
      },
    ];
    input.deposits = [
      {
        holdingId: "dep1",
        holdingName: "SBI FD",
        depositKind: "fd",
        startDate: "2024-03-01",
        maturityDate: "2026-03-01",
        autoRenewal: false,
        principalPaise: 5000000,
        installmentPaise: null,
      },
    ];
    input.elssHoldings = [
      {
        holdingId: "elss1",
        holdingName: "DSP ELSS",
        buyEvents: [{ date: "2024-02-10", amountPaise: 500000, units: 45 }],
      },
    ];
    const result = computeMaturityCalendar(input);
    assert.ok(result.events.length >= 4); // renewal, fd_maturity, elss_unlock, life_maturity

    // Verify sorted
    for (let i = 1; i < result.events.length; i++) {
      assert.ok(result.events[i]!.date >= result.events[i - 1]!.date);
    }
  });
});
