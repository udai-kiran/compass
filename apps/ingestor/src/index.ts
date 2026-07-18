import { Queue } from "bullmq";
import { EXTRACT_QUEUE } from "@compass/shared";
import { loadConfig } from "./config.ts";
import { decryptSecret } from "./crypto.ts";
import {
  createPool,
  loadSyncableMailboxes,
  recordIngestion,
  markMailboxError,
  saveWatermark,
  type MailboxRow,
} from "./db.ts";
import { openMailbox } from "./imap.ts";
import { getTokenProvider, type AccessToken } from "./token-provider.ts";
import { advanceLastUid, filterNew, planSync, toIngestion } from "./sync.ts";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const queue = new Queue(EXTRACT_QUEUE, {
  connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
});

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
}

// Cache access tokens per mailbox so we refresh ~hourly, not every pass.
const tokenCache = new Map<string, AccessToken>();

async function accessTokenFor(mb: MailboxRow): Promise<{ token: string; host: string; port: number }> {
  // Credentials are per user, joined in by loadSyncableMailboxes. A mailbox with
  // none can't mint tokens — surface it as an error rather than crash the pass.
  if (!mb.clientId || !mb.clientSecretEnc) {
    throw new Error("no OAuth client credentials on file — add them in Settings → Mailboxes");
  }
  const creds = {
    clientId: mb.clientId,
    clientSecret: decryptSecret(mb.clientSecretEnc, config.MAILBOX_SECRET),
  };
  const provider = getTokenProvider(mb.provider, creds);
  const cached = tokenCache.get(mb.id);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, host: provider.imapHost, port: provider.imapPort };
  }
  const refreshToken = decryptSecret(mb.refreshTokenEnc, config.MAILBOX_SECRET);
  const fresh = await provider.refresh(refreshToken);
  tokenCache.set(mb.id, fresh);
  return { token: fresh.token, host: provider.imapHost, port: provider.imapPort };
}

async function enqueue(ingestionId: string): Promise<void> {
  await queue.add(
    "extract",
    { ingestionId },
    { jobId: ingestionId, removeOnComplete: true, removeOnFail: 500, attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  );
}

async function syncPass(mb: MailboxRow): Promise<void> {
  const { token, host, port } = await accessTokenFor(mb);
  const box = await openMailbox({ host, port, user: mb.emailAddress, accessToken: token, folder: mb.folder });
  try {
    const stored = mb.uidValidity !== null && mb.lastUid !== null
      ? { uidValidity: mb.uidValidity, lastUid: mb.lastUid }
      : null;
    const plan = planSync(stored, box.state);

    if (plan.baseline) {
      // First connect or UIDVALIDITY reset — record the baseline, ingest nothing historical.
      await saveWatermark(pool, mb.id, plan.baseline.uidValidity, plan.baseline.lastUid);
      log("info", "mailbox baselined", { mailbox: mb.emailAddress, lastUid: plan.baseline.lastUid });
      return;
    }

    const fetched = await box.fetchSince(plan.fromUid!);
    const fresh = filterNew(fetched, plan.fromUid!);
    let enqueued = 0;
    for (const msg of fresh) {
      const rec = await recordIngestion(pool, {
        userId: mb.userId,
        mailboxId: mb.id,
        msg: toIngestion(msg, mb.emailAddress),
      });
      // Enqueue anything still awaiting extraction — a new insert, or a prior
      // insert whose enqueue never landed. Already-processed rows are skipped.
      if (rec.status === "pending") {
        await enqueue(rec.id);
        enqueued++;
      }
    }
    const newLastUid = advanceLastUid(mb.lastUid!, fresh.map((m) => m.uid));
    await saveWatermark(pool, mb.id, box.state.uidValidity, newLastUid);
    if (fresh.length > 0) {
      log("info", "sync pass", { mailbox: mb.emailAddress, fetched: fresh.length, enqueued, lastUid: newLastUid });
    }
  } finally {
    await box.close();
  }
}

async function runAll(): Promise<void> {
  const mailboxes = await loadSyncableMailboxes(pool).catch((err: unknown) => {
    log("error", "failed to load mailboxes", { err: String(err) });
    return [] as MailboxRow[];
  });
  for (const mb of mailboxes) {
    try {
      await syncPass(mb);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tokenCache.delete(mb.id); // a bad/expired token shouldn't stick
      await markMailboxError(pool, mb.id, message).catch(() => {});
      log("error", "sync failed", { mailbox: mb.emailAddress, err: message });
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let stopped = false;

async function loop(): Promise<void> {
  if (stopped) return;
  await runAll();
  if (!stopped) timer = setTimeout(() => void loop(), config.POLL_INTERVAL_SECONDS * 1000);
}

log("info", "ingestor starting", { queue: EXTRACT_QUEUE, pollSeconds: config.POLL_INTERVAL_SECONDS });
void loop();

async function shutdown(signal: string): Promise<void> {
  log("info", "shutting down", { signal });
  stopped = true;
  if (timer) clearTimeout(timer);
  await queue.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
