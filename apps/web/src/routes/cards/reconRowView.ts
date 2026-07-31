import { formatINR, type StatementReconciliation } from "@compass/shared";

type DriftKind = "none" | "shortfall" | "surplus" | "credit";

interface DriftPresentation {
  kind: DriftKind;
  /** only ever true for `shortfall` — a credit balance is never "carried forward" */
  carryForwardHint: boolean;
  /** true only for `shortfall`; a credit or surplus keeps the "all lines matched" badge */
  suppressCleared: boolean;
}

/**
 * Classifies a cycle's already-computed `dueDriftPaise`/`ledgerDuePaise` for
 * display. `ledgerDuePaise < 0` (the ledger holds a credit balance) is
 * checked BEFORE the drift sign: a credit balance against a small/zero
 * statement due still subtracts to a *positive* drift, but that is not a
 * shortfall — the ledger has money in hand, not a gap — so it is classified
 * `credit` first and never folds into `shortfall`'s copy or carry-forward
 * hint.
 *
 * Mirrors `driftPresentation` in apps/api/src/services/cards.ts. Duplicated
 * here (not imported) because the web workspace cannot depend on API service
 * code — the two are kept in lockstep by design, and this file's own
 * `dueDriftPaise`/`ledgerDuePaise` numbers come straight from the API's
 * version of this same classification, so a drift in behavior would show up
 * as visibly wrong copy, not a silent mismatch.
 */
function driftPresentation(dueDriftPaise: number | null, ledgerDuePaise: number | null): DriftPresentation {
  if (dueDriftPaise === null || ledgerDuePaise === null) {
    return { kind: "none", carryForwardHint: false, suppressCleared: false };
  }
  if (ledgerDuePaise < 0) {
    return { kind: "credit", carryForwardHint: false, suppressCleared: false };
  }
  if (dueDriftPaise > 0) {
    return { kind: "shortfall", carryForwardHint: true, suppressCleared: true };
  }
  if (dueDriftPaise < 0) {
    return { kind: "surplus", carryForwardHint: false, suppressCleared: false };
  }
  return { kind: "none", carryForwardHint: false, suppressCleared: false };
}

export interface ReconRowView {
  driftLine: { tone: "amber" | "muted"; text: string } | null;
  carryHint: string | null;
  showClearedBadge: boolean;
  badgeTitle: string;
}

/**
 * The one place `ReconciliationRow` decides what to render for statement-vs-
 * ledger drift — the JSX consumes this verbatim, with no rendering decisions
 * of its own. This repo has no DOM/component test harness (web tests are
 * plain `node --test` files), so this pure, exhaustively tested function IS
 * the regression coverage for the row (see tasks/cc-recon-01-statement-drift,
 * review-2/3).
 */
export function reconRowView(cycle: StatementReconciliation): ReconRowView {
  const presentation = driftPresentation(cycle.dueDriftPaise, cycle.ledgerDuePaise);
  const fullyCleared = cycle.lineCount > 0 && cycle.unmatchedCount === 0;

  let driftLine: ReconRowView["driftLine"] = null;
  if (presentation.kind === "shortfall") {
    driftLine = {
      tone: "amber",
      text:
        `${formatINR(cycle.dueDriftPaise!)} more due than the ledger shows ` +
        `(statement ${formatINR(cycle.totalDuePaise!)} · ledger ${formatINR(cycle.ledgerDuePaise!)})`,
    };
  } else if (presentation.kind === "credit") {
    driftLine = {
      tone: "muted",
      text: `Ledger shows this card ${formatINR(-cycle.ledgerDuePaise!)} in credit; statement due ${formatINR(cycle.totalDuePaise!)}`,
    };
  } else if (presentation.kind === "surplus") {
    driftLine = { tone: "muted", text: `ledger shows ${formatINR(-cycle.dueDriftPaise!)} more than the statement` };
  }

  return {
    driftLine,
    carryHint: presentation.carryForwardHint ? "balance carried from before this card was tracked?" : null,
    showClearedBadge: fullyCleared && !presentation.suppressCleared,
    badgeTitle: "all statement lines matched",
  };
}
