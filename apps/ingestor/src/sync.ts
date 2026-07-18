/**
 * Pure IMAP sync logic — no network, fully unit-tested. The IMAP wrapper feeds
 * it mailbox state and raw messages; it decides what to fetch, how to advance
 * the watermark, and how a message maps to an ingestion row.
 */

/** Persisted resume point for one mailbox+folder. */
export interface Watermark {
  uidValidity: number;
  lastUid: number;
}

/** What the server reports when a folder is opened. */
export interface MailboxState {
  uidValidity: number;
  /** UID that will be assigned to the next new message */
  uidNext: number;
}

export interface SyncPlan {
  /** fetch UIDs `${fromUid}:*`; null means fetch nothing (baseline only) */
  fromUid: number | null;
  /** watermark to persist immediately when baselining (first run / UIDVALIDITY reset) */
  baseline: Watermark | null;
}

/**
 * Decide what to fetch. On the first connect or a UIDVALIDITY change (which
 * invalidates every stored UID) we do NOT ingest the mailbox's history — that
 * would flood the extractor and the model with old mail. Instead we baseline
 * the watermark to "now" (uidNext − 1) and ingest only what arrives afterward.
 * With a matching watermark we fetch everything strictly newer than lastUid.
 */
export function planSync(stored: Watermark | null, current: MailboxState): SyncPlan {
  const matches = stored !== null && stored.uidValidity === current.uidValidity;
  if (!matches) {
    const lastUid = Math.max(0, current.uidNext - 1);
    return { fromUid: null, baseline: { uidValidity: current.uidValidity, lastUid } };
  }
  return { fromUid: stored.lastUid + 1, baseline: null };
}

/**
 * `uid FETCH n:*` returns the highest message even when none are ≥ n, so callers
 * must drop anything below the requested floor. Returns the messages to ingest.
 */
export function filterNew<T extends { uid: number }>(messages: T[], fromUid: number): T[] {
  return messages.filter((m) => m.uid >= fromUid);
}

/** New lastUid after processing: the max UID seen, never regressing. */
export function advanceLastUid(priorLastUid: number, uids: number[]): number {
  return uids.reduce((max, u) => (u > max ? u : max), priorLastUid);
}

export interface RawMessage {
  uid: number;
  messageId: string | null;
  fromAddr: string;
  subject: string;
  receivedAt: Date | null;
  raw: string;
}

export interface IngestionInsert {
  messageId: string;
  fromAddr: string;
  subject: string;
  receivedAt: Date | null;
  raw: string;
}

/**
 * Map a fetched message to an ingestion row. A missing Message-ID (rare, but
 * possible) gets a synthetic uid-based id so the row stays insertable and still
 * dedupes on re-fetch of the same UID.
 */
export function toIngestion(msg: RawMessage, mailboxAddress: string): IngestionInsert {
  const messageId = msg.messageId?.trim() || `<uid-${msg.uid}@${mailboxAddress}>`;
  return {
    messageId,
    fromAddr: msg.fromAddr,
    subject: msg.subject,
    receivedAt: msg.receivedAt,
    raw: msg.raw,
  };
}
