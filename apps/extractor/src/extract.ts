import { createHash } from "node:crypto";
import { z } from "zod";
import { extractJson, type AiProvider } from "@compass/ai";
import {
  EmailClassSchema,
  TxnDirectionSchema,
  type EmailClass,
  type EmailIngestStatus,
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
  counterparty: z.string().default(""),
  accountHint: z.string().default(""),
  bankRef: z.string().nullable().default(null),
  sourceQuote: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});

const ModelResultSchema = z.object({
  classification: EmailClassSchema,
  transactions: z.array(ModelTxnSchema).default([]),
});

const EXTRACT_SYSTEM = [
  "You extract transactions from a personal-finance email (bank/card alerts, bills, statements).",
  "Return ONLY a JSON object, no prose, shaped exactly:",
  '{"classification": <class>, "transactions": [<txn>, ...]}',
  "",
  "<class> is one of: transaction_alert, card_statement, bill, otp, promo, other.",
  "If the mail is a one-time password, marketing/promo, or anything with no transaction, use otp/promo/other and return an empty transactions array.",
  "",
  "Each <txn> is:",
  '{"amount": number (rupees, positive), "direction": "debit"|"credit",',
  ' "date": "YYYY-MM-DD" or null, "counterparty": string (merchant/payer/payee),',
  ' "accountHint": string (last 4 digits or account/card name the mail names, else ""),',
  ' "bankRef": string or null (UTR / reference / transaction id), "sourceQuote": string (verbatim snippet the amount came from),',
  ' "confidence": number 0..1}',
  "",
  "direction: debit = money LEAVING the user (spend, payment, withdrawal, purchase); credit = money ENTERING (refund, salary, received, cashback).",
  "Extract every distinct transaction; a statement may list many. Never invent figures — if a field is unknown use null or \"\". Amounts are Indian Rupees.",
].join("\n");

function userPrompt(email: ParsedEmail): string {
  return [
    `Subject: ${email.subject}`,
    `From: ${email.from}`,
    "",
    email.body,
  ].join("\n");
}

// ---------------------------------------------------------------------------

export interface InboxRow {
  amountPaise: number;
  direction: TxnDirection;
  occurredAt: string | null;
  counterparty: string;
  suggestedAccountId: string | null;
  bankRef: string | null;
  sourceQuote: string;
  confidence: number;
  dedupeHash: string;
}

export interface ExtractionOutcome {
  classification: EmailClass;
  status: EmailIngestStatus;
  rows: InboxRow[];
}

export interface AccountRef {
  id: string;
  name: string;
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
 * Best-effort account match from the mail's hint. Only matches on a 3–4 digit
 * run (a card/account last-4) that appears in exactly one account name — high
 * precision, so a wrong guess never silently mis-assigns. Null otherwise; the
 * reviewer picks the account on accept.
 */
export function matchAccount(hint: string, accounts: AccountRef[]): string | null {
  const digits = hint.match(/\d{3,4}/g);
  if (!digits || digits.length === 0) return null;
  for (const run of digits) {
    const hits = accounts.filter((a) => a.name.includes(run));
    if (hits.length === 1) return hits[0]!.id;
  }
  return null;
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

/** Ask the model to classify + extract, returning validated model output. */
export async function classifyAndExtract(
  email: ParsedEmail,
  ai: AiProvider,
): Promise<z.infer<typeof ModelResultSchema>> {
  const turn = await ai.chat({
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userPrompt(email) }],
    tools: [],
    maxTokens: 2048,
  });
  const parsed = ModelResultSchema.safeParse(extractJson(turn.text));
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
  ctx: { receivedDate: string | null; accounts: AccountRef[] },
): Promise<ExtractionOutcome> {
  const model = await classifyAndExtract(email, ai);
  const { status, extract } = decideStatus(model.classification);
  if (!extract) return { classification: model.classification, status, rows: [] };

  const rows: InboxRow[] = [];
  for (const t of model.transactions) {
    const amountPaise = Math.round(Math.abs(t.amount) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) continue; // discard junk amounts
    const occurredAt = validIsoDate(t.date) ?? ctx.receivedDate;
    const base = {
      amountPaise,
      direction: t.direction,
      occurredAt,
      counterparty: t.counterparty.trim(),
      bankRef: t.bankRef?.trim() || null,
    };
    rows.push({
      ...base,
      suggestedAccountId: matchAccount(t.accountHint, ctx.accounts),
      sourceQuote: t.sourceQuote.trim(),
      confidence: t.confidence,
      dedupeHash: dedupeHashFor(base),
    });
  }
  return { classification: model.classification, status, rows };
}
