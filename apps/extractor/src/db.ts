import pg from "pg";
import type { EmailIngestStatus, RedactionIdentity } from "@compass/shared";
import { computeStatementRewardEntries } from "./extract.ts";
import type {
  AccountRef,
  CategoryRef,
  InboxRow,
  ReconciliationStats,
  StatementRewards,
} from "./extract.ts";

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
  const res = await pool.query<{
    id: string;
    name: string;
    account_last4: string | null;
    institution: string | null;
    debit_card_last4: string | null;
  }>(
    `select a.id, a.name, a.account_last4, a.institution,
            nullif(bd.debit_card_last4, '') as debit_card_last4
       from accounts a
       left join bank_details bd on bd.account_id = a.id
      where a.user_id = $1 and a.archived_at is null`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    accountLast4: r.account_last4,
    institution: r.institution,
    debitCardLast4: r.debit_card_last4,
  }));
}

export interface CreditCardRef {
  id: string;
  name: string;
  /** encrypted statement-PDF password; "" when the user hasn't stored one */
  statementPasswordEnc: string;
}

/**
 * Credit-card accounts + their stored statement password, to open a statement PDF.
 * The password is per-card (`card_details.statement_password_enc`) — issuers like
 * HDFC embed the card's own last-4, so each card of a bank needs its own. A card
 * with no stored password gets `""` and is skipped when trying to open the PDF.
 */
export async function loadCreditCards(pool: pg.Pool, userId: string): Promise<CreditCardRef[]> {
  const res = await pool.query<{ id: string; name: string; statement_password_enc: string }>(
    `select a.id, a.name, coalesce(cd.statement_password_enc, '') as statement_password_enc
       from accounts a
       left join card_details cd on cd.account_id = a.id
      where a.user_id = $1 and a.type = 'credit_card' and a.archived_at is null`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    statementPasswordEnc: r.statement_password_enc,
  }));
}

/**
 * The mailbox owner's own identifiers, to redact *their* PII from anything sent to
 * the model while leaving merchant data intact (see `redactPii`). Names come from
 * the login profile and every account holder name; VPAs/emails from their accounts.
 */
export async function loadIdentity(pool: pg.Pool, userId: string): Promise<RedactionIdentity> {
  const res = await pool.query<{
    display_name: string;
    email: string;
    holder_names: string[];
    upi_ids: string[];
  }>(
    `select
        u.display_name,
        u.email,
        array_remove(array_agg(distinct nullif(a.holder_name, '')), null) as holder_names,
        array_remove(array_agg(distinct vpa), null) as upi_ids
      from users u
      left join accounts a on a.user_id = u.id
      left join lateral unnest(coalesce(a.upi_ids, '{}')) as vpa on true
      where u.id = $1
      group by u.id`,
    [userId],
  );
  const r = res.rows[0];
  if (!r) return { names: [], emails: [], upiIds: [] };
  const names = new Set<string>(r.holder_names ?? []);
  if (r.display_name) names.add(r.display_name);
  return {
    names: [...names],
    emails: r.email ? [r.email] : [],
    upiIds: (r.upi_ids ?? []).filter((v) => v !== ""),
  };
}

/** The user's own categories — the model may only tag a draft with one of these. */
export async function loadCategories(pool: pg.Pool, userId: string): Promise<CategoryRef[]> {
  const res = await pool.query<{ id: string; name: string; kind: "income" | "expense" }>(
    `select id, name, kind from categories where user_id = $1 and archived_at is null`,
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

export interface AiEventInput {
  userId: string;
  kind: string;
  status: "ok" | "error";
  provider: string;
  model: string;
  title: string;
  ingestionId: string | null;
  accountId: string | null;
  requestContext: string;
  responseRaw: string;
  latencyMs: number | null;
  error: string | null;
}

// Match the API's per-field cap so one big statement prompt can't bloat the row.
const AI_EVENT_MAX_CHARS = 64_000;
const clampField = (s: string) =>
  s.length > AI_EVENT_MAX_CHARS ? s.slice(0, AI_EVENT_MAX_CHARS) + "\n…[truncated]" : s;

/** Log one model call to the AI event log. Best-effort — never throws. */
export async function recordAiEvent(pool: pg.Pool, ev: AiEventInput): Promise<void> {
  try {
    await pool.query(
      `insert into ai_events
         (user_id, kind, status, provider, model, title, ingestion_id, account_id,
          request_context, response_raw, latency_ms, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ev.userId,
        ev.kind,
        ev.status,
        ev.provider,
        ev.model,
        ev.title.slice(0, 300),
        ev.ingestionId,
        ev.accountId,
        clampField(ev.requestContext),
        clampField(ev.responseRaw),
        ev.latencyMs,
        ev.error,
      ],
    );
  } catch {
    // An event-log write must never fail the extraction it describes.
  }
}

/** One ledger transaction, for matching statement lines against (signed paise). */
export interface LedgerTxnRow {
  id: string;
  amountPaise: number;
  date: string;
  occurredAtTs: string | null;
  merchant: string;
}

/**
 * The card's ledger transactions in a date range — the pool the statement
 * matcher checks each line against. Range is the lines' own dates padded by the
 * posting-lag window (see matchLinesToLedger), never the statement period.
 */
export async function loadCardLedgerTxns(
  pool: pg.Pool,
  userId: string,
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<LedgerTxnRow[]> {
  const res = await pool.query<{
    id: string;
    amount_paise: string;
    date: string;
    occurred_at_ts: string | null;
    merchant: string;
  }>(
    `select id, amount_paise, to_char(date, 'YYYY-MM-DD') as date,
            to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts, merchant
       from transactions
      where user_id = $1 and account_id = $2 and deleted_at is null
        and date between $3 and $4`,
    [userId, accountId, fromDate, toDate],
  );
  return res.rows.map((r) => ({
    id: r.id,
    amountPaise: Number(r.amount_paise),
    date: r.date,
    occurredAtTs: r.occurred_at_ts,
    merchant: r.merchant,
  }));
}

/** An inbox row plus how it should land: a plain pending draft, or a matched duplicate. */
export interface SaveRow extends InboxRow {
  status?: "pending" | "duplicate";
  matchedTransactionId?: string | null;
}

/**
 * Persist the extraction outcome in one transaction: stamp the ingestion with
 * its class + status, then insert the inbox rows. Duplicate rows (same user +
 * dedupe hash) are skipped, so a replay or an alert-then-statement pair never
 * double-books. Rows the matcher tied to an existing ledger transaction are
 * inserted with status `duplicate` + that link, so they stay out of the pending
 * queue but remain reversible. Returns how many new rows were actually inserted.
 */
export async function saveResults(
  pool: pg.Pool,
  args: {
    ingestion: IngestionRecord;
    classification: string;
    status: EmailIngestStatus;
    rows: SaveRow[];
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
           (user_id, ingestion_id, amount_paise, direction, occurred_at, occurred_at_ts, counterparty,
            suggested_account_id, suggested_category_id, bank_ref, source_quote, confidence,
            dedupe_hash, status, matched_transaction_id, intent)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (user_id, dedupe_hash) do nothing`,
        [
          args.ingestion.userId,
          args.ingestion.id,
          row.amountPaise,
          row.direction,
          row.occurredAt,
          row.occurredAtTs,
          row.counterparty,
          row.suggestedAccountId,
          row.suggestedCategoryId,
          row.bankRef,
          row.sourceQuote,
          row.confidence,
          row.dedupeHash,
          row.status ?? "pending",
          row.matchedTransactionId ?? null,
          row.intent,
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

/**
 * Record a statement's reward-points summary against its card. Idempotent on
 * replay: this ingestion's prior reward rows are deleted first, then rebuilt.
 * Earned/redeemed become signed entries; a reconciling adjustment lands the
 * account's running sum on the statement's closing balance (see
 * computeStatementRewardEntries). Returns how many entries were written.
 */
export async function applyStatementRewards(
  pool: pg.Pool,
  args: {
    userId: string;
    accountId: string;
    ingestionId: string;
    date: string; // YYYY-MM-DD for the entries
    periodLabel: string;
    rewards: StatementRewards;
  },
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Replace this statement's prior reward rows so a replay never double-counts.
    await client.query(`delete from reward_entries where account_id = $1 and ingestion_id = $2`, [
      args.accountId,
      args.ingestionId,
    ]);
    const sumRes = await client.query<{ base: string }>(
      `select coalesce(sum(points), 0)::int as base from reward_entries where account_id = $1`,
      [args.accountId],
    );
    const baseSum = Number(sumRes.rows[0]!.base);
    const entries = computeStatementRewardEntries(baseSum, args.rewards, args.periodLabel);
    for (const e of entries) {
      await client.query(
        `insert into reward_entries (user_id, account_id, date, points, note, ingestion_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [args.userId, args.accountId, args.date, e.points, e.note, args.ingestionId],
      );
    }
    await client.query("commit");
    return entries.length;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** The statement's summary numbers, as a reconciliation snapshot may store them. */
export interface ReconciliationTotals {
  totalDuePaise: number | null;
  minDuePaise: number | null;
}

/**
 * Upsert the statement reconciliation for a cycle and stamp the ledger rows it
 * cleared. Keyed on `(account_id, period)` — NOT the ingestion — so a mailbox's
 * duplicate statement emails, or a replay, update the one row instead of piling
 * up. In a single transaction: upsert the snapshot + stats, clear this cycle's
 * previous stamps (so a re-run that matches differently leaves none stale), then
 * stamp the currently-matched ledger transactions. Returns the reconciliation id.
 */
export async function upsertReconciliation(
  pool: pg.Pool,
  args: {
    userId: string;
    accountId: string;
    period: string; // "YYYY-MM"
    statementDate: string | null;
    ingestionId: string;
    totals: ReconciliationTotals;
    rewards: StatementRewards;
    stats: ReconciliationStats;
  },
): Promise<string> {
  const { totals, rewards, stats } = args;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const res = await client.query<{ id: string }>(
      `insert into statement_reconciliations
         (user_id, account_id, period, statement_date, ingestion_id,
          total_due_paise, min_due_paise,
          reward_opening, reward_earned, reward_redeemed, reward_closing,
          line_count, line_debit_paise, matched_count, matched_paise, unmatched_count,
          updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
       on conflict (account_id, period) do update set
         statement_date = excluded.statement_date,
         ingestion_id = excluded.ingestion_id,
         total_due_paise = excluded.total_due_paise,
         min_due_paise = excluded.min_due_paise,
         reward_opening = excluded.reward_opening,
         reward_earned = excluded.reward_earned,
         reward_redeemed = excluded.reward_redeemed,
         reward_closing = excluded.reward_closing,
         line_count = excluded.line_count,
         line_debit_paise = excluded.line_debit_paise,
         matched_count = excluded.matched_count,
         matched_paise = excluded.matched_paise,
         unmatched_count = excluded.unmatched_count,
         updated_at = now()
       returning id`,
      [
        args.userId,
        args.accountId,
        args.period,
        args.statementDate,
        args.ingestionId,
        totals.totalDuePaise,
        totals.minDuePaise,
        rewards.opening,
        rewards.earned,
        rewards.redeemed,
        rewards.closing,
        stats.lineCount,
        stats.lineDebitPaise,
        stats.matchedCount,
        stats.matchedPaise,
        stats.unmatchedCount,
      ],
    );
    const id = res.rows[0]!.id;
    // Re-stamp: drop this cycle's prior stamps, then mark the current matches.
    await client.query(
      `update transactions set reconciled_statement_id = null where reconciled_statement_id = $1`,
      [id],
    );
    if (stats.matchedTxnIds.length > 0) {
      await client.query(
        `update transactions set reconciled_statement_id = $1
          where user_id = $2 and id = any($3::uuid[]) and deleted_at is null`,
        [id, args.userId, stats.matchedTxnIds],
      );
    }
    await client.query("commit");
    return id;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
