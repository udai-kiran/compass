import { createHash } from "node:crypto";
import { z } from "zod";
import { extractJson, type AiProvider, type ToolSpec } from "@compass/ai";
import {
  EmailClassSchema,
  redactPii,
  TxnDirectionSchema,
  type EmailClass,
  type EmailIngestStatus,
  type RedactionIdentity,
  type TxnDirection,
} from "@compass/shared";
import type { ParsedEmail } from "./email.ts";

// ---------------------------------------------------------------------------
// Model I/O — the model reports amounts in rupees (it handles "₹1,234.56"
// far more reliably than paise); we convert to integer paise ourselves.
// ---------------------------------------------------------------------------

const ModelTxnSchema = z.object({
  amount: z.number(),
  direction: TxnDirectionSchema,
  date: z.string().nullable().default(null),
  /** 24-hour "HH:MM" the line prints, or null — sharpens statement↔ledger matching */
  time: z.string().nullable().default(null),
  counterparty: z.string().default(""),
  accountHint: z.string().default(""),
  /** best-fit category NAME, chosen verbatim from the list we pass in, or "" */
  category: z.string().default(""),
  bankRef: z.string().nullable().default(null),
  sourceQuote: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  /**
   * The model's classification of a credit's purpose. Field-local normalization:
   * any unknown/wrong-typed value is caught and coerced to null here, rather than
   * failing the whole ModelResultSchema.safeParse — a bare z.enum would reject one
   * bad `intent` and silently discard every transaction in the same extraction.
   */
  intent: z.enum(["repayment", "refund", "cashback"]).nullable().catch(null).default(null),
});

const ModelResultSchema = z.object({
  classification: EmailClassSchema,
  transactions: z.array(ModelTxnSchema).default([]),
});

/**
 * Validation schema for the statement-transactions path — transactions only, no
 * `classification` (`extractStatementTxns` never reads one). Accepts a
 * tool-input reply shaped `{"transactions":[...]}` AND the legacy/unchanged
 * fallback-text shape `{"classification":"card_statement","transactions":[...]}`,
 * since Zod objects silently ignore unrecognized keys by default.
 */
const StatementTxnResultSchema = z.object({
  transactions: z.array(ModelTxnSchema).default([]),
});

// ---------------------------------------------------------------------------
// Forced-tool-call structured output (additive to the prose-JSON shape above).
// Hand-written JSON Schemas (no zod-to-json-schema dependency), matching the
// convention in apps/api/src/services/ai/tools.ts. `additionalProperties` is
// deliberately left UNSET (permissive) on every object schema below — matches
// that existing convention, not an oversight.
//
// Nullable-field encoding, applied uniformly: a plain nullable scalar is
// `{ type: [<base>, "null"] }`; a nullable enum includes `null` directly in its
// `enum` array (a plain `type` union does not work for an `enum` field).
// ---------------------------------------------------------------------------

/**
 * Per-transaction item shape shared by the email and statement transaction
 * tools. `required: ["amount", "direction"]` mirrors Zod's true required
 * fields — every other field has a Zod `.default()`/`.nullable().default()`
 * and is correspondingly OPTIONAL here. `accountHint`'s description differs
 * between the email and statement tools (the caller supplies it, or omits it
 * entirely for the email tool, which has no fixed guidance for that field).
 */
function txnItemSchema(accountHintDescription?: string): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      // "positive rupee value" is guidance only — no minimum/exclusiveMinimum;
      // toInboxRow already takes Math.abs() of whatever the model returns.
      amount: { type: "number", description: "positive rupee value" },
      direction: { type: "string", enum: ["debit", "credit"] },
      date: { type: ["string", "null"] },
      time: {
        type: ["string", "null"],
        description: "24-hour HH:MM if the mail states a transaction time, else null",
      },
      counterparty: { type: "string" },
      accountHint: accountHintDescription
        ? { type: "string", description: accountHintDescription }
        : { type: "string" },
      category: {
        type: "string",
        description:
          'must be chosen verbatim from the Categories list in the user message, or "" if none fits',
      },
      bankRef: { type: ["string", "null"], description: "UTR / reference / transaction id" },
      sourceQuote: { type: "string", description: "verbatim snippet the amount came from" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      intent: { enum: ["repayment", "refund", "cashback", null] },
    },
    required: ["amount", "direction"],
  };
}

/**
 * Forces the model to record the email's classification + transactions in one
 * structured call. Top-level `required` deliberately tightens Zod's own
 * permissiveness (Zod defaults `transactions` to `[]` if absent) — this just
 * forces the model to be explicit that it checked.
 */
const RECORD_TXNS_TOOL: ToolSpec = {
  name: "record_transactions",
  description: "Record the email's classification and every transaction it contains.",
  inputSchema: {
    type: "object",
    properties: {
      classification: {
        type: "string",
        enum: ["transaction_alert", "card_statement", "bill", "otp", "promo", "other"],
      },
      transactions: { type: "array", items: txnItemSchema() },
    },
    required: ["classification", "transactions"],
  },
};

export const EXTRACT_SYSTEM = [
  "You extract transactions from a personal-finance email (bank/card alerts, bills, statements).",
  "Return ONLY a JSON object, no prose, shaped exactly:",
  '{"classification": <class>, "transactions": [<txn>, ...]}',
  "",
  "<class> is one of: transaction_alert, card_statement, bill, otp, promo, other.",
  "If the mail is a one-time password, marketing/promo, or anything with no transaction, use otp/promo/other and return an empty transactions array.",
  "",
  "Each <txn> is:",
  '{"amount": number (rupees, positive), "direction": "debit"|"credit",',
  ' "date": "YYYY-MM-DD" or null, "time": "HH:MM" 24-hour if the mail states a transaction time, else null,',
  ' "counterparty": string (merchant/payer/payee),',
  ' "accountHint": string (last 4 digits or account/card name the mail names, else ""),',
  ' "category": string (best-fit category NAME for the merchant, chosen VERBATIM from the Categories list in the user message — expense names for a debit, income names for a credit — or "" if none fits),',
  ' "bankRef": string or null (UTR / reference / transaction id), "sourceQuote": string (verbatim snippet the amount came from),',
  ' "confidence": number 0..1, "intent": "repayment"|"refund"|"cashback"|null}',
  "",
  "direction: debit = money LEAVING the user (spend, payment, withdrawal, purchase); credit = money ENTERING (refund, salary, received, cashback).",
  "category: infer it from the merchant/counterparty (e.g. a food-delivery brand → Food). Only ever return a name that appears in the provided list; if unsure or the list is empty, return \"\".",
  "intent: classify a credit's purpose. A credit that is a BILL PAYMENT to a credit card — \"PAYMENT RECEIVED\", \"BBPS\"/\"BPPY\", autopay, a NEFT/UPI/cheque payment, \"payment thank you\" — is a transfer/repayment, NOT income: set intent to \"repayment\". A genuine refund (money returned for a purchase) is intent \"refund\"; card/wallet cashback is intent \"cashback\" — both may still take an income category if one fits. For a debit, or any credit that is none of the above (salary, interest, etc.), leave intent null.",
  "date: output YYYY-MM-DD (ISO). Emails are INDIAN and print dates DAY-FIRST: all-numeric dates like DD-MM-YY, DD-MM-YYYY, DD/MM/YYYY are day-month-year. E.g. 24-07-26 and 24/07/2026 both mean 24 July 2026 → output 2026-07-24. A 2-digit year expands to 20YY. A date already in ISO YYYY-MM-DD is correct — output it unchanged. A textual date with a month name (e.g. 27 May 26) is unambiguous — keep its day and month, just expand a 2-digit year to 20YY.",
  "Extract every distinct transaction; a statement may list many. Never invent figures — if a field is unknown use null or \"\". Amounts are Indian Rupees.",
].join("\n");

/** The user's category names for the model to pick from verbatim; "" when none. */
function categoryLines(categories: CategoryRef[]): string {
  if (categories.length === 0) return "";
  const names = (kind: CategoryRef["kind"]) =>
    categories
      .filter((c) => c.kind === kind)
      .map((c) => c.name)
      .join(", ") || "(none)";
  return [
    'Categories (choose a name verbatim for `category`, or "" if none fits):',
    `- expense (for debits): ${names("expense")}`,
    `- income (for credits): ${names("income")}`,
  ].join("\n");
}

function userPrompt(email: ParsedEmail, categories: CategoryRef[], identity: RedactionIdentity): string {
  const cats = categoryLines(categories);
  // Redact the user's PII before it reaches the model. Subject/From carry the
  // bank/merchant sender the classifier needs, so only the user's own known
  // identifiers are stripped there; the body gets the full structural pass.
  return [
    `Subject: ${redactPii(email.subject, identity, { structural: false })}`,
    `From: ${redactPii(email.from, identity, { structural: false })}`,
    ...(cats ? ["", cats] : []),
    "",
    redactPii(email.body, identity),
  ].join("\n");
}

// ---------------------------------------------------------------------------

export interface InboxRow {
  amountPaise: number;
  direction: TxnDirection;
  occurredAt: string | null;
  /** ISO instant when the source printed a time (date + time, IST); else null */
  occurredAtTs: string | null;
  counterparty: string;
  suggestedAccountId: string | null;
  suggestedCategoryId: string | null;
  bankRef: string | null;
  sourceQuote: string;
  confidence: number;
  dedupeHash: string;
  /** repayment/refund/cashback classification of a credit, or null (see misc-01) */
  intent: "repayment" | "refund" | "cashback" | null;
}

export interface ExtractionOutcome {
  classification: EmailClass;
  status: EmailIngestStatus;
  rows: InboxRow[];
}

export interface AccountRef {
  id: string;
  name: string;
  /** the account's stored last-4 (e.g. "5739"); the strongest match signal */
  accountLast4: string | null;
  /** last-4 of the account's linked debit card; matches debit-card alert emails */
  debitCardLast4: string | null;
  /** issuing bank, used only to break a last-4 tie between two institutions */
  institution: string | null;
}

export interface CategoryRef {
  id: string;
  name: string;
  kind: "income" | "expense";
}

/** How an ingested email settles once classified. v1 defers PDF statements. */
export function decideStatus(classification: EmailClass): {
  status: EmailIngestStatus;
  extract: boolean;
} {
  switch (classification) {
    case "transaction_alert":
    case "bill":
      return { status: "extracted", extract: true };
    case "card_statement":
      // Recognized, but statement bodies are PDF attachments — handled later.
      return { status: "deferred", extract: false };
    default:
      return { status: "ignored", extract: false };
  }
}

/**
 * Best-effort account match from the mail's hint. A bank alert names the last 4
 * digits ("A/C XXXXXXX5739") or a debit-card alert names the card's last 4, so we
 * pull the 3–4 digit runs out of the hint and:
 *   1. match a run exactly against an account's stored last-4 OR its linked
 *      debit-card last-4 (the strong signal); if two accounts share a last-4, the
 *      bank named in the hint breaks the tie;
 *   2. failing that, fall back to a run appearing in exactly one account name
 *      (covers accounts whose last-4 was typed into the label, not the field).
 * Only a unique hit wins — a wrong guess never silently mis-assigns. Null
 * otherwise; the reviewer picks the account on accept.
 */
export function matchAccount(hint: string, accounts: AccountRef[]): string | null {
  const digits = hint.match(/\d{3,4}/g);
  if (!digits || digits.length === 0) return null;
  const lower = hint.toLowerCase();
  for (const run of digits) {
    const hits = accounts.filter(
      (a) => a.accountLast4 === run || a.debitCardLast4 === run,
    );
    if (hits.length === 1) return hits[0]!.id;
    if (hits.length > 1) {
      const byBank = hits.filter(
        (a) => a.institution && lower.includes(a.institution.toLowerCase()),
      );
      if (byBank.length === 1) return byBank[0]!.id;
    }
  }
  for (const run of digits) {
    const hits = accounts.filter((a) => a.name.includes(run));
    if (hits.length === 1) return hits[0]!.id;
  }
  return null;
}

/**
 * Resolve the model's category guess to one of the user's own categories.
 * The guess must match a category NAME (case-insensitive) of the right kind —
 * expense for a debit, income for a credit — so a spend can't be tagged with an
 * income category. No match → null, and the reviewer picks it. Never creates a
 * category; it only points at an existing one.
 */
export function matchCategory(
  label: string,
  direction: TxnDirection,
  categories: CategoryRef[],
): string | null {
  const want = label.trim().toLowerCase();
  if (!want) return null;
  const kind = direction === "credit" ? "income" : "expense";
  const hit = categories.find(
    (c) => c.kind === kind && c.name.trim().toLowerCase() === want,
  );
  return hit ? hit.id : null;
}

/**
 * A calendar-valid `YYYY-MM-DD`, or null. Format alone isn't enough — the model
 * can emit `2026-99-42`, which Postgres would reject and take the whole
 * saveResults transaction down with it. Round-trips through Date to reject
 * impossible months/days (including `2026-02-30`).
 */
export function validIsoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return ok ? value : null;
}

/**
 * Combine a valid ISO date with a printed "HH:MM"[":SS"] into an instant, read as
 * IST (statements/alerts print wall-clock IST) — both sides of a match are built
 * the same way, so the same transaction yields the same instant. Null unless both
 * a valid date and a valid time are present; a date alone carries no precision.
 */
export function istTimestamp(isoDate: string | null, time: string | null): string | null {
  if (!isoDate || !time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  // +05:30 = IST; Date normalizes it to a UTC instant for storage/comparison.
  const dt = new Date(`${isoDate}T${p(hh)}:${p(mm)}:${p(ss)}+05:30`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Stable dedupe key: the bank reference when present, else a signature hash. */
export function dedupeHashFor(row: {
  amountPaise: number;
  direction: TxnDirection;
  occurredAt: string | null;
  counterparty: string;
  bankRef: string | null;
}): string {
  const ref = row.bankRef?.trim().toLowerCase();
  if (ref) return `ref:${ref}`;
  const sig = `${row.amountPaise}|${row.direction}|${row.occurredAt ?? ""}|${row.counterparty.trim().toLowerCase()}`;
  return `sig:${createHash("sha256").update(sig).digest("hex").slice(0, 32)}`;
}

type ModelTxn = z.infer<typeof ModelTxnSchema>;

/**
 * Normalize one model transaction into a persistable inbox row: rupees → paise,
 * date fallback to the received date, category match, dedupe hash. Returns null
 * for a junk (zero/negative) amount. Shared by email and statement extraction.
 */
function toInboxRow(
  t: ModelTxn,
  ctx: { receivedDate: string | null; categories: CategoryRef[] },
  suggestedAccountId: string | null,
): InboxRow | null {
  const amountPaise = Math.round(Math.abs(t.amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return null;
  const validDate = validIsoDate(t.date);
  const occurredAt = validDate ?? ctx.receivedDate;
  const base = {
    amountPaise,
    direction: t.direction,
    occurredAt,
    counterparty: t.counterparty.trim(),
    bankRef: t.bankRef?.trim() || null,
  };
  return {
    ...base,
    // Precise instant only when the line named both a date and a time.
    occurredAtTs: istTimestamp(validDate, t.time),
    suggestedAccountId,
    suggestedCategoryId: matchCategory(t.category, t.direction, ctx.categories),
    sourceQuote: t.sourceQuote.trim(),
    confidence: t.confidence,
    dedupeHash: dedupeHashFor(base),
    intent: t.intent,
  };
}

/** Ask the model to classify + extract, returning validated model output. */
export async function classifyAndExtract(
  email: ParsedEmail,
  ai: AiProvider,
  categories: CategoryRef[],
  identity: RedactionIdentity,
): Promise<z.infer<typeof ModelResultSchema>> {
  // Ollama never gets a forced tool call — only the prompt (unchanged either
  // way). The gate relies on AiProvider.name === "ollama" being the real Ollama
  // provider's contract (factory.ts's createOllamaProvider); brittle only for a
  // hypothetical future provider that wraps Ollama under a different name.
  const structured = ai.name !== "ollama";
  const turn = await ai.chat({
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt(email, categories, identity) }],
    tools: structured ? [RECORD_TXNS_TOOL] : [],
    toolChoice: structured ? RECORD_TXNS_TOOL.name : undefined,
    maxTokens: 2048,
    // A statement email's HTML body is bigger than an alert's; a slow reasoning
    // model can exceed the default 30s, so allow more before giving up.
    timeoutMs: 90_000,
  });
  // Fail-closed, exact-name selection: a tool call is never taken by position.
  // Exactly one matching-named call → use its input; zero → fall back to the
  // prose-JSON text (covers Ollama and any provider that ignores toolChoice);
  // two-or-more → fail closed with NO fallback to text at all (an arbitrary
  // pick among conflicting tool calls would be unsafe).
  const matches = turn.toolCalls.filter((c) => c.name === RECORD_TXNS_TOOL.name);
  let parsed: ReturnType<typeof ModelResultSchema.safeParse>;
  if (matches.length === 1) {
    parsed = ModelResultSchema.safeParse(matches[0]!.input);
  } else if (matches.length === 0) {
    parsed = ModelResultSchema.safeParse(extractJson(turn.text));
  } else {
    parsed = ModelResultSchema.safeParse(undefined); // 2+ matches: fail closed, never touches turn.text
  }
  // Unparseable output is treated as "nothing to see here" rather than a crash;
  // the raw email is retained so it can be replayed after a prompt fix.
  if (!parsed.success) return { classification: "other", transactions: [] };
  return parsed.data;
}

/**
 * Full extraction for one parsed email: classify, and when the class carries
 * transactions, normalize each draft into a persistable inbox row (rupees →
 * paise, date fallback to the received date, account match, dedupe hash).
 */
export async function runExtraction(
  email: ParsedEmail,
  ai: AiProvider,
  ctx: {
    receivedDate: string | null;
    accounts: AccountRef[];
    categories: CategoryRef[];
    identity: RedactionIdentity;
  },
): Promise<ExtractionOutcome> {
  const model = await classifyAndExtract(email, ai, ctx.categories, ctx.identity);
  const { status, extract } = decideStatus(model.classification);
  if (!extract) return { classification: model.classification, status, rows: [] };

  const rows: InboxRow[] = [];
  for (const t of model.transactions) {
    const row = toInboxRow(t, ctx, matchAccount(t.accountHint, ctx.accounts));
    if (row) rows.push(row);
  }
  return { classification: model.classification, status, rows };
}

// ---------------------------------------------------------------------------
// Credit-card statement extraction (the PDF's text, once decrypted)
// ---------------------------------------------------------------------------

/**
 * Cap the statement text fed to the model. Sized to hold a long multi-page
 * statement's transaction section; the caller warns if the real text exceeds it
 * (some transactions could then be missing).
 */
export const MAX_STATEMENT_CHARS = 60_000;

export const STATEMENT_SYSTEM = [
  "You extract EVERY transaction from the text of a CREDIT-CARD STATEMENT.",
  'Return ONLY a JSON object, no prose: {"classification": "card_statement", "transactions": [<txn>, ...]}',
  "",
  "Each <txn> is:",
  '{"amount": number (rupees, positive), "direction": "debit"|"credit",',
  ' "date": "YYYY-MM-DD" or null, "time": "HH:MM" 24-hour if the line prints a transaction time, else null,',
  ' "counterparty": string (the merchant/description),',
  ' "accountHint": "", "category": string (best-fit category NAME chosen verbatim from the list — expense for a debit, income for a credit — or ""),',
  ' "bankRef": string or null, "sourceQuote": string (the verbatim statement line), "confidence": number 0..1, "intent": "repayment"|"refund"|"cashback"|null}',
  "",
  "A transaction line looks like: DATE  DESCRIPTION  AMOUNT  <C|D>.",
  'direction: a "D" (debit) is a purchase/spend on the card → "debit"; a "C" (credit) is a payment received, refund, or cashback → "credit".',
  'A credit that is a BILL PAYMENT to the card — "PAYMENT RECEIVED", "BBPS"/"BPPY", autopay, a NEFT/UPI/cheque payment, "payment thank you" — is a transfer/repayment, NOT income: keep direction "credit" but set its category to "" AND its intent to "repayment". A genuine refund is intent "refund"; cashback is intent "cashback" — only these two may still take an income category if one fits. For a debit, or any other credit (salary, interest, etc.), leave intent null.',
  "date: output YYYY-MM-DD (ISO). Statements are INDIAN and print dates DAY-FIRST: all-numeric dates like DD-MM-YY, DD-MM-YYYY, DD/MM/YYYY are day-month-year. E.g. 24-07-26 and 24/07/2026 both mean 24 July 2026 → output 2026-07-24. A 2-digit year expands to 20YY. A date already in ISO YYYY-MM-DD is correct — output it unchanged. A textual date with a month name (e.g. 27 May 26) is unambiguous — keep its day and month, just expand a 2-digit year to 20YY.",
  "Extract every dated transaction in the statement period. Ignore summary, subtotal, interest-explanation and marketing lines that aren't dated transactions. In particular NEVER emit balance/summary lines as transactions: Opening Balance, Previous/Closing Balance, Balance B/F or C/F, Total Amount Due, Minimum Amount Due, and any running-balance figure are NOT transactions. Never invent figures. Amounts are Indian Rupees.",
].join("\n");

/**
 * Forces the model to record every statement transaction in one structured
 * call. No `classification` property at all — `extractStatementTxns` never
 * reads one, only `.transactions` (see `StatementTxnResultSchema`).
 */
const RECORD_STATEMENT_TXNS_TOOL: ToolSpec = {
  name: "record_statement_transactions",
  description: "Record every transaction found in the credit-card statement text.",
  inputSchema: {
    type: "object",
    properties: {
      transactions: {
        type: "array",
        items: txnItemSchema('always "" for a statement line — the card is already known'),
      },
    },
    required: ["transactions"],
  },
};

/**
 * Extract every transaction from a decrypted statement's text. The card is
 * already known — its stored password opened the PDF — so every row is suggested
 * against that account. Reuses the same normalization as email extraction.
 */
export async function extractStatementTxns(
  text: string,
  ai: AiProvider,
  ctx: { receivedDate: string | null; categories: CategoryRef[]; accountId: string | null },
): Promise<InboxRow[]> {
  const cats = categoryLines(ctx.categories);
  const structured = ai.name !== "ollama";
  const turn = await ai.chat({
    system: STATEMENT_SYSTEM,
    messages: [
      { role: "user", content: `${cats ? `${cats}\n\n` : ""}STATEMENT:\n${text.slice(0, MAX_STATEMENT_CHARS)}` },
    ],
    tools: structured ? [RECORD_STATEMENT_TXNS_TOOL] : [],
    toolChoice: structured ? RECORD_STATEMENT_TXNS_TOOL.name : undefined,
    maxTokens: 4096,
    // A whole statement is a big prompt; a slow reasoning model needs well over
    // the default 30s. Give it up to 3 minutes — but only one retry, so a
    // genuinely stuck call can't occupy the worker for the full 3×.
    timeoutMs: 180_000,
    retries: 1,
  });
  const matches = turn.toolCalls.filter((c) => c.name === RECORD_STATEMENT_TXNS_TOOL.name);
  let parsed: ReturnType<typeof StatementTxnResultSchema.safeParse>;
  if (matches.length === 1) {
    parsed = StatementTxnResultSchema.safeParse(matches[0]!.input);
  } else if (matches.length === 0) {
    parsed = StatementTxnResultSchema.safeParse(extractJson(turn.text));
  } else {
    parsed = StatementTxnResultSchema.safeParse(undefined); // 2+ matches: fail closed, never touches turn.text
  }
  if (!parsed.success) return [];
  const rows: InboxRow[] = [];
  for (const t of parsed.data.transactions) {
    const row = toInboxRow(t, ctx, ctx.accountId);
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Statement summary — the totals + reward-points block the transaction pass
// deliberately skips. Feeds reward tracking now and statement reconciliation
// later. Best-effort: a parse failure returns null and never fails the job.
// ---------------------------------------------------------------------------

const StatementSummarySchema = z.object({
  totalAmountDue: z.number().nullable().default(null),
  minimumAmountDue: z.number().nullable().default(null),
  statementDate: z.string().nullable().default(null),
  rewardPoints: z
    .object({
      opening: z.number().nullable().default(null),
      earned: z.number().nullable().default(null),
      redeemed: z.number().nullable().default(null),
      closing: z.number().nullable().default(null),
    })
    .default(() => ({ opening: null, earned: null, redeemed: null, closing: null })),
});

export interface StatementRewards {
  opening: number | null;
  earned: number | null;
  redeemed: number | null;
  closing: number | null;
}

export interface StatementSummary {
  /** signed against how the statement reads: due amounts are positive rupees→paise */
  totalDuePaise: number | null;
  minDuePaise: number | null;
  /** statement close date, YYYY-MM-DD */
  statementDate: string | null;
  rewards: StatementRewards;
}

export const STATEMENT_SUMMARY_SYSTEM = [
  "From a CREDIT-CARD STATEMENT's summary (not the transaction rows), extract only:",
  'Return ONLY JSON, no prose: {"totalAmountDue": number|null, "minimumAmountDue": number|null,',
  ' "statementDate": "YYYY-MM-DD"|null (the statement/closing date),',
  ' "rewardPoints": {"opening": int|null, "earned": int|null, "redeemed": int|null, "closing": int|null}}',
  "",
  "Amounts are Indian Rupees (a number, no symbols/commas). Reward points are whole",
  "numbers. `redeemed` is a POSITIVE count of points redeemed/adjusted-down this",
  "cycle (0 if none). `closing` is the reward-points balance as on the statement",
  "date (labels vary: 'Total/Net Reward Points', 'Points Balance', 'Closing'). Use",
  "null for any field the statement doesn't state. Never invent numbers.",
].join("\n");

/**
 * Forces the model to record the statement summary in one structured call.
 * Top-level `required: []` — every field of `StatementSummarySchema`,
 * INCLUDING `rewardPoints` itself, has a Zod `.default()`, so nothing is
 * required, fully mirroring that permissiveness: the summary pass is
 * explicitly best-effort and must never be pressured into fabricating a value
 * it doesn't have — "never invent numbers" stays governing, unchanged, in the
 * prompt. Reward-point fields are typed `integer` here — deliberately
 * stricter than the current Zod `z.number()` — matching the prompt's existing
 * "reward points are whole numbers" instruction and the runtime's
 * `Math.round`, not a literal mirror of the Zod type.
 */
const RECORD_STATEMENT_SUMMARY_TOOL: ToolSpec = {
  name: "record_statement_summary",
  description:
    "Record the statement's total/minimum amount due, statement date, and reward-points summary.",
  inputSchema: {
    type: "object",
    properties: {
      totalAmountDue: { type: ["number", "null"] },
      minimumAmountDue: { type: ["number", "null"] },
      statementDate: { type: ["string", "null"] },
      rewardPoints: {
        type: "object",
        properties: {
          opening: { type: ["integer", "null"] },
          earned: { type: ["integer", "null"] },
          redeemed: {
            type: ["integer", "null"],
            description: "a POSITIVE count of points redeemed/adjusted-down this cycle",
          },
          closing: {
            type: ["integer", "null"],
            description: "the reward-points balance AS ON the statement date",
          },
        },
        required: [],
      },
    },
    required: [],
  },
};

/** Round rupees to integer paise; null passes through. */
function rupeesToPaise(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

/**
 * Pull the summary block (totals + reward points) from a statement's text. The
 * card is already known (its password opened the PDF). Returns null on a parse
 * failure — rewards are best-effort and must never sink the whole extraction.
 */
export async function extractStatementSummary(
  text: string,
  ai: AiProvider,
): Promise<StatementSummary | null> {
  const structured = ai.name !== "ollama";
  const turn = await ai.chat({
    system: STATEMENT_SUMMARY_SYSTEM,
    messages: [{ role: "user", content: `STATEMENT:\n${text.slice(0, MAX_STATEMENT_CHARS)}` }],
    tools: structured ? [RECORD_STATEMENT_SUMMARY_TOOL] : [],
    toolChoice: structured ? RECORD_STATEMENT_SUMMARY_TOOL.name : undefined,
    maxTokens: 512,
    timeoutMs: 120_000,
    retries: 1,
  });
  const matches = turn.toolCalls.filter((c) => c.name === RECORD_STATEMENT_SUMMARY_TOOL.name);
  let parsed: ReturnType<typeof StatementSummarySchema.safeParse>;
  if (matches.length === 1) {
    parsed = StatementSummarySchema.safeParse(matches[0]!.input);
  } else if (matches.length === 0) {
    parsed = StatementSummarySchema.safeParse(extractJson(turn.text));
  } else {
    parsed = StatementSummarySchema.safeParse(undefined); // 2+ matches: fail closed, never touches turn.text
  }
  if (!parsed.success) return null;
  const d = parsed.data;
  const asInt = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    totalDuePaise: rupeesToPaise(d.totalAmountDue),
    minDuePaise: rupeesToPaise(d.minimumAmountDue),
    statementDate: validIsoDate(d.statementDate),
    rewards: {
      opening: asInt(d.rewardPoints.opening),
      earned: asInt(d.rewardPoints.earned),
      redeemed: asInt(d.rewardPoints.redeemed),
      closing: asInt(d.rewardPoints.closing),
    },
  };
}

/** One reward-ledger delta to write for a statement (points signed, +earn/−redeem). */
export interface RewardDelta {
  points: number;
  note: string;
}

/** True when a statement gave us at least one reward number worth recording. */
export function hasRewardData(r: StatementRewards): boolean {
  return r.opening !== null || r.earned !== null || r.redeemed !== null || r.closing !== null;
}

/**
 * Turn a statement's reward summary into ledger deltas. Earned and redeemed
 * become their own signed entries; when the statement states a closing balance
 * (authoritative) a reconciling adjustment is added so the account's running sum
 * lands exactly on it — self-healing across a missed statement or a drifted
 * manual entry. `baseSum` is the sum of the account's OTHER reward entries (this
 * statement's excluded). Returns [] when there's nothing to record.
 */
export function computeStatementRewardEntries(
  baseSum: number,
  rewards: StatementRewards,
  periodLabel: string,
): RewardDelta[] {
  const out: RewardDelta[] = [];
  const earned = rewards.earned ?? 0;
  const redeemed = rewards.redeemed ?? 0;
  if (earned !== 0) out.push({ points: earned, note: `${periodLabel}: earned` });
  if (redeemed !== 0) out.push({ points: -redeemed, note: `${periodLabel}: redeemed` });
  if (rewards.closing !== null) {
    const adjustment = rewards.closing - (baseSum + earned - redeemed);
    if (adjustment !== 0) out.push({ points: adjustment, note: `${periodLabel}: balance adjustment` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statement dedupe: match statement lines to ledger transactions already
// recorded from real-time alerts during the cycle, so the statement doesn't
// re-book what's already there.
//
// Match is exact signed amount + a date window. The window matters because a
// spend near the cycle close posts a few days later and can land on the *next*
// statement — so we never bucket by the statement period; we compare each line
// to the ledger by the line's own date ± window. Merchant text only breaks
// ties. Matching is mutual-best 1↔1: a line and a ledger row pair only when
// each is the other's single best candidate, so two same-amount spends near the
// same day stay unmatched (left for review) rather than being mis-linked. A
// near-close spend that isn't on this statement simply doesn't match here and
// carries forward to the statement that does list it. Pure and testable.
// ---------------------------------------------------------------------------

/** A ledger transaction, as stored: signed paise (debit negative). */
export interface LedgerTxn {
  id: string;
  amountPaise: number;
  date: string; // YYYY-MM-DD
  /** ISO instant when the row carries a precise time (from an alert); else null */
  occurredAtTs: string | null;
  merchant: string;
}

/** A statement line to reconcile: positive magnitude + direction, as extracted. */
export interface MatchableLine {
  amountPaise: number;
  direction: TxnDirection;
  occurredAt: string | null;
  /** ISO instant when the line prints a time; else null */
  occurredAtTs: string | null;
  counterparty: string;
}

/** Posting-lag window (days) either side of a line's transaction date. */
export const STATEMENT_MATCH_WINDOW_DAYS = 4;

/**
 * How close two printed timestamps must be to be the same authorization. The
 * alert and the statement both report the transaction time, so a genuine pair is
 * near-identical; a couple of minutes absorbs rounding without letting distinct
 * same-amount spends collide.
 */
export const STATEMENT_MATCH_TIME_TOLERANCE_MS = 2 * 60 * 1000;

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 0..1 merchant closeness; 0.5 (neutral) when either name is unknown/empty. */
export function merchantSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0.5;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  const tb = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0.5;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = new Set([...ta, ...tb]).size;
  return shared / union;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** The single highest-scoring candidate, or null when the top two tie (ambiguous). */
function bestUnique<T extends { score: number }>(cands: T[]): T | null {
  if (cands.length === 0) return null;
  let top = cands[0]!;
  let second: T | null = null;
  for (let k = 1; k < cands.length; k += 1) {
    const c = cands[k]!;
    if (c.score > top.score) {
      second = top;
      top = c;
    } else if (!second || c.score > second.score) {
      second = c;
    }
  }
  if (second && second.score === top.score) return null;
  return top;
}

/** A timestamp-locked pair outranks any fuzzy (merchant+date) candidate. */
const TIMESTAMP_LOCK_SCORE = 2;

/**
 * For each line, the id of the ledger transaction it duplicates, or null.
 * Returned array is aligned to `lines`; each ledger txn is claimed at most once.
 *
 * Amount is the anchor (exact signed paise). When both the line and a ledger row
 * carry a printed timestamp, that's the primary key: within tolerance they lock
 * (and outrank any fuzzy candidate); beyond tolerance they're treated as distinct
 * spends and never paired — this is what separates two same-amount, same-day
 * transactions. When either side lacks a timestamp, fall back to the posting-lag
 * date window with merchant text breaking ties. Matching stays mutual-best 1↔1.
 */
export function matchLinesToLedger(
  lines: MatchableLine[],
  ledger: LedgerTxn[],
  windowDays: number = STATEMENT_MATCH_WINDOW_DAYS,
): (string | null)[] {
  const perLine: { j: number; score: number }[][] = lines.map(() => []);
  const perLedger = new Map<number, { i: number; score: number }[]>();
  lines.forEach((line, i) => {
    if (line.occurredAt === null) return;
    const signed = line.direction === "debit" ? -line.amountPaise : line.amountPaise;
    ledger.forEach((t, j) => {
      if (t.amountPaise !== signed) return;
      const dd = daysApart(line.occurredAt!, t.date);
      if (dd > windowDays) return;
      let score: number;
      if (line.occurredAtTs && t.occurredAtTs) {
        const dtMs = Math.abs(Date.parse(line.occurredAtTs) - Date.parse(t.occurredAtTs));
        // Same amount but a different printed time → a different authorization.
        if (dtMs > STATEMENT_MATCH_TIME_TOLERANCE_MS) return;
        score = TIMESTAMP_LOCK_SCORE;
      } else {
        const dateScore = (windowDays - dd) / windowDays;
        score = 0.7 * merchantSimilarity(line.counterparty, t.merchant) + 0.3 * dateScore;
      }
      perLine[i]!.push({ j, score });
      (perLedger.get(j) ?? perLedger.set(j, []).get(j)!).push({ i, score });
    });
  });

  return lines.map((_, i) => {
    const bl = bestUnique(perLine[i]!);
    if (!bl) return null;
    const bj = bestUnique(perLedger.get(bl.j) ?? []);
    // Only when each side is the other's single best — otherwise leave it pending.
    if (!bj || bj.i !== i) return null;
    return ledger[bl.j]!.id;
  });
}

// ---------------------------------------------------------------------------
// Statement reconciliation: the per-(card, cycle) snapshot. Once the lines are
// matched to the ledger, summarize the cycle — how many lines the statement
// listed, how much of that spend is already cleared in the ledger, and which
// ledger rows to stamp. Pure and testable; the worker persists the result.
// ---------------------------------------------------------------------------

/** The statement cycle key "YYYY-MM" from a date, or null when the date is unusable. */
export function statementPeriodKey(isoDate: string | null): string | null {
  const valid = validIsoDate(isoDate);
  return valid ? valid.slice(0, 7) : null;
}

/** Aggregate stats over a statement's lines, plus the ledger rows it cleared. */
export interface ReconciliationStats {
  /** statement transaction lines extracted */
  lineCount: number;
  /** sum of the debit (spend) lines' magnitudes, in paise */
  lineDebitPaise: number;
  /** lines matched to a ledger transaction already recorded this cycle */
  matchedCount: number;
  /**
   * Sum of the matched *debit* (spend) lines' magnitudes, in paise. Only debits
   * count here because this offsets `lineDebitPaise` in the "spend listed vs
   * cleared" delta — a matched refund/credit is not cleared spend and must not
   * shrink that delta. (`matchedCount` still counts every matched line.)
   */
  matchedPaise: number;
  /** lines with no ledger match — new drafts / exceptions to review */
  unmatchedCount: number;
  /** ledger transaction ids to stamp as cleared by this cycle */
  matchedTxnIds: string[];
}

/**
 * Fold the annotated statement rows into a reconciliation summary. A row the
 * matcher tied to the ledger arrives as `status: "duplicate"` with a
 * `matchedTransactionId`; everything else is an unmatched line (a new pending
 * draft or an exception). Debit magnitudes feed the "spend listed vs cleared"
 * delta the review view shows.
 */
export function summarizeMatches(
  rows: Array<{
    amountPaise: number;
    direction: TxnDirection;
    status?: "pending" | "duplicate";
    matchedTransactionId?: string | null;
  }>,
): ReconciliationStats {
  let lineDebitPaise = 0;
  let matchedCount = 0;
  let matchedPaise = 0;
  const matchedTxnIds: string[] = [];
  for (const r of rows) {
    if (r.direction === "debit") lineDebitPaise += r.amountPaise;
    if (r.status === "duplicate" && r.matchedTransactionId) {
      matchedCount += 1;
      // Only matched debits offset the spend delta; a matched credit (refund) is
      // not cleared spend, so counting it would understate unmatched spending.
      if (r.direction === "debit") matchedPaise += r.amountPaise;
      matchedTxnIds.push(r.matchedTransactionId);
    }
  }
  return {
    lineCount: rows.length,
    lineDebitPaise,
    matchedCount,
    matchedPaise,
    unmatchedCount: rows.length - matchedCount,
    matchedTxnIds,
  };
}
