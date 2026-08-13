import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCardsBySubject } from "./statement-rank.ts";

const CARDS = [
  { id: "1", name: "Swiggy",                  institution: "HDFC" },
  { id: "2", name: "Diners Club International", institution: "HDFC" },
  { id: "3", name: "Tata Neu",                  institution: "HDFC" },
  { id: "4", name: "Axis Airtel",               institution: "Axis" },
  { id: "5", name: "Rewards",                   institution: "Axis" },
  { id: "6", name: "SBI PhonePe",               institution: "SBI" },
];

describe("rankCardsBySubject", () => {
  it("puts Swiggy first for its own subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "1");
  });

  it("puts Diners first for Diners Black subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Diners Black Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "2");
  });

  it("puts Tata Neu first for Tata Neu subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "3");
  });

  it("puts Axis Airtel first for Airtel Axis subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026");
    assert.equal(ranked[0]!.id, "4");
  });

  it("puts Rewards first for Axis Rewards subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your Axis Bank Rewards Credit Card ending XX86 - July 2026");
    assert.equal(ranked[0]!.id, "5");
  });

  it("puts SBI PhonePe first for SBI PhonePe subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026");
    assert.equal(ranked[0]!.id, "6");
  });

  it("preserves original order when all scores are zero (empty subject)", () => {
    const ranked = rankCardsBySubject(CARDS, "");
    assert.deepEqual(ranked.map((c) => c.id), CARDS.map((c) => c.id));
  });

  it("preserves original order when all scores are zero (generic subject)", () => {
    const ranked = rankCardsBySubject(CARDS, "Bank Credit Card Statement");
    // all stopwords → all score 0 → original order preserved
    assert.deepEqual(ranked.map((c) => c.id), CARDS.map((c) => c.id));
  });

  it("handles punctuation-attached tokens in subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Swiggy-HDFC Bank Credit:Card Statement!");
    assert.equal(ranked[0]!.id, "1");
  });

  it("is case-insensitive", () => {
    const ranked = rankCardsBySubject(CARDS, "DINERS BLACK CREDIT CARD STATEMENT");
    assert.equal(ranked[0]!.id, "2");
  });

  it("returns a new array and does not mutate input", () => {
    const input = [...CARDS];
    rankCardsBySubject(input, "Rewards");
    assert.deepEqual(input.map((c) => c.id), CARDS.map((c) => c.id));
  });
});
