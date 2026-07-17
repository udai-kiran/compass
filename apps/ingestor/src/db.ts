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
}

export async function loadActiveMailboxes(pool: pg.Pool): Promise<MailboxRow[]> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    provider: "google" | "microsoft";
    email_address: string;
    refresh_token_enc: string;
    folder: string;
    uid_validity: string | null;
    last_uid: string | null;
  }>(
    `select id, user_id, provider, email_address, refresh_token_enc, folder, uid_validity, last_uid
     from mailbox_accounts where status = 'active'`,
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
  }));
}

/**
 * Insert one ingestion. Returns the new id, or null when the message was already
 * ingested (unique on user_id + message_id) — the caller then skips enqueuing.
 */
export async function insertIngestion(
  pool: pg.Pool,
  args: { userId: string; mailboxId: string; msg: IngestionInsert },
): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `insert into email_ingestions (user_id, mailbox_id, message_id, from_addr, subject, received_at, raw, status)
     values ($1,$2,$3,$4,$5,$6,$7,'pending')
     on conflict (user_id, message_id) do nothing
     returning id`,
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
  return res.rows[0]?.id ?? null;
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

export async function markMailboxError(pool: pg.Pool, mailboxId: string, error: string): Promise<void> {
  await pool.query(
    `update mailbox_accounts set status = 'error', last_error = $2, updated_at = now() where id = $1`,
    [mailboxId, error],
  );
}

// --- used by the onboarding CLI (connect.ts) ---

/** Resolve the user to attach a mailbox to: by email if given, else the sole/owner user. */
export async function resolveUserId(pool: pg.Pool, email?: string): Promise<string | null> {
  if (email) {
    const r = await pool.query<{ id: string }>(`select id from users where email = $1`, [email]);
    return r.rows[0]?.id ?? null;
  }
  const r = await pool.query<{ id: string }>(`select id from users order by created_at asc limit 1`);
  return r.rows[0]?.id ?? null;
}

/** Upsert a mailbox connection; a fresh token clears any prior error and watermark. */
export async function upsertMailbox(
  pool: pg.Pool,
  args: {
    userId: string;
    provider: "google" | "microsoft";
    emailAddress: string;
    refreshTokenEnc: string;
    folder: string;
  },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into mailbox_accounts (user_id, provider, email_address, refresh_token_enc, folder, status)
     values ($1,$2,$3,$4,$5,'active')
     on conflict (user_id, email_address) do update
       set provider = excluded.provider,
           refresh_token_enc = excluded.refresh_token_enc,
           folder = excluded.folder,
           status = 'active',
           last_error = null,
           uid_validity = null,
           last_uid = null,
           updated_at = now()
     returning id`,
    [args.userId, args.provider, args.emailAddress, args.refreshTokenEnc, args.folder],
  );
  return res.rows[0]!.id;
}
