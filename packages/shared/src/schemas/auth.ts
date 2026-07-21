import { z } from "zod";
import { AiProviderSchema } from "./ai.ts";

export const RegisterRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1),
});

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  /** the read-only demo account — the UI shows a banner and blocks edits */
  isDemo: z.boolean().default(false),
});

export const BootstrapStatusSchema = z.object({
  needsBootstrap: z.boolean(),
  /** whether the public demo entry (/api/auth/demo) is available */
  demoAvailable: z.boolean().default(false),
});

export const UpdateProfileSchema = z.object({ displayName: z.string().min(1) });

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const SessionInfoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  current: z.boolean(),
});

export const CapabilitiesSchema = z.object({
  aiProvider: AiProviderSchema,
  aiEnabled: z.boolean(),
  features: z.object({
    categorization: z.boolean(),
    assistant: z.boolean(),
    summaries: z.boolean(),
  }),
  /** display-only in v1: single currency, formatting locale */
  currency: z.string(),
  locale: z.string(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type User = z.infer<typeof UserSchema>;
export type BootstrapStatus = z.infer<typeof BootstrapStatusSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
