import { z } from "zod";

/**
 * The extractor runs as its own container, so it loads its own environment —
 * but the variable names match apps/api exactly so a single .env drives both.
 * Only what this worker actually needs is required here.
 */
const EnvSchema = z
  .object({
    DATABASE_URL: z.url({ error: "must be a postgresql:// connection URL" }),
    REDIS_URL: z.url({ error: "must be a redis:// connection URL" }),
    /** worker concurrency — how many emails to extract in parallel */
    EXTRACT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    AI_PROVIDER: z.enum(["none", "anthropic", "ollama", "openrouter", "deepseek"]).default("none"),
    ANTHROPIC_API_KEY: z.string().default(""),
    ANTHROPIC_MODEL: z.string().default(""),
    OLLAMA_BASE_URL: z.string().default(""),
    OLLAMA_MODEL: z.string().default(""),
    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_MODEL: z.string().default(""),
    DEEPSEEK_API_KEY: z.string().default(""),
    DEEPSEEK_MODEL: z.string().default(""),
  })
  .check((ctx) => {
    if (ctx.value.AI_PROVIDER === "none") {
      ctx.issues.push({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "the extractor needs a real AI provider (anthropic | ollama | openrouter | deepseek)",
        input: ctx.value.AI_PROVIDER,
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
    console.error(`Invalid extractor configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  return result.data;
}
