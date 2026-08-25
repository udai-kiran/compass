/**
 * Pure, DB-free claim-readiness logic for insurance policies (task 14.1).
 * Waiting-period end dates and the readiness checklist are computed from
 * plain values so they're unit-testable without a database — the
 * functional-core pattern in TDD.md.
 */

/** Adds whole days to an ISO date. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Adds whole months to an ISO date, clamping to the target month's last day
 * (e.g. 31-Jan + 1 month → 28/29-Feb, never rolling into March).
 */
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = m - 1 + months;
  const targetYear = y + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12; // 0-11
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}

export type WaitingPeriodEndDates = {
  initialWaitingEndDate: string | null;
  preExistingWaitingEndDate: string | null;
  maternityWaitingEndDate: string | null;
};

/**
 * The date each waiting period lapses, from the policy's start date. Null
 * when the policy has no start date, or the particular waiting period isn't
 * set (non-health policies leave all three null).
 */
export function computeWaitingPeriodEndDates(input: {
  startDate: string | null;
  initialWaitingDays: number | null;
  preExistingWaitingMonths: number | null;
  maternityWaitingMonths: number | null;
}): WaitingPeriodEndDates {
  const { startDate, initialWaitingDays, preExistingWaitingMonths, maternityWaitingMonths } = input;
  if (!startDate) {
    return { initialWaitingEndDate: null, preExistingWaitingEndDate: null, maternityWaitingEndDate: null };
  }
  return {
    initialWaitingEndDate: initialWaitingDays != null ? addDaysIso(startDate, initialWaitingDays) : null,
    preExistingWaitingEndDate:
      preExistingWaitingMonths != null ? addMonthsIso(startDate, preExistingWaitingMonths) : null,
    maternityWaitingEndDate:
      maternityWaitingMonths != null ? addMonthsIso(startDate, maternityWaitingMonths) : null,
  };
}

export type ClaimReadinessItem = {
  key: string;
  label: string;
  ready: boolean;
  /** The specific missing artifact/action, named — null once ready. */
  missingArtifact: string | null;
};

export type ClaimReadinessInput = {
  kind: "life" | "health" | "vehicle";
  /** today's date in IST, as YYYY-MM-DD */
  today: string;
  hasDocument: boolean;
  healthCardCount: number;
  tpaName: string;
  renewalDate: string | null;
  disclosuresComplete: boolean;
  nominee: string;
  nomineePersonId: string | null;
  initialWaitingDays: number | null;
  preExistingWaitingMonths: number | null;
  maternityWaitingMonths: number | null;
  waitingEndDates: WaitingPeriodEndDates;
};

/**
 * The claim-readiness checklist: what's on file today, and — for anything
 * not ready — the specific artifact or wait still outstanding. Health-only
 * items (card, TPA, disclosures, waiting periods) are omitted entirely for
 * life/vehicle policies rather than reported as false failures.
 */
export function computeClaimReadiness(input: ClaimReadinessInput): ClaimReadinessItem[] {
  const items: ClaimReadinessItem[] = [];

  items.push({
    key: "document",
    label: "Policy document on file",
    ready: input.hasDocument,
    missingArtifact: input.hasDocument ? null : "Policy document (PDF/scan)",
  });

  const hasNominee = input.nominee.trim() !== "" || input.nomineePersonId !== null;
  items.push({
    key: "nominee",
    label: "Nominee on record",
    ready: hasNominee,
    missingArtifact: hasNominee ? null : "Nominee name or linked family member",
  });

  const renewalCurrent = input.renewalDate === null || input.renewalDate >= input.today;
  items.push({
    key: "renewal",
    label: "Renewal current",
    ready: renewalCurrent,
    missingArtifact: renewalCurrent ? null : `Renewal payment (was due ${input.renewalDate})`,
  });

  if (input.kind !== "health") return items;

  items.push({
    key: "health-card",
    label: "Health ID card on file",
    ready: input.healthCardCount > 0,
    missingArtifact: input.healthCardCount > 0 ? null : "Health/e-card upload",
  });

  const hasTpa = input.tpaName.trim() !== "";
  items.push({
    key: "tpa-contact",
    label: "TPA / network contact on file",
    ready: hasTpa,
    missingArtifact: hasTpa ? null : "TPA name and contact",
  });

  items.push({
    key: "disclosures",
    label: "Proposal-form disclosures confirmed complete",
    ready: input.disclosuresComplete,
    missingArtifact: input.disclosuresComplete
      ? null
      : "Confirm medical-history disclosures were made in full",
  });

  const waitingChecks: Array<{
    key: string;
    label: string;
    set: number | null;
    endDate: string | null;
  }> = [
    {
      key: "waiting-initial",
      label: "Initial waiting period elapsed",
      set: input.initialWaitingDays,
      endDate: input.waitingEndDates.initialWaitingEndDate,
    },
    {
      key: "waiting-pre-existing",
      label: "Pre-existing-disease waiting period elapsed",
      set: input.preExistingWaitingMonths,
      endDate: input.waitingEndDates.preExistingWaitingEndDate,
    },
    {
      key: "waiting-maternity",
      label: "Maternity waiting period elapsed",
      set: input.maternityWaitingMonths,
      endDate: input.waitingEndDates.maternityWaitingEndDate,
    },
  ];
  for (const w of waitingChecks) {
    // Omit entirely when the waiting period isn't set (0 or null) — nothing to wait out.
    if (w.set == null || w.set <= 0) continue;
    const ready = w.endDate !== null && w.endDate <= input.today;
    items.push({
      key: w.key,
      label: w.label,
      ready,
      missingArtifact: ready ? null : `Waiting period runs to ${w.endDate}`,
    });
  }

  return items;
}
