import { Worker } from "bullmq";
import { createAiProvider } from "@compass/ai";
import { EXTRACT_QUEUE, ExtractJobSchema } from "@compass/shared";
import { loadConfig } from "./config.ts";
import { createPool, loadAccounts, loadIngestion, saveResults, setStatus } from "./db.ts";
import { parseEmail } from "./email.ts";
import { runExtraction } from "./extract.ts";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const ai = createAiProvider({
  provider: config.AI_PROVIDER,
  anthropicApiKey: config.ANTHROPIC_API_KEY,
  anthropicModel: config.ANTHROPIC_MODEL,
  ollamaBaseUrl: config.OLLAMA_BASE_URL,
  ollamaModel: config.OLLAMA_MODEL,
  openrouterApiKey: config.OPENROUTER_API_KEY,
  openrouterModel: config.OPENROUTER_MODEL,
  deepseekApiKey: config.DEEPSEEK_API_KEY,
  deepseekModel: config.DEEPSEEK_MODEL,
});

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
}

const worker = new Worker(
  EXTRACT_QUEUE,
  async (job) => {
    const { ingestionId } = ExtractJobSchema.parse(job.data);
    const ingestion = await loadIngestion(pool, ingestionId);
    if (!ingestion) {
      log("warn", "ingestion not found — nothing to extract", { ingestionId });
      return;
    }
    await setStatus(pool, ingestion.id, "processing");
    try {
      const email = await parseEmail(ingestion.raw);
      const accounts = await loadAccounts(pool, ingestion.userId);
      const receivedDate = ingestion.receivedAt ? ingestion.receivedAt.toISOString().slice(0, 10) : null;
      const outcome = await runExtraction(email, ai, { receivedDate, accounts });
      const inserted = await saveResults(pool, {
        ingestion,
        classification: outcome.classification,
        status: outcome.status,
        rows: outcome.rows,
      });
      log("info", "extracted", {
        ingestionId: ingestion.id,
        classification: outcome.classification,
        status: outcome.status,
        found: outcome.rows.length,
        inserted,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setStatus(pool, ingestion.id, "failed", message).catch(() => {});
      log("error", "extraction failed", { ingestionId: ingestion.id, err: message });
      throw err; // let BullMQ retry per the job's attempts policy
    }
  },
  {
    connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    concurrency: config.EXTRACT_CONCURRENCY,
  },
);

worker.on("ready", () => log("info", "extractor ready", { queue: EXTRACT_QUEUE, provider: ai.name }));
worker.on("failed", (job, err) => log("error", "job failed", { id: job?.id, err: err.message }));
worker.on("error", (err) => log("error", "worker error", { err: err.message }));

async function shutdown(signal: string): Promise<void> {
  log("info", "shutting down", { signal });
  await worker.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
