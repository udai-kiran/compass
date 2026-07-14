import { z } from "zod";

export const HealthStatusSchema = z.object({
  ok: z.boolean(),
  postgres: z.boolean(),
  redis: z.boolean(),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
