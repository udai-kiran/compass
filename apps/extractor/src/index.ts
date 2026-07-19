import { Worker } from "bullmq";
import { createAiProvider, type AiProvider } from "@compass/ai";
import { EXTRACT_QUEUE, ExtractJobSchema } from "@compass/shared";
import { loadConfig } from "./config.ts";
import {
  createPool,
  loadAccounts,
  loadAiSettings,
  loadIngestion,
  saveResults,
  setStatus,
} from "./db.ts";
import { decryptSecret } from "./crypto.ts";
import { parseEmail } from "./email.ts";
import { runExtraction } from "./extract.ts";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const secret = config.MAILBOX_SECRET || config.SESSION_SECRET;

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra: Record<string, unknown> = {},
): void {
  console[level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
}

/**
 * Build the AI provider from the email owner's stored config (Settings → AI).
 * Returns null when they have none configured, so the caller can fail the
 * ingestion with a clear message instead of silently doing nothing.
 */
async function aiForUser(userId: string): Promise<AiProvider | null> {
  const s = await loadAiSettings(pool, userId);
  if (!s || s.provider === "none") return null;
  if ((s.provider === "ollama" || s.provider === "custom") && !baseUrlAllowed(s.baseUrl)) {
    log("warn", "stored AI base URL is not allowed", { userId, provider: s.provider });
    return null;
  }
  const apiKey = s.apiKeyEnc ? decryptSecret(s.apiKeyEnc, secret) : "";
  const provider = createAiProvider({
    provider: s.provider,
    apiKey,
    baseUrl: s.baseUrl,
    model: s.model,
  });
  return provider.enabled ? provider : null;
}

function baseUrlAllowed(value: string): boolean {
  try {
    const normalize = (raw: string) => {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      if (url.username || url.password || url.search || url.hash) throw new Error();
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    };
    const wanted = normalize(value);
    return config.AI_ALLOWED_BASE_URLS.split(",")
      .map((url) => url.trim())
      .filter(Boolean)
      .some((url) => normalize(url) === wanted);
  } catch {
    return false;
  }
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
    const ai = await aiForUser(ingestion.userId);
    if (!ai) {
      const message = "no AI provider configured — set one in Settings → AI";
      await setStatus(pool, ingestion.id, "failed", message).catch(() => {});
      log("warn", "extraction skipped", { ingestionId: ingestion.id, err: message });
      return;
    }
    await setStatus(pool, ingestion.id, "processing");
    try {
      const email = await parseEmail(ingestion.raw);
      const accounts = await loadAccounts(pool, ingestion.userId);
      const receivedDate = ingestion.receivedAt
        ? ingestion.receivedAt.toISOString().slice(0, 10)
        : null;
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

worker.on("ready", () => log("info", "extractor ready", { queue: EXTRACT_QUEUE }));
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
