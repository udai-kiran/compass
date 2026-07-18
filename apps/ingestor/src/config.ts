import { z } from "zod";

/**
 * The ingestor runs as its own container. Variable names match apps/api so one
 * .env drives everything. MAILBOX_SECRET (falling back to SESSION_SECRET)
 * decrypts the per-user OAuth client secret + refresh token stored by the API,
 * which mint access tokens for XOAUTH2. Client credentials are per user (in the
 * DB), not env — onboarding is the standalone `connect` CLI + the settings UI.
 */
const EnvSchema = z
  .object({
    DATABASE_URL: z.url({ error: "must be a postgresql:// connection URL" }),
    REDIS_URL: z.url({ error: "must be a redis:// connection URL" }),
    /** key for the mailbox-secret envelope; falls back to SESSION_SECRET */
    MAILBOX_SECRET: z.string().default(""),
    SESSION_SECRET: z.string().default(""),
    /** how often to re-poll each mailbox as an IDLE-safety net, seconds */
    POLL_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(120),
  })
  .transform((v) => ({ ...v, MAILBOX_SECRET: v.MAILBOX_SECRET || v.SESSION_SECRET }))
  .check((ctx) => {
    if (!ctx.value.MAILBOX_SECRET || ctx.value.MAILBOX_SECRET.length < 32) {
      ctx.issues.push({
        code: "custom",
        path: ["MAILBOX_SECRET"],
        message: "MAILBOX_SECRET (or SESSION_SECRET) must be at least 32 characters",
        input: ctx.value.MAILBOX_SECRET,
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(`Invalid ingestor configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  return result.data;
}
