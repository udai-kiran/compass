import { Worker } from "bullmq";
import { createAiProvider, effectiveModel, type AiObserver, type AiProvider } from "@compass/ai";
import { EXTRACT_QUEUE, ExtractJobSchema } from "@compass/shared";
import { loadConfig } from "./config.ts";
import {
  applyStatementRewards,
  createPool,
  loadAccounts,
  loadAiSettings,
  loadCardLedgerTxns,
  loadCategories,
  loadCreditCards,
  loadIngestion,
  recordAiEvent,
  saveResults,
  setStatus,
  upsertReconciliation,
  type SaveRow,
} from "./db.ts";
import { decryptSecret } from "./crypto.ts";
import { parseEmail, type ParsedEmail } from "./email.ts";
import {
  extractStatementSummary,
  extractStatementTxns,
  hasRewardData,
  matchLinesToLedger,
  MAX_STATEMENT_CHARS,
  runExtraction,
  statementPeriodKey,
  STATEMENT_MATCH_WINDOW_DAYS,
  summarizeMatches,
  type StatementSummary,
} from "./extract.ts";
import { extractPdfText } from "./pdf.ts";
import type { CategoryRef } from "./extract.ts";
import type { InboxRow } from "./extract.ts";
import type { EmailIngestStatus } from "@compass/shared";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const secret = config.MAILBOX_SECRET || config.SESSION_SECRET;

/** Cap on a statement PDF attachment before it's handed to pdf.js. */
const MAX_STATEMENT_PDF_BYTES = 15 * 1024 * 1024;

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
interface ResolvedAi {
  providerName: string;
  model: string;
  /** Build a provider whose every model round-trip is reported to `observe`. */
  build: (observe: AiObserver) => AiProvider;
}

async function aiForUser(userId: string): Promise<ResolvedAi | null> {
  const s = await loadAiSettings(pool, userId);
  if (!s || s.provider === "none") return null;
  if ((s.provider === "ollama" || s.provider === "custom") && !baseUrlAllowed(s.baseUrl)) {
    log("warn", "stored AI base URL is not allowed", { userId, provider: s.provider });
    return null;
  }
  const apiKey = s.apiKeyEnc ? decryptSecret(s.apiKeyEnc, secret) : "";
  const build = (observe: AiObserver): AiProvider =>
    createAiProvider({ provider: s.provider, apiKey, baseUrl: s.baseUrl, model: s.model, observe });
  // A mis-configured provider resolves to the (disabled) NullProvider.
  if (!build(() => {}).enabled) return null;
  // Log the effective model (the factory substitutes a default when blank).
  return { providerName: s.provider, model: effectiveModel(s.provider, s.model), build };
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

/**
 * Process a credit-card statement email: find the PDF attachment, open it with
 * the matching card's stored password (the password that decrypts it identifies
 * the card), and AI-extract every transaction against that account. Falls back
 * to an unencrypted statement (no card matched). Leaves it deferred when no
 * stored password opens the PDF — the user can add the password and replay.
 */
interface StatementOutcome {
  status: EmailIngestStatus;
  rows: InboxRow[];
  /** the card whose password opened the PDF; null for an unencrypted statement */
  accountId: string | null;
  /** totals + reward summary; null when nothing opened or the summary didn't parse */
  summary: StatementSummary | null;
}

async function processStatement(
  email: ParsedEmail,
  providerFor: (kind: string, accountId: string | null, title: string) => AiProvider,
  userId: string,
  ctx: { receivedDate: string | null; categories: CategoryRef[] },
): Promise<StatementOutcome> {
  const pdf = email.attachments.find(
    (a) => a.contentType.toLowerCase().includes("pdf") || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (!pdf) return { status: "deferred", rows: [], accountId: null, summary: null };
  // Guard the worker's memory: a real statement is well under this; anything
  // bigger is left for manual handling rather than fed into pdf.js.
  if (pdf.content.length > MAX_STATEMENT_PDF_BYTES) {
    log("warn", "statement PDF too large to process", {
      bytes: pdf.content.length,
      max: MAX_STATEMENT_PDF_BYTES,
    });
    return { status: "deferred", rows: [], accountId: null, summary: null };
  }

  const extractFrom = async (text: string, accountId: string | null) => {
    if (text.length > MAX_STATEMENT_CHARS) {
      log("warn", "statement text exceeds the extraction cap — some transactions may be missing", {
        chars: text.length,
        cap: MAX_STATEMENT_CHARS,
      });
    }
    // Transaction lines and the summary (totals + rewards) are separate passes:
    // the summary is best-effort, so its failure never costs us the transactions.
    const subject = email.subject || "(no subject)";
    const rows = await extractStatementTxns(
      text,
      providerFor("statement_parse", accountId, `Statement · ${subject}`),
      { ...ctx, accountId },
    );
    const summary = await extractStatementSummary(
      text,
      providerFor("statement_summary", accountId, `Statement summary · ${subject}`),
    ).catch(() => null);
    return { rows, summary };
  };

  const cards = await loadCreditCards(pool, userId);
  for (const card of cards) {
    if (!card.statementPasswordEnc) continue;
    let password: string;
    try {
      password = decryptSecret(card.statementPasswordEnc, secret);
    } catch {
      // Almost always a MAILBOX_SECRET mismatch between the API (which encrypted
      // it) and this worker. Surface it instead of silently skipping the card.
      log("warn", "could not decrypt a stored card password — is MAILBOX_SECRET the same as the API's?", {
        accountId: card.id,
      });
      continue;
    }
    const opened = await extractPdfText(pdf.content, [password]);
    if (opened) {
      const { rows, summary } = await extractFrom(opened.text, card.id);
      log("info", "statement extracted", { accountId: card.id, found: rows.length });
      return { status: "extracted", rows, accountId: card.id, summary };
    }
  }

  // Not encrypted (or no stored password matched): open it plainly if we can.
  const unlocked = await extractPdfText(pdf.content, []);
  if (unlocked) {
    const { rows, summary } = await extractFrom(unlocked.text, null);
    return { status: "extracted", rows, accountId: null, summary };
  }
  log("warn", "statement PDF not opened — no matching card password stored");
  return { status: "deferred", rows: [], accountId: null, summary: null };
}

/** "Jul 2026" from a YYYY-MM-DD; the fallback is used when the statement omits a date. */
function periodLabel(isoDate: string | null): string {
  if (!isoDate) return "Statement";
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? "Statement"
    : d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Flag statement lines that just re-list a spend already in the ledger (recorded
 * from a real-time alert during the cycle): match each to a ledger transaction
 * and mark the hits `duplicate` so they stay out of the pending review queue.
 * Matching runs against the card's ledger over the lines' own date span padded
 * by the posting-lag window — never the statement period — so a near-close spend
 * that bills next cycle isn't force-matched here. Non-matches pass through as
 * ordinary pending drafts.
 */
async function annotateStatementDuplicates(rows: InboxRow[], userId: string): Promise<SaveRow[]> {
  const accountId = rows.find((r) => r.suggestedAccountId)?.suggestedAccountId ?? null;
  const dates = rows.map((r) => r.occurredAt).filter((d): d is string => d !== null);
  if (!accountId || dates.length === 0) return rows;
  const from = shiftIso(dates.reduce((a, b) => (a < b ? a : b)), -STATEMENT_MATCH_WINDOW_DAYS);
  const to = shiftIso(dates.reduce((a, b) => (a > b ? a : b)), STATEMENT_MATCH_WINDOW_DAYS);
  const ledger = await loadCardLedgerTxns(pool, userId, accountId, from, to);
  if (ledger.length === 0) return rows;
  const matched = matchLinesToLedger(
    rows.map((r) => ({
      amountPaise: r.amountPaise,
      direction: r.direction,
      occurredAt: r.occurredAt,
      occurredAtTs: r.occurredAtTs,
      counterparty: r.counterparty,
    })),
    ledger,
  );
  return rows.map((r, i) =>
    matched[i] ? { ...r, status: "duplicate" as const, matchedTransactionId: matched[i]! } : r,
  );
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
    const resolved = await aiForUser(ingestion.userId);
    if (!resolved) {
      const message = "no AI provider configured — set one in Settings → AI";
      await setStatus(pool, ingestion.id, "failed", message).catch(() => {});
      log("warn", "extraction skipped", { ingestionId: ingestion.id, err: message });
      return;
    }
    const { providerName, model, build } = resolved;
    // A provider whose every model round-trip is logged to the AI event log at
    // the HTTP boundary (exact request body + raw response), tagged per kind.
    const providerFor = (kind: string, accountId: string | null, title: string): AiProvider =>
      build((obs) =>
        recordAiEvent(pool, {
          userId: ingestion.userId,
          kind,
          status: obs.ok ? "ok" : "error",
          provider: providerName,
          model,
          title,
          ingestionId: ingestion.id,
          accountId,
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        }));
    await setStatus(pool, ingestion.id, "processing");
    try {
      const email = await parseEmail(ingestion.raw);
      const [accounts, categories] = await Promise.all([
        loadAccounts(pool, ingestion.userId),
        loadCategories(pool, ingestion.userId),
      ]);
      const receivedDate = ingestion.receivedAt
        ? ingestion.receivedAt.toISOString().slice(0, 10)
        : null;
      const emailTitle = ingestion.subject || "(no subject)";
      const outcome = await runExtraction(
        email,
        providerFor("email_extract", null, emailTitle),
        { receivedDate, accounts, categories },
      );
      // A statement email is recognized here but its transactions live in the PDF;
      // process that separately, overriding the (deferred) email-body outcome.
      let status = outcome.status;
      let rows: SaveRow[] = outcome.rows;
      let stmt: StatementOutcome | null = null;
      if (outcome.classification === "card_statement") {
        stmt = await processStatement(
          email,
          providerFor,
          ingestion.userId,
          { receivedDate, categories },
        );
        status = stmt.status;
        // Suppress lines already in the ledger from real-time alerts this cycle.
        rows = await annotateStatementDuplicates(stmt.rows, ingestion.userId);
      }
      const inserted = await saveResults(pool, {
        ingestion,
        classification: outcome.classification,
        status,
        rows,
      });
      const duplicates = rows.filter((r) => r.status === "duplicate").length;
      log("info", "extracted", {
        ingestionId: ingestion.id,
        classification: outcome.classification,
        status,
        found: rows.length,
        duplicates,
        inserted,
      });

      // Reward points from the statement summary — best-effort and replace-on-
      // replay (keyed by ingestion), so re-processing never double-counts.
      if (stmt?.accountId && stmt.summary && hasRewardData(stmt.summary.rewards)) {
        const date = stmt.summary.statementDate ?? receivedDate ?? new Date().toISOString().slice(0, 10);
        try {
          const entries = await applyStatementRewards(pool, {
            userId: ingestion.userId,
            accountId: stmt.accountId,
            ingestionId: ingestion.id,
            date,
            periodLabel: periodLabel(stmt.summary.statementDate ?? receivedDate),
            rewards: stmt.summary.rewards,
          });
          log("info", "statement rewards updated", { accountId: stmt.accountId, entries });
        } catch (e) {
          log("warn", "statement rewards update failed", {
            accountId: stmt.accountId,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // Reconciliation snapshot for the cycle — records the cycle's totals + match
      // stats and stamps the ledger rows the statement cleared. Keyed on (card,
      // period), so a duplicate statement email or a replay updates in place.
      // Best-effort: a failure here never fails the extraction.
      if (stmt?.accountId && rows.length > 0) {
        const period = statementPeriodKey(stmt.summary?.statementDate ?? receivedDate);
        if (period) {
          try {
            const stats = summarizeMatches(rows);
            await upsertReconciliation(pool, {
              userId: ingestion.userId,
              accountId: stmt.accountId,
              period,
              statementDate: stmt.summary?.statementDate ?? null,
              ingestionId: ingestion.id,
              totals: {
                totalDuePaise: stmt.summary?.totalDuePaise ?? null,
                minDuePaise: stmt.summary?.minDuePaise ?? null,
              },
              rewards: stmt.summary?.rewards ?? {
                opening: null,
                earned: null,
                redeemed: null,
                closing: null,
              },
              stats,
            });
            log("info", "statement reconciled", {
              accountId: stmt.accountId,
              period,
              matched: stats.matchedCount,
              lines: stats.lineCount,
            });
          } catch (e) {
            log("warn", "statement reconciliation failed", {
              accountId: stmt.accountId,
              err: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
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
