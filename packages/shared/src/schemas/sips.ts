import { z } from "zod";
import { todayInIST } from "../date.ts";

/**
 * A goal-funding SIP: a recurring monthly transfer from a bank/savings account
 * into either an MF folio (an existing `holdings` row — already keyed by
 * scheme+folio) or another account (e.g. PPF/SSY deposits). A goal can have
 * several SIPs; the target is polymorphic but exactly one of `targetHoldingId`
 * / `targetAccountId` is set, matching `targetKind`.
 */
export const SipTargetKindSchema = z.enum(["mf_folio", "account"]);
export type SipTargetKind = z.infer<typeof SipTargetKindSchema>;

export const SipStatusSchema = z.enum(["active", "paused"]);
export type SipStatus = z.infer<typeof SipStatusSchema>;

/**
 * Where the SIP's money comes from. `bank_debit` is the default auto-debit
 * SIP; `payroll` (EPF) is a salary deduction recorded directly to the
 * retirement account from the payslip, with no bank leg — it must never be
 * subtracted again by the cash forecast, and is never manually recorded.
 */
export const SipFundingSourceSchema = z.enum(["bank_debit", "payroll"]);
export type SipFundingSource = z.infer<typeof SipFundingSourceSchema>;

/**
 * Debit cadence. Most MF SIPs are monthly; PPF/SSY are often funded with a
 * single lump quarterly/annual deposit instead — quarterly/yearly let those
 * still be modelled as a SIP. See sipOccurrencesInWindow for the anchoring rule.
 */
export const SipFrequencySchema = z.enum(["monthly", "quarterly", "yearly"]);
export type SipFrequency = z.infer<typeof SipFrequencySchema>;

export const SipSchema = z.object({
  id: z.uuid(),
  goalId: z.uuid(),
  sourceAccountId: z.uuid(),
  targetKind: SipTargetKindSchema,
  targetHoldingId: z.uuid().nullable(),
  targetAccountId: z.uuid().nullable(),
  amountPaise: z.number().int(),
  /** debit day of month */
  dayOfMonth: z.number().int().min(1).max(28),
  frequency: SipFrequencySchema,
  status: SipStatusSchema,
  fundingSource: SipFundingSourceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  /** Date of the most recently recorded installment for this SIP; null if none. */
  lastInstallmentDate: z.iso.date().nullable(),
  /**
   * The installment that has come due but has no recorded fund transaction
   * yet; null when nothing is outstanding. Computed server-side because the
   * cadence rules live in the API service — the UI must not re-derive them.
   */
  dueInstallmentDate: z.iso.date().nullable(),
});
export type Sip = z.infer<typeof SipSchema>;

const SipTargetShape = {
  targetKind: SipTargetKindSchema,
  targetHoldingId: z.uuid().nullable().default(null),
  targetAccountId: z.uuid().nullable().default(null),
};

/**
 * Exactly one of the two target refs must be set, matching `targetKind`. Pure
 * (no zod types) so both `.check()` callbacks below — whose `ctx` shapes zod
 * infers per-schema and don't unify — can share the one rule.
 */
function sipTargetIssue(
  targetKind: SipTargetKind,
  targetHoldingId: string | null,
  targetAccountId: string | null,
): { path: string; message: string } | null {
  if (targetKind === "mf_folio") {
    if (!targetHoldingId || targetAccountId) {
      return {
        path: "targetHoldingId",
        message: "targetHoldingId is required (and targetAccountId must be empty) for an mf_folio target",
      };
    }
    return null;
  }
  if (!targetAccountId || targetHoldingId) {
    return {
      path: "targetAccountId",
      message: "targetAccountId is required (and targetHoldingId must be empty) for an account target",
    };
  }
  return null;
}

/**
 * A payroll-funded SIP only makes sense for an account target (EPF/PPF/SSY):
 * `payroll` means the contribution is deducted from salary and recorded
 * directly to the retirement account from the payslip, with no bank leg, so
 * it's meaningless for an MF-folio target and would silently drop a real debit
 * from the 90-day cash forecast if allowed. Pure (no zod types), following
 * `sipTargetIssue`, so both the create schema's `.check()` and the update
 * service's resolved-pair validation (services/sips.ts) can share the rule.
 */
export function sipFundingSourceIssue(
  targetKind: SipTargetKind,
  fundingSource: SipFundingSource,
): { path: string; message: string } | null {
  if (fundingSource === "payroll" && targetKind !== "account") {
    return {
      path: "fundingSource",
      message: "a payroll-funded SIP must target an account (EPF/PPF/SSY), not an MF folio",
    };
  }
  return null;
}

/**
 * `endDate` must not be before `startDate`. Dates are `YYYY-MM-DD` ISO strings,
 * so a plain string comparison is chronological. `endDate === null` (open-ended)
 * always passes. Shared by the create schema's `.check()` and the update
 * service's resolved-pair validation (a partial update can invert the pair
 * without either field failing this rule on its own — see services/sips.ts).
 */
export function sipDateRangeValid(startDate: string, endDate: string | null): boolean {
  return endDate === null || endDate >= startDate;
}

export const CreateSipSchema = z
  .object({
    goalId: z.uuid(),
    sourceAccountId: z.uuid(),
    ...SipTargetShape,
    amountPaise: z.number().int().positive(),
    dayOfMonth: z.number().int().min(1).max(28),
    frequency: SipFrequencySchema.default("monthly"),
    fundingSource: SipFundingSourceSchema.default("bank_debit"),
    startDate: z.iso.date().default(() => defaultSipDate()),
    endDate: z.iso.date().nullable().default(null),
  })
  .check((ctx) => {
    const issue = sipTargetIssue(ctx.value.targetKind, ctx.value.targetHoldingId, ctx.value.targetAccountId);
    if (issue) {
      ctx.issues.push({ code: "custom", message: issue.message, input: ctx.value, path: [issue.path] });
    }
    if (!sipDateRangeValid(ctx.value.startDate, ctx.value.endDate)) {
      ctx.issues.push({
        code: "custom",
        message: "endDate must be on or after startDate",
        input: ctx.value,
        path: ["endDate"],
      });
    }
    const fundingIssue = sipFundingSourceIssue(ctx.value.targetKind, ctx.value.fundingSource);
    if (fundingIssue) {
      ctx.issues.push({ code: "custom", message: fundingIssue.message, input: ctx.value, path: [fundingIssue.path] });
    }
  });
export type CreateSip = z.input<typeof CreateSipSchema>;

export const UpdateSipSchema = z
  .object({
    sourceAccountId: z.uuid().optional(),
    targetKind: SipTargetKindSchema.optional(),
    targetHoldingId: z.uuid().nullable().optional(),
    targetAccountId: z.uuid().nullable().optional(),
    amountPaise: z.number().int().positive().optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    frequency: SipFrequencySchema.optional(),
    status: SipStatusSchema.optional(),
    fundingSource: SipFundingSourceSchema.optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().nullable().optional(),
  })
  .check((ctx) => {
    const { targetKind, targetHoldingId, targetAccountId } = ctx.value;
    // Only validated when the caller is touching the target at all — a plain
    // amount/day/status edit shouldn't have to resend the whole target.
    if (targetKind === undefined && targetHoldingId === undefined && targetAccountId === undefined) {
      return;
    }
    if (targetKind === undefined) {
      ctx.issues.push({
        code: "custom",
        message: "targetKind is required when changing the SIP target",
        input: ctx.value,
        path: ["targetKind"],
      });
      return;
    }
    const issue = sipTargetIssue(targetKind, targetHoldingId ?? null, targetAccountId ?? null);
    if (issue) {
      ctx.issues.push({ code: "custom", message: issue.message, input: ctx.value, path: [issue.path] });
    }
  });
export type UpdateSip = z.infer<typeof UpdateSipSchema>;

/**
 * The calendar date a SIP date field defaults to: today in **IST**, not UTC.
 *
 * A plain `new Date().toISOString().slice(0, 10)` is the UTC day, which for the
 * first 5½ hours of every IST day is still *yesterday* — an API client that
 * omitted the field would silently book an installment (or start a SIP) one day
 * early. `now` is injectable purely so this is testable at a fixed instant:
 * a test comparing against a live `todayInIST()` can only catch the UTC bug
 * during that 00:00–05:29 IST window and would otherwise pass either way.
 */
export function defaultSipDate(now: Date = new Date()): string {
  return todayInIST(now);
}

/**
 * Units bought by an installment. MF platforms allot units to 3–4 decimals;
 * this rounds to 4. `nav` is rupees per unit (matching holding_valuations.nav
 * and the AMFI feed), while the amount is paise — hence the /100.
 */
export function unitsForInstallment(amountPaise: number, nav: number): number {
  if (!(nav > 0)) throw new Error("nav must be positive");
  return Math.round((amountPaise / 100 / nav) * 10000) / 10000;
}

/**
 * Recording an actual buy against a SIP's target folio when an installment
 * goes through. Exactly one of `units` / `nav` is provided: hand the platform's
 * allotted units straight through, or hand the NAV and let `unitsForInstallment`
 * derive units from the (possibly overridden) amount. `amountPaise: null`
 * means "use the SIP's own amount" (the common case — a debit that matched
 * the plan), not "zero".
 */
export const RecordSipInstallmentSchema = z
  .object({
    /** Defaults to today in IST, not UTC — see defaultSipDate. */
    date: z.iso.date().default(() => defaultSipDate()),
    amountPaise: z.number().int().positive().nullable().default(null),
    units: z.number().positive().nullable().default(null),
    nav: z.number().positive().nullable().default(null),
    note: z.string().default(""),
  })
  .check((ctx) => {
    const { units, nav } = ctx.value;
    if (units === null && nav === null) {
      ctx.issues.push({
        code: "custom",
        message: "provide either units or nav",
        input: ctx.value,
        path: ["units"],
      });
    } else if (units !== null && nav !== null) {
      ctx.issues.push({
        code: "custom",
        message: "provide units or nav, not both",
        input: ctx.value,
        path: ["units"],
      });
    }
  });
export type RecordSipInstallment = z.input<typeof RecordSipInstallmentSchema>;

/**
 * Recording an account-target (PPF/SSY) installment by pointing at a ledger
 * transaction that already exists, rather than by creating one: the deposit is
 * a real bank→scheme transfer the user has already entered (or imported), so
 * the SIP stamps that row instead of duplicating it. Contrast
 * `RecordSipInstallmentSchema`, which books a brand-new `holding_events` buy
 * for an MF folio.
 */
export const LinkSipInstallmentSchema = z.object({ transactionId: z.uuid() });
export type LinkSipInstallment = z.infer<typeof LinkSipInstallmentSchema>;

/**
 * A ledger transaction offered as a possible installment for an account-target
 * SIP. Deliberately a narrow projection rather than the full `TransactionSchema`
 * — the picker only needs enough to identify a deposit, and the candidate rules
 * (which account, which sign, which date window) stay server-side.
 */
export const SipInstallmentCandidateSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  /**
   * Positive for every *unlinked* candidate — only credits into the target
   * account are offered as new installments. A row that is already `linked` can
   * come back zero or negative, because a later edit can flip the sign of a
   * transaction this SIP already claimed and the linked side deliberately keeps
   * showing it so it can be detached (see `linkedInstallmentRows`).
   */
  amountPaise: z.number().int(),
  merchant: z.string(),
  notes: z.string(),
  /**
   * True when this row is *already* this SIP's recorded installment. The picker
   * lists these alongside the free ones so a mislink can be undone from the same
   * place — the (sip, date) unique index means the wrong row must be detached
   * before the right one can take its slot. A row linked to a *different* SIP is
   * never returned at all.
   */
  linked: z.boolean(),
});
export type SipInstallmentCandidate = z.infer<typeof SipInstallmentCandidateSchema>;
