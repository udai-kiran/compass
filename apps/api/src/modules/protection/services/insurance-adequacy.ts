/**
 * Insurance adequacy check (task 14.2).
 * Pure, DB-free computation — takes plain values, returns the adequacy report.
 */
import type {
  CoverSuggestion,
  Dependent,
  HealthAdequacy,
  InsuranceAdequacyReport,
  TermLifeAdequacy,
} from "@compass/shared";
import { formatINR } from "@compass/shared";

// ---------- Input types ----------

export interface AdequacyInput {
  /** Annual income in paise; null if no income data available */
  annualIncomePaise: number | null;
  /** Dependents from family_members */
  dependents: Array<{
    id: string;
    name: string;
    relationship: string;
    dateOfBirth: string | null;
    educationStage: string | null;
  }>;
  /** Outstanding liability balances (absolute positive values), in paise */
  outstandingLiabilitiesPaise: number;
  /** Liquid asset balance (bank + cash + investment accounts, excluding liabilities), in paise */
  liquidAssetsPaise: number;
  /** Active personal life insurance policies */
  lifePolicies: Array<{
    sumAssuredPaise: number;
    ownership: "personal" | "employer";
    archived: boolean;
  }>;
  /** Active health insurance policies */
  healthPolicies: Array<{
    sumAssuredPaise: number;
    ownership: "personal" | "employer";
    healthType: string | null;
    deductiblePaise: number | null;
    coPayBps: number | null;
    roomRentLimitPaise: number | null;
    roomRentLimitBps: number | null;
    archived: boolean;
  }>;
  /** Today's date as YYYY-MM-DD */
  today: string;
  /** Configurable assumptions */
  assumptions: {
    incomeReplacementYears: number;
    medicalInflationBps: number;
    healthProjectionYears: number;
  };
}

// ---------- Helpers ----------

/**
 * Compute age in whole years from a DOB string (YYYY-MM-DD) and today (YYYY-MM-DD).
 * Returns null if dateOfBirth is null or invalid.
 */
function ageFromDob(dateOfBirth: string | null, today: string): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth + "T00:00:00Z");
  const now = new Date(today + "T00:00:00Z");
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const mDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  if (age < 0) return null;
  return age;
}

/**
 * Estimate how many years of financial dependency a dependent still has.
 *
 * - child with known age: max(0, 25 − age)
 * - child without DOB, by education stage:
 *     preschool / primary → 18
 *     secondary → 10
 *     senior_secondary → 6
 *     undergraduate → 4
 *     postgraduate / doctorate → 2
 *     other / null → 5
 * - parent → 15
 * - spouse → incomeReplacementYears (they depend on income for that long)
 * - self / sibling → 0
 */
function dependencyYears(
  relationship: string,
  dateOfBirth: string | null,
  educationStage: string | null,
  today: string,
  incomeReplacementYears: number,
): number | null {
  const rel = relationship.toLowerCase();
  if (rel === "self" || rel === "sibling") return 0;
  if (rel === "parent") return 15;
  if (rel === "spouse") return incomeReplacementYears;
  if (rel === "child") {
    const age = ageFromDob(dateOfBirth, today);
    if (age !== null) return Math.max(0, 25 - age);
    // No DOB — use education stage
    switch (educationStage) {
      case "preschool":
      case "primary":
        return 18;
      case "secondary":
        return 10;
      case "senior_secondary":
        return 6;
      case "undergraduate":
        return 4;
      case "postgraduate":
      case "doctorate":
        return 2;
      default:
        return 5;
    }
  }
  // "other" or unknown relationship
  return 5;
}

// ---------- Main computation ----------

export function computeInsuranceAdequacy(input: AdequacyInput): InsuranceAdequacyReport {
  const { annualIncomePaise, outstandingLiabilitiesPaise, liquidAssetsPaise, assumptions, today } =
    input;

  // ---- Term Life ----

  // Build dependent list with ages and dependency years
  const dependents: Dependent[] = input.dependents.map((d) => {
    const age = ageFromDob(d.dateOfBirth, today);
    const depYears = dependencyYears(
      d.relationship,
      d.dateOfBirth,
      d.educationStage,
      today,
      assumptions.incomeReplacementYears,
    );
    return {
      id: d.id,
      name: d.name,
      relationship: d.relationship,
      age,
      educationStage: d.educationStage,
      dependencyYearsRemaining: depYears,
    };
  });

  // Income replacement years: max of any dependent's remaining years, or the
  // default assumption if there are no dependents with meaningful years.
  const maxDepYears = dependents.reduce<number>((best, d) => {
    if (d.dependencyYearsRemaining !== null && d.dependencyYearsRemaining > best) {
      return d.dependencyYearsRemaining;
    }
    return best;
  }, assumptions.incomeReplacementYears);

  const incomeReplacementYearsUsed = maxDepYears;

  // Life policies: split personal vs. employer (active, non-archived only)
  const activeLifePolicies = input.lifePolicies.filter((p) => !p.archived);
  const existingCoverPaise = activeLifePolicies
    .filter((p) => p.ownership === "personal")
    .reduce((s, p) => s + p.sumAssuredPaise, 0);
  const employerCoverPaise = activeLifePolicies
    .filter((p) => p.ownership === "employer")
    .reduce((s, p) => s + p.sumAssuredPaise, 0);

  let termLife: TermLifeAdequacy;

  if (annualIncomePaise === null) {
    // Insufficient data
    termLife = {
      annualIncomePaise: null,
      dependents,
      incomeReplacementNeedPaise: 0,
      outstandingLiabilitiesPaise,
      liquidAssetsPaise,
      existingCoverPaise,
      employerCoverPaise,
      totalNeedPaise: 0,
      gapPaise: 0,
      assumptions: { incomeReplacementYears: incomeReplacementYearsUsed },
      verdict: "insufficient_data",
    };
  } else {
    const incomeReplacementNeedPaise = annualIncomePaise * incomeReplacementYearsUsed;
    const totalNeedPaise = Math.max(
      0,
      incomeReplacementNeedPaise + outstandingLiabilitiesPaise - liquidAssetsPaise,
    );
    const gapPaise = Math.max(0, totalNeedPaise - existingCoverPaise - employerCoverPaise);

    let verdict: TermLifeAdequacy["verdict"];
    if (gapPaise <= 0) {
      verdict = "adequate";
    } else {
      verdict = "underinsured";
    }

    termLife = {
      annualIncomePaise,
      dependents,
      incomeReplacementNeedPaise,
      outstandingLiabilitiesPaise,
      liquidAssetsPaise,
      existingCoverPaise,
      employerCoverPaise,
      totalNeedPaise,
      gapPaise,
      assumptions: { incomeReplacementYears: incomeReplacementYearsUsed },
      verdict,
    };
  }

  // ---- Health ----

  // Only indemnity and top_up policies count toward indemnity cover
  const activeHealthPolicies = input.healthPolicies.filter((p) => !p.archived);
  const indemnityPolicies = activeHealthPolicies.filter(
    (p) => p.healthType === "indemnity" || p.healthType === "top_up",
  );

  let health: HealthAdequacy;

  if (activeHealthPolicies.length === 0) {
    health = {
      totalCoverPaise: 0,
      usableCoverPaise: 0,
      employerOnlyCoverPaise: 0,
      projectedCoverPaise: 0,
      gaps: [{ type: "no_health_cover", description: "No health insurance policies found" }],
      assumptions: {
        medicalInflationBps: assumptions.medicalInflationBps,
        healthProjectionYears: assumptions.healthProjectionYears,
      },
      verdict: "insufficient_data",
    };
  } else {
    const totalCoverPaise = indemnityPolicies.reduce((s, p) => s + p.sumAssuredPaise, 0);

    // Usable cover: reduce per policy by deductible, co-pay, and room-rent limits
    let usableCoverPaise = 0;
    for (const p of indemnityPolicies) {
      let effective = p.sumAssuredPaise;
      // Subtract deductible (floor at 0)
      if (p.deductiblePaise != null && p.deductiblePaise > 0) {
        effective = Math.max(0, effective - p.deductiblePaise);
      }
      // Reduce by co-pay percentage
      if (p.coPayBps != null && p.coPayBps > 0) {
        effective = Math.round(effective * (1 - p.coPayBps / 10000));
      }
      // Room-rent cap: conservative 20% reduction if any cap exists
      if (
        (p.roomRentLimitBps != null && p.roomRentLimitBps > 0) ||
        (p.roomRentLimitPaise != null && p.roomRentLimitPaise > 0)
      ) {
        effective = Math.round(effective * 0.8);
      }
      usableCoverPaise += effective;
    }

    // Employer-only cover
    const employerOnlyCoverPaise = indemnityPolicies
      .filter((p) => p.ownership === "employer")
      .reduce((s, p) => s + p.sumAssuredPaise, 0);

    // Projected cover after medical inflation erosion
    const inflationRate = assumptions.medicalInflationBps / 10000;
    const projectedCoverPaise = Math.round(
      totalCoverPaise / Math.pow(1 + inflationRate, assumptions.healthProjectionYears),
    );

    // Identify gaps
    const gaps: Array<{ type: string; description: string }> = [];

    const hasPersonalAccident = activeHealthPolicies.some(
      (p) => p.healthType === "personal_accident",
    );
    if (!hasPersonalAccident) {
      gaps.push({
        type: "no_personal_accident",
        description: "No personal accident cover — accidents are not covered by indemnity health policies",
      });
    }

    const hasCriticalIllness = activeHealthPolicies.some(
      (p) => p.healthType === "critical_illness",
    );
    if (!hasCriticalIllness) {
      gaps.push({
        type: "no_critical_illness",
        description: "No critical illness cover — treatment costs for conditions like cancer or cardiac events may far exceed the hospitalisation sum insured",
      });
    }

    const hasPersonalHealth = indemnityPolicies.some((p) => p.ownership === "personal");
    if (employerOnlyCoverPaise > 0 && !hasPersonalHealth) {
      gaps.push({
        type: "employer_only_health",
        description: "Employer-only health cover is a continuity risk — it ends with the job",
      });
    }

    const MINIMUM_HEALTH_COVER_PAISE = 500_000_00; // ₹5 lakh in paise
    if (totalCoverPaise < MINIMUM_HEALTH_COVER_PAISE) {
      gaps.push({
        type: "below_minimum",
        description: "Health cover below recommended minimum of ₹5 lakh",
      });
    }

    let verdict: HealthAdequacy["verdict"];
    if (gaps.length === 0 && projectedCoverPaise > MINIMUM_HEALTH_COVER_PAISE) {
      verdict = "adequate";
    } else {
      verdict = "review_needed";
    }

    health = {
      totalCoverPaise,
      usableCoverPaise,
      employerOnlyCoverPaise,
      projectedCoverPaise,
      gaps,
      assumptions: {
        medicalInflationBps: assumptions.medicalInflationBps,
        healthProjectionYears: assumptions.healthProjectionYears,
      },
      verdict,
    };
  }

  // ---- Suggestions ----

  const suggestions: CoverSuggestion[] = [];

  // Term life gap
  if (termLife.gapPaise > 0) {
    suggestions.push({
      coverType: "Term life insurance",
      suggestedAmountPaise: termLife.gapPaise,
      rationale: `Your current life cover leaves a gap of ${formatINR(termLife.gapPaise)} based on income replacement need, outstanding liabilities, and liquid assets`,
    });
  }

  const hasPersonalAccident = input.healthPolicies.some(
    (p) => !p.archived && p.healthType === "personal_accident",
  );
  if (!hasPersonalAccident) {
    suggestions.push({
      coverType: "Personal accident cover",
      suggestedAmountPaise: 0,
      rationale: "Personal accident cover pays a lump sum on accidental death or disability — not covered by standard health insurance",
    });
  }

  const hasCriticalIllness = input.healthPolicies.some(
    (p) => !p.archived && p.healthType === "critical_illness",
  );
  if (!hasCriticalIllness) {
    suggestions.push({
      coverType: "Critical illness cover",
      suggestedAmountPaise: 0,
      rationale: "Critical illness policies pay on diagnosis — funds lifestyle changes, income loss, and treatment not covered by hospitalisation insurance",
    });
  }

  const activeIndemnity = input.healthPolicies.filter(
    (p) => !p.archived && (p.healthType === "indemnity" || p.healthType === "top_up"),
  );
  const hasEmployerOnlyHealth =
    activeIndemnity.some((p) => p.ownership === "employer") &&
    !activeIndemnity.some((p) => p.ownership === "personal");
  if (hasEmployerOnlyHealth) {
    suggestions.push({
      coverType: "Personal health insurance",
      suggestedAmountPaise: 0,
      rationale: "Employer-provided health cover ends when you leave the job — a personal policy ensures continuity",
    });
  }

  return { termLife, health, suggestions };
}
