import { ImapFlow } from "imapflow";
import type { MailboxState, RawMessage } from "./sync.ts";

export interface OpenOptions {
  host: string;
  port: number;
  user: string;
  accessToken: string;
  folder: string;
}

export interface OpenMailbox {
  state: MailboxState;
  /** Fetch raw messages with UID ≥ fromUid (server may over-return; caller filters). */
  fetchSince(fromUid: number): Promise<RawMessage[]>;
  close(): Promise<void>;
}

/**
 * Open a folder over an XOAUTH2 IMAP connection for a single sync pass. We
 * connect per pass rather than holding a long-lived IDLE connection, so a
 * short-lived access token never expires mid-session and there is no IDLE state
 * to babysit — the watermark keeps each pass cheap.
 */
export async function openMailbox(opts: OpenOptions): Promise<OpenMailbox> {
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: true,
    auth: { user: opts.user, accessToken: opts.accessToken },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(opts.folder);
  const mb = client.mailbox;
  if (!mb) {
    lock.release();
    await client.logout();
    throw new Error(`Could not open folder ${opts.folder}`);
  }
  const state: MailboxState = { uidValidity: Number(mb.uidValidity), uidNext: Number(mb.uidNext) };

  return {
    state,
    async fetchSince(fromUid: number): Promise<RawMessage[]> {
      const out: RawMessage[] = [];
      for await (const msg of client.fetch(
        `${fromUid}:*`,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        const env = msg.envelope;
        out.push({
          uid: msg.uid,
          messageId: env?.messageId ?? null,
          fromAddr: env?.from?.[0]?.address ?? "",
          subject: env?.subject ?? "",
          receivedAt: env?.date ?? null,
          raw: msg.source ? msg.source.toString("utf8") : "",
        });
      }
      return out;
    },
    async close(): Promise<void> {
      lock.release();
      await client.logout().catch(() => {});
    },
  };
}
