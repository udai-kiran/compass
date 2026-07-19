import pg from "pg";
import type { IngestionInsert } from "./sync.ts";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export interface MailboxRow {
  id: string;
  userId: string;
  provider: "google" | "microsoft";
  emailAddress: string;
  refreshTokenEnc: string;
  folder: string;
  uidValidity: number | null;
  lastUid: number | null;
  /** per-user OAuth client for this provider; null when the user hasn't onboarded creds */
  clientId: string | null;
  clientSecretEnc: string | null;
}

/**
 * Mailboxes to sync this pass: healthy ones plus those in `error`. An `error`
 * status marks a *transient* failure (a Redis/IMAP/token/db hiccup) — retrying
 * it lets ingestion self-heal once the cause clears; a successful pass resets it
 * to `active`. Only `disconnected` (a deliberate, user-initiated stop) is
 * excluded and never auto-retried.
 *
 * Client credentials are per user, so we LEFT JOIN them by (user, provider). A
 * mailbox whose user has no creds comes back with clientId=null; the caller
 * marks it errored rather than crashing the whole pass.
 */
export async function loadSyncableMailboxes(pool: pg.Pool, userId?: string): Promise<MailboxRow[]> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    provider: "google" | "microsoft";
    email_address: string;
    refresh_token_enc: string;
    folder: string;
    uid_validity: string | null;
    last_uid: string | null;
    client_id: string | null;
    client_secret_enc: string | null;
  }>(
    `select m.id, m.user_id, m.provider, m.email_address, m.refresh_token_enc, m.folder,
            m.uid_validity, m.last_uid, c.client_id, c.client_secret_enc
     from mailbox_accounts m
     left join mailbox_credentials c
       on c.user_id = m.user_id and c.provider = m.provider
     where m.status in ('active', 'error')
       and ($1::uuid is null or m.user_id = $1)`,
    [userId ?? null],
  );
  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    emailAddress: r.email_address,
    refreshTokenEnc: r.refresh_token_enc,
    folder: r.folder,
    uidValidity: r.uid_validity === null ? null : Number(r.uid_validity),
    lastUid: r.last_uid === null ? null : Number(r.last_uid),
    clientId: r.client_id,
    clientSecretEnc: r.client_secret_enc,
  }));
}

/**
 * Record one ingestion, returning its id and current status — for a brand-new
 * message that's `{id, 'pending'}`, for one already seen it's the existing row.
 *
 * Crucially this NEVER returns null on conflict. Insertion and enqueue are two
 * steps: if enqueue fails after a successful insert, the row is left `pending`,
 * and the next sync pass must be able to re-enqueue it. A plain
 * `on conflict do nothing` would return no row and strand the email forever; the
 * no-op `do update` makes the conflict path return the existing row so the
 * caller can re-enqueue any still-`pending` ingestion (BullMQ dedupes on the
 * jobId, so re-enqueuing is safe).
 */
export async function recordIngestion(
  pool: pg.Pool,
  args: { userId: string; mailboxId: string; msg: IngestionInsert },
): Promise<{ id: string; status: string }> {
  const res = await pool.query<{ id: string; status: string }>(
    `insert into email_ingestions (user_id, mailbox_id, message_id, from_addr, subject, received_at, raw, status)
     values ($1,$2,$3,$4,$5,$6,$7,'pending')
     on conflict (user_id, message_id) do update set message_id = excluded.message_id
     returning id, status`,
    [
      args.userId,
      args.mailboxId,
      args.msg.messageId,
      args.msg.fromAddr,
      args.msg.subject,
      args.msg.receivedAt,
      args.msg.raw,
    ],
  );
  return res.rows[0]!;
}

export async function saveWatermark(
  pool: pg.Pool,
  mailboxId: string,
  uidValidity: number,
  lastUid: number,
): Promise<void> {
  await pool.query(
    `update mailbox_accounts
     set uid_validity = $2, last_uid = $3, last_synced_at = now(), status = 'active', last_error = null, updated_at = now()
     where id = $1`,
    [mailboxId, uidValidity, lastUid],
  );
}

export async function markMailboxError(
  pool: pg.Pool,
  mailboxId: string,
  error: string,
): Promise<void> {
  await pool.query(
    `update mailbox_accounts set status = 'error', last_error = $2, updated_at = now() where id = $1`,
    [mailboxId, error],
  );
}
