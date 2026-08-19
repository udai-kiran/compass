import { AiDisabledError, AiUnavailableError, type AiObserver } from "@compass/ai";
import type { Db } from "../../../db/index.ts";
import { getUserAiProvider } from "../../automation/services/ai-settings.ts";
import type { GlideStep } from "./goal-plan.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoadmapNarrativeInput {
  goalName: string;
  goalType: string;
  targetPaise: number | null;
  fundedPaise: number;
  monthsToTarget: number | null;
  /** Glide-path steps from buildGlidePathSchedule — empty for emergency funds / undated goals. */
  glideSteps: GlideStep[];
  /** Recommended allocation from GoalPlan. */
  targetEquityPct: number;
  targetDebtPct: number;
  /** True when the current allocation has drifted from the target beyond the rebalance band. */
  allocationDrifted: boolean;
  /** Monthly contribution to stay on track; null when the goal has no target date. */
  recommendedMonthlyPaise: number | null;
}

export interface RoadmapNarrative {
  narrative: string;
  /** ISO 8601 timestamp when the narrative was generated. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

const ROADMAP_SYSTEM =
  "You explain personal finance plans in plain language. Use ONLY the facts provided — never invent figures. " +
  "Write 2-4 short paragraphs. No markdown headings or bullet lists. " +
  "CRITICAL: Never name a mutual fund scheme, AMC, or specific financial product. " +
  "Use category names only (e.g. 'an equity fund', 'a government bond scheme'). " +
  "Amounts are in Indian Rupees. Be direct and friendly, never preachy.";

/**
 * Render the goal facts into a plain-text message for the AI. Exported for
 * unit-testing: the output must never contain named funds, AMCs, or schemes.
 */
export function buildFactsMessage(input: RoadmapNarrativeInput): string {
  const lines: string[] = [`Goal: ${input.goalName} (${input.goalType})`];

  if (input.targetPaise !== null) {
    lines.push(`Target: ₹${(input.targetPaise / 100).toLocaleString("en-IN")}`);
  }

  lines.push(`Currently funded: ₹${(input.fundedPaise / 100).toLocaleString("en-IN")}`);

  if (input.monthsToTarget !== null) {
    const years = Math.floor(input.monthsToTarget / 12);
    const months = input.monthsToTarget % 12;
    const yearsStr = years > 0 ? `${years} year${years !== 1 ? "s" : ""}` : "";
    const monthsStr = months > 0 ? `${months} month${months !== 1 ? "s" : ""}` : "";
    lines.push(`Time remaining: ${[yearsStr, monthsStr].filter(Boolean).join(" ")}`);
  } else {
    lines.push("Time remaining: no target date set");
  }

  lines.push(
    `Recommended allocation: ${input.targetEquityPct}% equity, ${input.targetDebtPct}% debt`,
  );

  if (input.recommendedMonthlyPaise !== null && input.recommendedMonthlyPaise > 0) {
    lines.push(
      `Recommended monthly contribution: ₹${(input.recommendedMonthlyPaise / 100).toLocaleString("en-IN")}`,
    );
  }

  if (input.allocationDrifted) {
    lines.push("Note: current allocation has drifted from target — rebalancing suggested.");
  }

  if (input.glideSteps.length > 0) {
    lines.push("");
    lines.push("Glide path (allocation shifts over time):");
    for (const step of input.glideSteps.slice(0, 5)) {
      lines.push(
        `  From ${step.fromDate} to ${step.toDate}: ${step.equityPct}% equity / ${step.debtPct}% debt`,
      );
      if (step.requiredMonthlyPaise !== null && step.requiredMonthlyPaise > 0) {
        lines.push(
          `    Contribution needed: ₹${(step.requiredMonthlyPaise / 100).toLocaleString("en-IN")}/month`,
        );
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a plain-language goal roadmap narrative using the user's AI provider.
 *
 * Returns null (not an error) when:
 *   - the user has AI disabled (AiDisabledError from NullProvider)
 *   - the AI provider is temporarily unreachable (AiUnavailableError)
 *   - any other AI error occurs
 *
 * The deterministic roadmap is always the primary output; the narrative is
 * assist-only and degrades gracefully.
 *
 * Note: `secret` and `allowedBaseUrls` are required by `getUserAiProvider`
 * to decrypt the stored API key and validate the configured base URL. Pass
 * `mailboxSecret(app.config)` and `app.config.AI_ALLOWED_BASE_URLS` from the
 * route layer.
 */
export async function generateRoadmapNarrative(
  db: Db,
  userId: string,
  secret: string,
  allowedBaseUrls: string,
  input: RoadmapNarrativeInput,
  observer?: AiObserver,
): Promise<RoadmapNarrative | null> {
  try {
    const ai = await getUserAiProvider(db, userId, secret, allowedBaseUrls, observer);
    const facts = buildFactsMessage(input);
    const response = await ai.chat({
      system: ROADMAP_SYSTEM,
      messages: [{ role: "user", content: facts }],
      tools: [],
      maxTokens: 512,
    });
    const narrative = response.text ?? "";
    return { narrative, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof AiDisabledError || err instanceof AiUnavailableError) {
      return null;
    }
    // Degrade gracefully on any unexpected AI error — never surface AI failures
    // on the roadmap; the deterministic output is always the primary artifact.
    return null;
  }
}
