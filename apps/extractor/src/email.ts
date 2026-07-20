import { simpleParser } from "mailparser";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface ParsedEmail {
  subject: string;
  from: string;
  /** plain-text body, HTML stripped to text, collapsed and trimmed */
  body: string;
  /** decoded file attachments — a credit-card statement rides in as a PDF here */
  attachments: EmailAttachment[];
}

/** Collapse whitespace and cap length so a runaway body can't blow the prompt. */
const MAX_BODY_CHARS = 12_000;

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Crude HTML→text fallback for html-only mail: drop scripts/styles, tags → text. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/**
 * Parse a raw RFC822 message into the text the model reads plus any decoded
 * attachments. Prefers the text/plain part; falls back to stripping the HTML.
 */
export async function parseEmail(raw: string): Promise<ParsedEmail> {
  const mail = await simpleParser(raw);
  const plain = mail.text?.trim();
  const body = plain && plain.length > 0 ? plain : htmlToText(mail.html || "");
  return {
    subject: mail.subject ?? "",
    from: mail.from?.text ?? "",
    body: normalize(body).slice(0, MAX_BODY_CHARS),
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename ?? "",
      contentType: a.contentType ?? "",
      content: new Uint8Array(a.content),
    })),
  };
}
