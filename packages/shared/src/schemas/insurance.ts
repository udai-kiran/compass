import { z } from "zod";

/**
 * Insurance is modelled as an account type (see AccountTypeSchema), with the
 * policy specifics kept in a 1:1 details table keyed by account — the same
 * pattern as bank_details / retirement_details. A policy is a tracking record,
 * not a balance-bearing account: premiums are paid *from* a bank/card account
 * and tagged to the policy (transactions.policyAccountId), so the policy's own
 * balance stays zero and it never lands in net worth.
 */
export const InsuranceKindSchema = z.enum(["life", "health", "vehicle"]);
export type InsuranceKind = z.infer<typeof InsuranceKindSchema>;

/** Only meaningful for kind = "vehicle"; null everywhere else. */
export const VehicleKindSchema = z.enum(["car", "bike", "other"]);
export type VehicleKind = z.infer<typeof VehicleKindSchema>;

/** How often the premium falls due. "single" = one-time / single-premium policy. */
export const PremiumFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
  "single",
]);
export type PremiumFrequency = z.infer<typeof PremiumFrequencySchema>;

export const InsuranceDetailsSchema = z.object({
  accountId: z.uuid(),
  kind: InsuranceKindSchema,
  /** car/bike/other for a vehicle policy; null for life/health */
  vehicleType: VehicleKindSchema.nullable(),
  policyNumber: z.string(),
  /** sum assured (life) / sum insured (health) / IDV (vehicle), in paise */
  coverPaise: z.number().int(),
  /** premium per payment, in paise */
  premiumPaise: z.number().int(),
  premiumFrequency: PremiumFrequencySchema,
  /** policy commencement date */
  startDate: z.iso.date().nullable(),
  /** next renewal / premium due date */
  renewalDate: z.iso.date().nullable(),
  /** maturity date for an endowment/money-back life policy; null for pure term, health, vehicle */
  maturityDate: z.iso.date().nullable(),
  nominee: z.string(),
});
export type InsuranceDetails = z.infer<typeof InsuranceDetailsSchema>;

export const UpsertInsuranceDetailsSchema = z
  .object({
    kind: InsuranceKindSchema.default("life"),
    vehicleType: VehicleKindSchema.nullable().default(null),
    policyNumber: z.string().max(60).default(""),
    coverPaise: z.number().int().min(0).default(0),
    premiumPaise: z.number().int().min(0).default(0),
    premiumFrequency: PremiumFrequencySchema.default("yearly"),
    startDate: z.iso.date().nullable().default(null),
    renewalDate: z.iso.date().nullable().default(null),
    maturityDate: z.iso.date().nullable().default(null),
    nominee: z.string().max(120).default(""),
  })
  .check((ctx) => {
    // A vehicle sub-type only belongs on a vehicle policy; a maturity date only
    // on a life policy (health/vehicle policies renew, they don't mature).
    if (ctx.value.kind !== "vehicle" && ctx.value.vehicleType !== null) {
      ctx.issues.push({
        code: "custom",
        path: ["vehicleType"],
        message: "vehicle type only applies to a vehicle policy",
        input: ctx.value.vehicleType,
      });
    }
    if (ctx.value.kind !== "life" && ctx.value.maturityDate !== null) {
      ctx.issues.push({
        code: "custom",
        path: ["maturityDate"],
        message: "only a life policy matures",
        input: ctx.value.maturityDate,
      });
    }
  });
export type UpsertInsuranceDetails = z.input<typeof UpsertInsuranceDetailsSchema>;

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
