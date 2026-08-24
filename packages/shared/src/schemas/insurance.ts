import { z } from "zod";

/**
 * Insurance is its own entity, not an account. A policy is a standalone record
 * (see the `insurance_policies` table) with its own fields — insurer, policy
 * number, sum assured, bonus, dates. Premiums are paid from a bank/card account
 * and tagged to the policy (transactions.policy_id), so a policy shows its
 * premium history and paid-to-date total without ever holding a balance.
 */
export const InsuranceKindSchema = z.enum(["life", "health", "vehicle"]);
export type InsuranceKind = z.infer<typeof InsuranceKindSchema>;

/** Only meaningful for kind = "vehicle"; null everywhere else. */
export const VehicleKindSchema = z.enum(["car", "bike", "other"]);
export type VehicleKind = z.infer<typeof VehicleKindSchema>;

/**
 * Health-policy sub-type. Only meaningful for kind = "health"; null elsewhere.
 * The core divide is indemnity (reimburses actual bills, up to the sum insured)
 * vs. fixed-benefit (pays a defined lump sum on a trigger). See isFixedBenefit —
 * the "cover" figure is a drawdown ceiling for indemnity, a guaranteed payout for
 * fixed-benefit, so the two shouldn't be totalled as if they were the same thing.
 */
export const HealthTypeSchema = z.enum([
  "indemnity",
  "top_up",
  "critical_illness",
  "hospital_cash",
  "personal_accident",
  "disease_specific",
]);
export type HealthType = z.infer<typeof HealthTypeSchema>;

/** Indemnity types reimburse costs; the rest pay a fixed benefit on a trigger. */
export function isFixedBenefit(healthType: HealthType): boolean {
  return healthType !== "indemnity" && healthType !== "top_up";
}

/** How often the premium falls due. "single" = one-time / single-premium policy. */
export const PremiumFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "single",
]);
export type PremiumFrequency = z.infer<typeof PremiumFrequencySchema>;

/** An uploaded health card (family-floater: one per covered member). */
export const HealthCardSchema = z.object({
  id: z.uuid(),
  /** the member this card is for; "" when unlabeled */
  label: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type HealthCard = z.infer<typeof HealthCardSchema>;

export const InsurancePolicySchema = z.object({
  id: z.uuid(),
  /** a short label for lists, e.g. "LIC Jeevan Anand" */
  name: z.string(),
  kind: InsuranceKindSchema,
  /** car/bike/other for a vehicle policy; null for life/health */
  vehicleType: VehicleKindSchema.nullable(),
  /** vehicle registration number (e.g. "KA01AB1234"); "" for non-vehicle policies */
  vehicleRegNo: z.string(),
  resourceId: z.uuid().nullable(),
  /** indemnity/critical-illness/etc. for a health policy; null for life/vehicle */
  healthType: HealthTypeSchema.nullable(),
  /** insurance company, e.g. "LIC", "Star Health", "ICICI Lombard" */
  insurer: z.string(),
  policyNumber: z.string(),
  /** URL to the policy wordings / terms document; "" when unset. Meant to be
   *  machine-readable later — an agent can fetch and read the actual terms. */
  policyWordingUrl: z.string(),
  /** sum assured (life) / sum insured (health) / IDV (vehicle), in paise */
  sumAssuredPaise: z.number().int(),
  /** accrued bonus / loyalty additions (endowment life), in paise */
  bonusPaise: z.number().int(),
  /** premium per payment, in paise */
  premiumPaise: z.number().int(),
  premiumFrequency: PremiumFrequencySchema,
  /** policy commencement ("started from") */
  startDate: z.iso.date().nullable(),
  /** next renewal / premium due date */
  renewalDate: z.iso.date().nullable(),
  /** maturity date for an endowment/money-back life policy; null for term/health/vehicle */
  maturityDate: z.iso.date().nullable(),
  nominee: z.string(),
  nomineePersonId: z.uuid().nullable(),
  coveredPersonIds: z.array(z.uuid()),
  /** people covered by the policy (e.g. a family-floater's members) */
  coveredMembers: z.array(z.string()),
  /** uploaded policy document metadata; null fields when no file is attached */
  documentName: z.string().nullable(),
  documentMime: z.string().nullable(),
  documentSizeBytes: z.number().int().nullable(),
  /** uploaded health cards (health policies; one per member) */
  healthCards: z.array(HealthCardSchema),
  notes: z.string(),
  archived: z.boolean(),
});
export type InsurancePolicy = z.infer<typeof InsurancePolicySchema>;

/** Shared field set for create/update, plus the consistency rules between them. */
const policyFields = {
  name: z.string().min(1).max(120),
  kind: InsuranceKindSchema.default("life"),
  vehicleType: VehicleKindSchema.nullable().default(null),
  vehicleRegNo: z.string().max(20).default(""),
  resourceId: z.uuid().nullable().default(null),
  healthType: HealthTypeSchema.nullable().default(null),
  insurer: z.string().max(120).default(""),
  policyNumber: z.string().max(60).default(""),
  /** a real URL, or "" to leave it unset */
  policyWordingUrl: z.union([z.url(), z.literal("")]).default(""),
  sumAssuredPaise: z.number().int().min(0).default(0),
  bonusPaise: z.number().int().min(0).default(0),
  premiumPaise: z.number().int().min(0).default(0),
  premiumFrequency: PremiumFrequencySchema.default("yearly"),
  startDate: z.iso.date().nullable().default(null),
  renewalDate: z.iso.date().nullable().default(null),
  maturityDate: z.iso.date().nullable().default(null),
  nominee: z.string().max(120).default(""),
  nomineePersonId: z.uuid().nullable().default(null),
  coveredPersonIds: z.array(z.uuid()).optional(),
  /** covered members, each a non-empty name; up to 20 */
  coveredMembers: z.array(z.string().min(1).max(120)).max(20).default([]),
  notes: z.string().max(1000).default(""),
};

// Sub-types belong only to their kind; a maturity date only to a life policy
// (health/vehicle renew, they don't mature). Applied to both create and update.
type PolicyConsistency = {
  kind: InsuranceKind;
  vehicleType: VehicleKind | null;
  vehicleRegNo: string;
  healthType: HealthType | null;
  maturityDate: string | null;
};
function checkPolicyConsistency(value: PolicyConsistency, issues: z.core.$ZodRawIssue[]) {
  if (value.kind !== "vehicle" && value.vehicleType !== null) {
    issues.push({
      code: "custom",
      path: ["vehicleType"],
      message: "vehicle type only applies to a vehicle policy",
      input: value.vehicleType,
    });
  }
  if (value.kind !== "vehicle" && value.vehicleRegNo !== "") {
    issues.push({
      code: "custom",
      path: ["vehicleRegNo"],
      message: "registration number only applies to a vehicle policy",
      input: value.vehicleRegNo,
    });
  }
  if (value.kind !== "health" && value.healthType !== null) {
    issues.push({
      code: "custom",
      path: ["healthType"],
      message: "health type only applies to a health policy",
      input: value.healthType,
    });
  }
  if (value.kind !== "life" && value.maturityDate !== null) {
    issues.push({
      code: "custom",
      path: ["maturityDate"],
      message: "only a life policy matures",
      input: value.maturityDate,
    });
  }
}

export const CreateInsurancePolicySchema = z
  .object(policyFields)
  .check((ctx) => checkPolicyConsistency(ctx.value, ctx.issues));
export type CreateInsurancePolicy = z.input<typeof CreateInsurancePolicySchema>;

export const UpdateInsurancePolicySchema = z
  .object({ ...policyFields, archived: z.boolean().default(false) })
  .check((ctx) => checkPolicyConsistency(ctx.value, ctx.issues));
export type UpdateInsurancePolicy = z.input<typeof UpdateInsurancePolicySchema>;

// ---------- Premium payments (the link to expenses) ----------

/** One premium payment logged against a policy — a real expense on the paying account. */
export const PremiumPaymentSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  /** signed like any transaction: an outflow, so negative */
  amountPaise: z.number().int(),
  merchant: z.string(),
  /** the account the money was paid from (bank/card/cash) */
  accountId: z.uuid(),
  note: z.string(),
});
export type PremiumPayment = z.infer<typeof PremiumPaymentSchema>;

export const PolicyPremiumsSchema = z.object({
  items: z.array(PremiumPaymentSchema),
  /** magnitude of all premiums paid, in paise */
  totalPaise: z.number().int(),
  count: z.number().int(),
});
export type PolicyPremiums = z.infer<typeof PolicyPremiumsSchema>;

/** Log a premium: creates an expense on `fromAccountId`, tagged to the policy. */
export const LogPremiumSchema = z.object({
  fromAccountId: z.uuid(),
  date: z.iso.date(),
  /** positive magnitude; stored as a negative (outflow) transaction */
  amountPaise: z.number().int().positive(),
  note: z.string().max(200).default(""),
});
export type LogPremium = z.input<typeof LogPremiumSchema>;
