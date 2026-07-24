import { z } from "zod";

// ---------- Family & Profile ----------

export const FamilyRelationshipSchema = z.enum([
  "spouse",
  "child",
  "parent",
  "sibling",
  "other",
]);
export type FamilyRelationship = z.infer<typeof FamilyRelationshipSchema>;

export const EducationStageSchema = z.enum([
  "preschool",
  "primary",
  "secondary",
  "senior_secondary",
  "undergraduate",
  "postgraduate",
  "doctorate",
  "other",
]);
export type EducationStage = z.infer<typeof EducationStageSchema>;

const COMPLETION_YEAR_MIN = 1950;
const COMPLETION_YEAR_MAX = 2100;

export const UserProfileSchema = z.object({
  dateOfBirth: z.iso.date().nullable(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateUserProfileSchema = UserProfileSchema;
export type UpdateUserProfile = z.infer<typeof UpdateUserProfileSchema>;

export const FamilyMemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  relationship: FamilyRelationshipSchema,
  dateOfBirth: z.iso.date().nullable(),
  educationStage: EducationStageSchema.nullable(),
  institution: z.string().nullable(),
  courseOrStream: z.string().nullable(),
  expectedCompletionYear: z.number().int().min(COMPLETION_YEAR_MIN).max(COMPLETION_YEAR_MAX).nullable(),
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type FamilyMember = z.infer<typeof FamilyMemberSchema>;

export const CreateFamilyMemberSchema = z.object({
  name: z.string().min(1),
  relationship: FamilyRelationshipSchema,
  dateOfBirth: z.iso.date().nullable().default(null),
  educationStage: EducationStageSchema.nullable().default(null),
  institution: z.string().nullable().default(null),
  courseOrStream: z.string().nullable().default(null),
  expectedCompletionYear: z.number().int().min(COMPLETION_YEAR_MIN).max(COMPLETION_YEAR_MAX).nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type CreateFamilyMember = z.input<typeof CreateFamilyMemberSchema>;

export const UpdateFamilyMemberSchema = z.object({
  name: z.string().min(1).optional(),
  relationship: FamilyRelationshipSchema.optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  educationStage: EducationStageSchema.nullable().optional(),
  institution: z.string().nullable().optional(),
  courseOrStream: z.string().nullable().optional(),
  expectedCompletionYear: z.number().int().min(COMPLETION_YEAR_MIN).max(COMPLETION_YEAR_MAX).nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateFamilyMember = z.infer<typeof UpdateFamilyMemberSchema>;
