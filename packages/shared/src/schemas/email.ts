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

/**
 * The model's classification of a credit draft's purpose. Captured so the
 * reviewer can see a card repayment for what it is, distinct from a genuine
 * refund or cashback — it does not suppress or alter any category suggestion.
 */
export const ExtractedTxnIntentSchema = z.enum(["repayment", "refund", "cashback"]);
export type ExtractedTxnIntent = z.infer<typeof ExtractedTxnIntentSchema>;

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
  /** repayment/refund/cashback classification of a credit; absent or invalid normalizes to null */
  intent: ExtractedTxnIntentSchema.nullable().catch(null).default(null),
});
export type ExtractedTxnDraft = z.infer<typeof ExtractedTxnDraftSchema>;

/** The extractor model's full answer for one email: a class plus zero or more txns. */
export const ExtractionResultSchema = z.object({
  classification: EmailClassSchema,
  transactions: z.array(ExtractedTxnDraftSchema).default([]),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ---------- Persisted review-inbox row (API/UI shape) ----------

export const ExtractedTxnReviewStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  // matched to a ledger transaction already recorded from an alert; hidden from
  // the pending queue but kept so the reviewer can un-match it if it's wrong
  "duplicate",
]);
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
  /** a category the AI guessed from the merchant; the reviewer confirms or changes it */
  suggestedCategoryId: z.uuid().nullable(),
  /** the model's repayment/refund/cashback classification of a credit, or null */
  intent: ExtractedTxnIntentSchema.nullable(),
  bankRef: z.string().nullable(),
  sourceQuote: z.string(),
  confidence: z.number(),
  status: ExtractedTxnReviewStatusSchema,
  /** set once accepted into the ledger */
  transactionId: z.uuid().nullable(),
  /** the ledger transaction this was matched to when status is `duplicate` */
  matchedTransactionId: z.uuid().nullable(),
  /**
   * The other leg when this draft looks like one side of an account-to-account
   * transfer (a debit + a matching credit, ~same day). Computed at read time,
   * not stored; both legs point at each other so the inbox can offer to record
   * them as a single transfer. Null when there's no unambiguous match.
   */
  transferPartnerId: z.uuid().nullable(),
  createdAt: z.string(),
  // denormalized email context for the review card
  subject: z.string(),
  fromAddr: z.string(),
  receivedAt: z.string().nullable(),
});
export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;

/**
 * Accept a pending draft into the ledger. The AI's category guess is offered in
 * the review card and travels back here as `categoryId` — null when the reviewer
 * clears it or none was guessed, so categorization is still the reviewer's call.
 */
export const AcceptExtractedTxnSchema = z.object({
  accountId: z.uuid(),
  occurredAt: z.iso.date(),
  amountPaise: z.number().int().positive(),
  direction: TxnDirectionSchema,
  merchant: z.string().min(1),
  categoryId: z.uuid().nullable().default(null),
});
export type AcceptExtractedTxn = z.input<typeof AcceptExtractedTxnSchema>;

/**
 * Accept two paired drafts as a single account-to-account transfer: the debit
 * leg (`outId`) leaves `fromAccountId`, the credit leg (`inId`) lands in
 * `toAccountId`. The server takes the amount from the drafts themselves, creates
 * both ledger legs, and links them — so a transfer never counts as income+expense.
 */
export const AcceptTransferSchema = z.object({
  outId: z.uuid(),
  inId: z.uuid(),
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  occurredAt: z.iso.date(),
});
export type AcceptTransfer = z.input<typeof AcceptTransferSchema>;

/**
 * Accept a single credit draft (a card-repayment alert) as a transfer: the
 * paying account (`fromAccountId`) debits, the card (`cardAccountId`) credits.
 * There is no `draftId` here — the draft is identified by the route path, not
 * the body — and no amount override: the amount always comes from the claimed
 * draft server-side. The server either reuses an existing eligible debit on
 * `fromAccountId` or creates one; see `acceptRepayment`.
 */
export const AcceptRepaymentSchema = z
  .object({
    cardAccountId: z.uuid(),
    fromAccountId: z.uuid(),
    occurredAt: z.iso.date(),
  })
  .refine((v) => v.fromAccountId !== v.cardAccountId, {
    message: "The paying account must be different from the card",
    path: ["fromAccountId"],
  });
export type AcceptRepayment = z.input<typeof AcceptRepaymentSchema>;

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

/** BullMQ queue the API produces to and the ingestor consumes, to run a sync pass on demand. */
export const INGESTOR_QUEUE = "ingestor.run";

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

/**
 * Queue-sync request. A user asks the ingestor to run a pass; it fires after
 * `windowMinutes` (a rolling delay), and repeated requests within that window
 * coalesce into a single run. The window is the user-configurable part.
 */
export const SYNC_WINDOW_MINUTES = [5, 10, 15, 30] as const;
export const QueueSyncSchema = z.object({
  windowMinutes: z
    .union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)])
    .default(5),
});
export type QueueSync = z.input<typeof QueueSyncSchema>;

export const QueueSyncResultSchema = z.object({
  ok: z.literal(true),
  /** how many minutes until the coalesced pass runs */
  runsInMinutes: z.number().int(),
});
export type QueueSyncResult = z.infer<typeof QueueSyncResultSchema>;
