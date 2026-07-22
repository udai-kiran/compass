import { z } from "zod";

/**
 * Central environment configuration. Every external endpoint (Postgres, Redis)
 * and secret comes from the environment — no IP/hostname literals in source.
 * The API refuses to boot if a required variable is missing or invalid.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ error: "must be a postgresql:// connection URL" }),
  REDIS_URL: z.url({ error: "must be a redis:// connection URL" }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters of random data"),
  STORAGE_DIR: z.string().default("./data/attachments"),
  /**
   * S3-compatible object storage for uploaded files (MinIO in prod). When
   * S3_ENDPOINT is set, files live in the bucket; otherwise they fall back to
   * STORAGE_DIR on disk (handy for local dev without MinIO running).
   */
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default("compass-files"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  /** MinIO needs path-style URLs (bucket in the path, not the host). */
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  BACKUP_DIR: z.string().default("./data/backups"),
  /** encryption key for backups; falls back to SESSION_SECRET when unset */
  BACKUP_KEY: z.string().default(""),
  /**
   * Encryption key for mailbox secrets (OAuth client secret + refresh token);
   * falls back to SESSION_SECRET when unset. Must match the ingestor's
   * MAILBOX_SECRET so it can decrypt what the API stored.
   */
  MAILBOX_SECRET: z.string().default(""),
  /** Comma-separated AI base URLs users may select for Ollama/custom providers. */
  AI_ALLOWED_BASE_URLS: z.string().default(""),
  /**
   * Extra browser origins allowed to make state-changing (CSRF-relevant)
   * requests, comma-separated (e.g. "https://compass.example.com"). Same-host
   * origins are always allowed, so this is only needed when the SPA is served
   * from a different host than the API.
   */
  TRUSTED_ORIGINS: z.string().default(""),
  /** disable rate limiting (useful for load tests); always off under NODE_ENV=test */
  RATE_LIMIT_DISABLED: z.stringbool().default(false),
  /**
   * Expose a public, read-only demo account. When true, /api/auth/demo mints a
   * read-only session for a seeded "demo" user (created on first use), and the
   * login/welcome screens offer a "Explore the demo" entry. Every write from a
   * demo session is rejected, so the demo data can never be altered.
   */
  DEMO_ENABLED: z.stringbool().default(false),
  /**
   * Allow open self-service registration. When true, anyone who can reach the
   * instance may create their own account (`POST /api/auth/register`); every
   * account's data stays isolated by user_id and registration is rate-limited.
   * Set false to lock the instance to its existing users (the register route then
   * 403s and the UI hides the "Create account" call to action).
   */
  SIGNUP_ENABLED: z.stringbool().default(true),
  /** Login for the seeded demo user; kept out of the owner-bootstrap count. */
  DEMO_EMAIL: z.email().default("demo@compass.app"),
  /**
   * Owner account provisioned by `npm run db:bootstrap` (the compose `migrate`
   * service). Only the bootstrap reads these — the API never does, so the
   * password is optional here and validated by the bootstrap itself.
   */
  OWNER_EMAIL: z.email().default("udaikiran@outlook.com"),
  OWNER_PASSWORD: z.string().default(""),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        "Copy .env.example to .env and fill in the values.",
    );
    process.exit(1);
  }
  return result.data;
}
