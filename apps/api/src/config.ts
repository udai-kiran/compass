import { z } from "zod";

/**
 * Central environment configuration. Every external endpoint (Postgres, Redis)
 * and secret comes from the environment — no IP/hostname literals in source.
 * The API refuses to boot if a required variable is missing or invalid.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ error: "must be a postgresql:// connection URL" }),
    REDIS_URL: z.url({ error: "must be a redis:// connection URL" }),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    SESSION_SECRET: z.string().min(32, "must be at least 32 characters of random data"),
    STORAGE_DIR: z.string().default("./data/attachments"),
    BACKUP_DIR: z.string().default("./data/backups"),
    /** encryption key for backups; falls back to SESSION_SECRET when unset */
    BACKUP_KEY: z.string().default(""),
    AI_PROVIDER: z.enum(["none", "anthropic", "ollama"]).default("none"),
    ANTHROPIC_API_KEY: z.string().default(""),
    ANTHROPIC_MODEL: z.string().default(""),
    OLLAMA_BASE_URL: z.string().default(""),
    OLLAMA_MODEL: z.string().default(""),
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
     * Owner account provisioned by `npm run db:bootstrap` (the compose `migrate`
     * service). Only the bootstrap reads these — the API never does, so the
     * password is optional here and validated by the bootstrap itself.
     */
    OWNER_EMAIL: z.email().default("udaikiran@outlook.com"),
    OWNER_PASSWORD: z.string().default(""),
  })
  .check((ctx) => {
    if (ctx.value.AI_PROVIDER === "anthropic" && ctx.value.ANTHROPIC_API_KEY === "") {
      ctx.issues.push({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "required when AI_PROVIDER=anthropic",
        input: ctx.value.ANTHROPIC_API_KEY,
      });
    }
    if (ctx.value.AI_PROVIDER === "ollama" && ctx.value.OLLAMA_BASE_URL === "") {
      ctx.issues.push({
        code: "custom",
        path: ["OLLAMA_BASE_URL"],
        message: "required when AI_PROVIDER=ollama",
        input: ctx.value.OLLAMA_BASE_URL,
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
    console.error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        "Copy .env.example to .env and fill in the values.",
    );
    process.exit(1);
  }
  return result.data;
}
