import pg from "pg";
import type { EmailIngestStatus } from "@compass/shared";
import type { AccountRef, InboxRow } from "./extract.ts";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export interface IngestionRecord {
  id: string;
  userId: string;
  subject: string;
  fromAddr: string;
  receivedAt: Date | null;
  raw: string;
}

export async function loadIngestion(pool: pg.Pool, id: string): Promise<IngestionRecord | null> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    subject: string;
    from_addr: string;
    received_at: Date | null;
    raw: string;
  }>(
    `select id, user_id, subject, from_addr, received_at, raw from email_ingestions where id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return { id: r.id, userId: r.user_id, subject: r.subject, fromAddr: r.from_addr, receivedAt: r.received_at, raw: r.raw };
}

export interface StoredAiSettings {
  provider: "none" | "anthropic" | "ollama" | "openrouter" | "deepseek" | "custom";
  apiKeyEnc: string;
  baseUrl: string;
  model: string;
}

/** The email's owner brings their own AI provider (Settings → AI). Null = never configured. */
export async function loadAiSettings(pool: pg.Pool, userId: string): Promise<StoredAiSettings | null> {
  const res = await pool.query<{
    provider: StoredAiSettings["provider"];
    api_key_enc: string;
    base_url: string;
    model: string;
  }>(`select provider, api_key_enc, base_url, model from ai_settings where user_id = $1`, [userId]);
  const r = res.rows[0];
  if (!r) return null;
  return { provider: r.provider, apiKeyEnc: r.api_key_enc, baseUrl: r.base_url, model: r.model };
}

export async function loadAccounts(pool: pg.Pool, userId: string): Promise<AccountRef[]> {
  const res = await pool.query<{ id: string; name: string }>(
    `select id, name from accounts where user_id = $1 and archived_at is null`,
    [userId],
  );
  return res.rows;
}

export async function setStatus(
  pool: pg.Pool,
  id: string,
  status: EmailIngestStatus,
  error: string | null = null,
): Promise<void> {
  await pool.query(
    `update email_ingestions set status = $2, error = $3, updated_at = now() where id = $1`,
    [id, status, error],
  );
}

/**
 * Persist the extraction outcome in one transaction: stamp the ingestion with
 * its class + status, then insert the inbox rows. Duplicate rows (same user +
 * dedupe hash) are skipped, so a replay or an alert-then-statement pair never
 * double-books. Returns how many new rows were actually inserted.
 */
export async function saveResults(
  pool: pg.Pool,
  args: {
    ingestion: IngestionRecord;
    classification: string;
    status: EmailIngestStatus;
    rows: InboxRow[];
  },
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update email_ingestions set classification = $2, status = $3, error = null, updated_at = now() where id = $1`,
      [args.ingestion.id, args.classification, args.status],
    );
    let inserted = 0;
    for (const row of args.rows) {
      const res = await client.query(
        `insert into extracted_transactions
           (user_id, ingestion_id, amount_paise, direction, occurred_at, counterparty,
            suggested_account_id, bank_ref, source_quote, confidence, dedupe_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (user_id, dedupe_hash) do nothing`,
        [
          args.ingestion.userId,
          args.ingestion.id,
          row.amountPaise,
          row.direction,
          row.occurredAt,
          row.counterparty,
          row.suggestedAccountId,
          row.bankRef,
          row.sourceQuote,
          row.confidence,
          row.dedupeHash,
        ],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query("commit");
    return inserted;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
