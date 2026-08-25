/**
 * tax-view.ts — pure derivation helpers for the Tax page (task 13.14).
 *
 * Everything the page computes from backend figures lives here so it can be
 * unit-tested without rendering. Money stays integer paise; formatting happens
 * with formatINR/compactINR at the call site.
 */

/** Canonical FY label "YYYY-YY" for an ISO date — the Indian Apr–Mar year. */
export function fyOfDate(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function currentFyLabel(today?: string): string {
  return fyOfDate(today ?? new Date().toISOString().slice(0, 10));
}

/** The FY selector's choices: two previous years plus the current one, newest first. */
export function fyChoices(today?: string): string[] {
  const cur = Number(currentFyLabel(today).slice(0, 4));
  return [cur, cur - 1, cur - 2].map(
    (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`,
  );
}

/** Utilisation percentage for a deduction-bucket meter (cap 0 → 0%). */
export function bucketPct(contributedPaise: number, capPaise: number): number {
  if (capPaise <= 0) return 0;
  return (contributedPaise / capPaise) * 100;
}

export interface RegimeVerdict {
  /** Which regime wins; the component renders the sentence via formatINR. */
  recommendation: "old" | "new" | "indifferent";
  /** How much paise the winning regime saves (0 when indifferent). */
  savingPaise: number;
  /** Plain statement shown when deductions would not change anything. */
  deductionNote: string | null;
}

/**
 * What the comparison means for THIS user — as STRUCTURED data; the page
 * formats the amounts with formatINR so no hand-built currency strings exist.
 * The new-regime case is stated bluntly: chasing 80C-style deductions is
 * pointless when they do not apply to you — never render a headroom bar that
 * quietly does not count.
 */
export function regimeVerdict(c: {
  recommendation: "old" | "new" | "indifferent";
  savingPaise: number;
  crossoverDeductionPaise: number | null;
}): RegimeVerdict {
  if (c.recommendation === "new") {
    return {
      recommendation: "new",
      savingPaise: c.savingPaise,
      deductionNote:
        "Under the new regime most deductions (80C, 80CCD(1B), 80D) do not apply — contributing to save tax is pointless; contribute only to invest.",
    };
  }
  if (c.recommendation === "old") {
    return {
      recommendation: "old",
      savingPaise: c.savingPaise,
      deductionNote:
        c.crossoverDeductionPaise == null
          ? null
          : "Old regime wins once total deductions cross the crossover level shown above.",
    };
  }
  return {
    recommendation: "indifferent",
    savingPaise: 0,
    deductionNote: null,
  };
}

export type InstalmentState = "past" | "upcoming";

/** A due date strictly before today has passed (same-day dues are still upcoming). */
export function instalmentState(dueDate: string, todayIso: string): InstalmentState {
  return dueDate < todayIso ? "past" : "upcoming";
}
