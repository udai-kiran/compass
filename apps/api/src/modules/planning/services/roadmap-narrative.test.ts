import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFactsMessage } from "./roadmap-narrative.ts";
import type { RoadmapNarrativeInput } from "./roadmap-narrative.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseInput: RoadmapNarrativeInput = {
  goalName: "Home Purchase",
  goalType: "home",
  targetPaise: 500_000_00, // ₹50,00,000 (50 lakh)
  fundedPaise: 100_000_00, // ₹10,00,000 (10 lakh)
  monthsToTarget: 60,
  glideSteps: [],
  targetEquityPct: 60,
  targetDebtPct: 40,
  allocationDrifted: false,
  recommendedMonthlyPaise: 50_000_00, // ₹50,000
};

// ---------------------------------------------------------------------------
// buildFactsMessage tests (pure, no AI provider needed)
// ---------------------------------------------------------------------------

test("buildFactsMessage: contains goal name and goal type", () => {
  const output = buildFactsMessage(baseInput);
  assert.ok(output.includes("Home Purchase"), "should contain the goal name");
  assert.ok(output.includes("home"), "should contain the goal type");
});

test("buildFactsMessage: contains formatted target paise with rupee symbol", () => {
  const output = buildFactsMessage(baseInput);
  assert.ok(output.includes("₹"), "should contain the rupee symbol");
  assert.ok(output.includes("Target:"), "should have a Target label");
  // 500_000_00 paise = ₹50,00,000 — just check the symbol + label presence
});

test("buildFactsMessage: shows 'no target date set' when monthsToTarget is null", () => {
  const input: RoadmapNarrativeInput = { ...baseInput, monthsToTarget: null };
  const output = buildFactsMessage(input);
  assert.ok(
    output.includes("no target date set"),
    "should include the no-target-date message when monthsToTarget is null",
  );
});

test("buildFactsMessage: contains glide path section when steps are provided", () => {
  const input: RoadmapNarrativeInput = {
    ...baseInput,
    glideSteps: [
      {
        fromDate: "2026-08-18",
        toDate: "2028-08-18",
        equityPct: 60,
        debtPct: 40,
        monthsRemaining: 60,
        requiredMonthlyPaise: 50_000_00,
        projectedCorpusPaise: 100_000_00,
      },
    ],
  };
  const output = buildFactsMessage(input);
  assert.ok(output.includes("Glide path"), "should contain the 'Glide path' header");
  assert.ok(output.includes("2026-08-18"), "should include the step fromDate");
  assert.ok(output.includes("60% equity"), "should include the equity allocation percentage");
});

test("buildFactsMessage: never contains named fund, AMC, or scheme names", () => {
  // These are the fund names the ROADMAP_SYSTEM prompt explicitly bans —
  // verifying that buildFactsMessage itself does not introduce them.
  const forbiddenNames = [
    "HDFC",
    "SBI",
    "Axis",
    "Mirae",
    "ICICI",
    "Kotak",
    "Nippon",
    "Parag Parikh",
    "Quant",
    "DSP",
  ];
  const output = buildFactsMessage(baseInput);
  for (const name of forbiddenNames) {
    assert.ok(!output.includes(name), `output must not contain fund/AMC name: "${name}"`);
  }
});
