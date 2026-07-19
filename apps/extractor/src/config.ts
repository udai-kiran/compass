import { z } from "zod";

/**
 * The extractor runs as its own container, so it loads its own environment —
 * but the variable names match apps/api exactly so a single .env drives both.
 * Only what this worker actually needs is required here.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.url({ error: "must be a postgresql:// connection URL" }),
  REDIS_URL: z.url({ error: "must be a redis:// connection URL" }),
  /** worker concurrency — how many emails to extract in parallel */
  EXTRACT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  /**
   * Decrypts the per-user AI API key from ai_settings; must match the API's
   * MAILBOX_SECRET (falls back to SESSION_SECRET, same as the API). The AI
   * provider itself is configured per user in Settings, not via env.
   */
  MAILBOX_SECRET: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  AI_ALLOWED_BASE_URLS: z.string().default(""),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(`Invalid extractor configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  return result.data;
}
