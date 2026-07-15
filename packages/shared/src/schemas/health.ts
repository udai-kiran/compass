import { z } from "zod";

/** Build provenance baked into each image at build time (see the app Dockerfiles). */
export const BuildInfoSchema = z.object({
  version: z.string(), // git describe output, e.g. "v1.2.0" or "v1.2.0-3-gabc123"; "dev" locally
  gitSha: z.string(), // full commit SHA, "unknown" locally
  builtAt: z.string(), // ISO-8601 build timestamp, "" locally
});

export type BuildInfo = z.infer<typeof BuildInfoSchema>;

export const HealthStatusSchema = z.object({
  ok: z.boolean(),
  postgres: z.boolean(),
  redis: z.boolean(),
  build: BuildInfoSchema,
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
