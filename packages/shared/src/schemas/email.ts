import { z } from "zod";

// ---------- Email → transaction ingestion pipeline ----------
//
// Two containers, one contract. The `ingestor` reads mail over IMAP and writes
// an `email_ingestions` row, then enqueues an `ExtractJob`. The `extractor`
// consumes the job, asks the model to classify + extract, and writes pending
// `extracted_transactions` (a review inbox). Nothing reaches the ledger until a
// human accepts it — category is never auto-assigned.

/** What kind of mail this is. Only alerts/bills yield transactions in v1. */
export const EmailClassSchema = z.enum([
  "transaction_alert",
  "card_statement",
  "bill",
  "otp",
  "promo",
  "other",
]);
export type EmailClass = z.infer<typeof EmailClassSchema>;

/**
 * Lifecycle of one ingested email:
 *  pending    → enqueued, not yet processed
 *  processing → an extractor worker holds it
 *  extracted  → drafts written to the inbox
 *  deferred   → recognized but not handled yet (e.g. a PDF statement in v1)
 *  ignored    → classified as noise (otp/promo/other), nothing to extract
 *  failed     → errored; raw is retained so it can be replayed after a fix
 */
export const EmailIngestStatusSchema = z.enum([
  "pending",
  "processing",
  "extracted",
  "deferred",
  "ignored",
  "failed",
]);
export type EmailIngestStatus = z.infer<typeof EmailIngestStatusSchema>;

/** debit = money out, credit = money in. Mapped to the signed ledger amount on accept. */
export const TxnDirectionSchema = z.enum(["debit", "credit"]);
export type TxnDirection = z.infer<typeof TxnDirectionSchema>;

// ---------- Model I/O (the extractor's structured output) ----------

/** One transaction the model extracted from an email. Positive magnitude + direction. */
export const ExtractedTxnDraftSchema = z.object({
  amountPaise: z.number().int().positive(),
  direction: TxnDirectionSchema,
  /** transaction date if the mail states one; null falls back to received date */
  occurredAt: z.iso.date().nullable().default(null),
  counterparty: z.string().default(""),
  /** account name / last-4 the mail mentions; matched to an account server-side, never guessed */
  accountHint: z.string().default(""),
  /** bank reference / UTR / txn id — the dedupe key against later statements */
  bankRef: z.string().nullable().default(null),
  /** verbatim snippet the figures came from, kept for review provenance */
  sourceQuote: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type ExtractedTxnDraft = z.infer<typeof ExtractedTxnDraftSchema>;

/** The extractor model's full answer for one email: a class plus zero or more txns. */
export const ExtractionResultSchema = z.object({
  classification: EmailClassSchema,
  transactions: z.array(ExtractedTxnDraftSchema).default([]),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------- Persisted review-inbox row (API/UI shape) ----------

export const ExtractedTxnReviewStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type ExtractedTxnReviewStatus = z.infer<typeof ExtractedTxnReviewStatusSchema>;

export const ExtractedTransactionSchema = z.object({
  id: z.uuid(),
  ingestionId: z.uuid(),
  amountPaise: z.number().int(),
  direction: TxnDirectionSchema,
  occurredAt: z.iso.date().nullable(),
  counterparty: z.string(),
  /** an account we matched from the mail's hint; the reviewer can override */
  suggestedAccountId: z.uuid().nullable(),
  bankRef: z.string().nullable(),
  sourceQuote: z.string(),
  confidence: z.number(),
  status: ExtractedTxnReviewStatusSchema,
  /** set once accepted into the ledger */
  transactionId: z.uuid().nullable(),
  createdAt: z.string(),
  // denormalized email context for the review card
  subject: z.string(),
  fromAddr: z.string(),
  receivedAt: z.string().nullable(),
});
export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;

/** Accept a pending draft into the ledger. Category stays manual — never set here. */
export const AcceptExtractedTxnSchema = z.object({
  accountId: z.uuid(),
  occurredAt: z.iso.date(),
  amountPaise: z.number().int().positive(),
  direction: TxnDirectionSchema,
  merchant: z.string().min(1),
});
export type AcceptExtractedTxn = z.input<typeof AcceptExtractedTxnSchema>;

/** Which review-inbox rows to list. */
export const InboxStatusFilterSchema = z.object({
  status: ExtractedTxnReviewStatusSchema.default("pending"),
});

/** Pending-count for the nav badge. */
export const InboxCountSchema = z.object({ pending: z.number().int() });
export type InboxCount = z.infer<typeof InboxCountSchema>;

// ---------- Queue message ----------

/** BullMQ queue the ingestor produces to and the extractor consumes from. */
export const EXTRACT_QUEUE = "email.extract";

/** The BullMQ job the ingestor enqueues and the extractor consumes. */
export const ExtractJobSchema = z.object({
  ingestionId: z.uuid(),
});
export type ExtractJob = z.infer<typeof ExtractJobSchema>;

// ---------- Mailbox connection (OAuth2) ----------

export const MailboxProviderSchema = z.enum(["google", "microsoft"]);
export type MailboxProvider = z.infer<typeof MailboxProviderSchema>;

export const MailboxStatusSchema = z.enum(["active", "disconnected", "error"]);
export type MailboxStatus = z.infer<typeof MailboxStatusSchema>;

/** A connected mailbox, shown in settings. The refresh token is never serialized out. */
export const MailboxAccountSchema = z.object({
  id: z.uuid(),
  provider: MailboxProviderSchema,
  emailAddress: z.string(),
  folder: z.string(),
  status: MailboxStatusSchema,
  lastError: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MailboxAccount = z.infer<typeof MailboxAccountSchema>;

/**
 * The payload the local `connect` CLI captures and prints (base64-encoded) for
 * the user to paste into Settings → Mailboxes. It carries everything needed to
 * store a per-user Google client and one mailbox: the client credentials plus
 * the long-lived refresh token. Consumed only by our own API, so the shape is
 * fixed and versioned (`v`).
 */
export const ConnectBundleSchema = z.object({
  v: z.literal(1),
  provider: MailboxProviderSchema.default("google"),
  email: z.email(),
  folder: z.string().min(1).default("INBOX"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type ConnectBundle = z.infer<typeof ConnectBundleSchema>;

/** Add-mailbox request: the opaque base64 bundle string the CLI printed. */
export const AddMailboxSchema = z.object({
  bundle: z.string().min(1, "paste the bundle the connect CLI printed"),
});
export type AddMailbox = z.infer<typeof AddMailboxSchema>;

/**
 * Whether the user has Google client credentials on file (drives the settings
 * UI). The secret is never returned — only the non-sensitive client id.
 */
export const MailboxCredentialsStatusSchema = z.object({
  configured: z.boolean(),
  clientId: z.string().nullable(),
});
export type MailboxCredentialsStatus = z.infer<typeof MailboxCredentialsStatusSchema>;
