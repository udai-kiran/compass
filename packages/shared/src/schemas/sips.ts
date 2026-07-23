import { z } from "zod";

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
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
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
    startDate: z.iso.date().default(() => new Date().toISOString().slice(0, 10)),
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
