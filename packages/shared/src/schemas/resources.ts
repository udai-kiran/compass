import { z } from "zod";

export const ResourceKindSchema = z.enum([
  "vehicle",
  "electricity",
  "mobile",
  "internet",
  "gas",
  "water",
  "other",
]);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const ResourceSchema = z.object({
  id: z.uuid(),
  kind: ResourceKindSchema,
  name: z.string(),
  identifier: z.string(),
  provider: z.string(),
  planName: z.string(),
  details: z.string(),
  archived: z.boolean(),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const CreateResourceSchema = z.object({
  kind: ResourceKindSchema,
  name: z.string().trim().min(1).max(120),
  identifier: z.string().trim().max(120).default(""),
  provider: z.string().trim().max(120).default(""),
  planName: z.string().trim().max(120).default(""),
  details: z.string().trim().max(500).default(""),
});
export type CreateResource = z.infer<typeof CreateResourceSchema>;

export const UpdateResourceSchema = CreateResourceSchema.partial().extend({
  archived: z.boolean().optional(),
});
export type UpdateResource = z.infer<typeof UpdateResourceSchema>;
