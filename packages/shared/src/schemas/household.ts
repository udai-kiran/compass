import { z } from "zod";

export const HouseholdRoleSchema = z.enum(["owner", "member"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdByUserId: z.uuid(),
  createdAt: z.coerce.date(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;

export const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;

export const HouseholdMemberSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  role: HouseholdRoleSchema,
  joinedAt: z.coerce.date(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const HouseholdInviteSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  token: z.string(),
  expiresAt: z.coerce.date(),
  accepted: z.boolean(),
  createdAt: z.coerce.date(),
});
export type HouseholdInvite = z.infer<typeof HouseholdInviteSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

export const SharingResourceTypeSchema = z.enum([
  "account",
  "goal",
  "holding",
  "insurance_policy",
  "budget",
]);
export type SharingResourceType = z.infer<typeof SharingResourceTypeSchema>;

export const SharingGrantSchema = z.object({
  id: z.uuid(),
  resourceType: SharingResourceTypeSchema,
  resourceId: z.uuid(),
  ownerUserId: z.uuid(),
  grantedToUserId: z.uuid(),
  householdId: z.uuid(),
  createdAt: z.coerce.date(),
});
export type SharingGrant = z.infer<typeof SharingGrantSchema>;

export const CreateSharingGrantSchema = z.object({
  resourceType: SharingResourceTypeSchema,
  resourceId: z.uuid(),
  grantedToUserId: z.uuid(),
  householdId: z.uuid(),
});
export type CreateSharingGrant = z.infer<typeof CreateSharingGrantSchema>;

export const SplitRuleSchema = z.enum(["equal", "shares", "exact"]);
export type SplitRule = z.infer<typeof SplitRuleSchema>;

export const HouseholdSplitShareSchema = z.object({
  id: z.uuid(),
  splitId: z.uuid(),
  personId: z.uuid(),
  sharePaise: z.number().int(),
  createdAt: z.coerce.date(),
});
export type HouseholdSplitShare = z.infer<typeof HouseholdSplitShareSchema>;

export const HouseholdSplitSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  householdId: z.uuid(),
  rule: SplitRuleSchema,
  payerPersonId: z.uuid(),
  createdByUserId: z.uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  shares: z.array(HouseholdSplitShareSchema),
});
export type HouseholdSplit = z.infer<typeof HouseholdSplitSchema>;

export const CreateHouseholdSplitSchema = z.object({
  householdId: z.uuid(),
  rule: SplitRuleSchema,
  totalPaise: z.number().int().positive(),
  payerPersonId: z.uuid(),
  memberPersonIds: z.array(z.uuid()).min(2),
  sharePaise: z.array(z.number().int().nonnegative()).optional(),
  ratios: z.array(z.number().int().positive()).optional(),
});
export type CreateHouseholdSplit = z.infer<typeof CreateHouseholdSplitSchema>;

export const UpdateHouseholdSplitSchema = z.object({
  rule: SplitRuleSchema.optional(),
  totalPaise: z.number().int().positive().optional(),
  payerPersonId: z.uuid().optional(),
  memberPersonIds: z.array(z.uuid()).min(2).optional(),
  sharePaise: z.array(z.number().int().nonnegative()).optional(),
  ratios: z.array(z.number().int().positive()).optional(),
});
export type UpdateHouseholdSplit = z.infer<typeof UpdateHouseholdSplitSchema>;

export const SettlementSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  fromPersonId: z.uuid(),
  toPersonId: z.uuid(),
  amountPaise: z.number().int().positive(),
  transferTransactionId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const CreateSettlementSchema = z.object({
  fromPersonId: z.uuid(),
  toPersonId: z.uuid(),
  amountPaise: z.number().int().positive(),
  note: z.string().optional(),
}).refine(d => d.fromPersonId !== d.toPersonId, { message: "fromPersonId and toPersonId must be different" });
export type CreateSettlement = z.infer<typeof CreateSettlementSchema>;

export const HouseholdBalancesSchema = z.record(z.string(), z.number().int());
export type HouseholdBalances = z.infer<typeof HouseholdBalancesSchema>;
