/**
 * PII redaction for text that is about to be sent to an LLM.
 *
 * The guiding rule (and the whole reason this is not a blunt regex sweep): redact
 * the *user's* personal data, but keep *merchant* data — a merchant's name is the
 * categorization signal the model needs, and it is public/commercial, not private.
 * So the tricky identifiers (names, UPI VPAs) are resolved against the user's own
 * stored identity: `udai@okhdfcbank` is the user and gets masked; `swiggy@ybl` is a
 * merchant and survives. Purely-personal identifiers that never carry a merchant's
 * categorization signal (emails, phone numbers, PAN, Aadhaar, full account/card
 * numbers) are masked structurally.
 *
 * Deliberately NOT masked: the bank-masked last-4 (`XXXX5739`) and any run of ≤8
 * digits, so downstream account-matching still works; rupee amounts and dates; and
 * every alphabetic merchant/brand word.
 */

/** The mailbox owner's own identifiers — the values that mark text as *their* PII. */
export interface RedactionIdentity {
  /** display name + account holder names, e.g. ["Udai Kiran"] */
  names: string[];
  /** the user's own email addresses */
  emails: string[];
  /** the user's own UPI VPAs, e.g. ["udai@oksbi"] */
  upiIds: string[];
}

export interface RedactOptions {
  /**
   * Apply the pattern-based passes (emails, phone, PAN, Aadhaar, long account
   * numbers, PIN). Default true. Pass false for Subject/From lines, where the
   * sender is a bank/merchant rather than the user — there we only strip the
   * user's *known* identifiers and leave sender routing intact for classification.
   */
  structural?: boolean;
}

/** Regex-escape a literal string for use inside a dynamic RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-ish tokens (len ≥ 3) from a person's name, lowercased. */
function nameTokens(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    for (const tok of n.toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 3) out.add(tok);
    }
  }
  return [...out];
}

/** The local-part (before `@`) of the user's stored VPAs and emails, lowercased. */
function userHandles(identity: RedactionIdentity): Set<string> {
  const out = new Set<string>();
  for (const v of [...identity.upiIds, ...identity.emails]) {
    const local = v.toLowerCase().split("@")[0];
    if (local && local.length >= 3) out.add(local);
  }
  return out;
}

/**
 * A UPI handle belongs to the user when its local part is one of their stored
 * handles, or contains a token of their name (so `udai@paytm` is caught even if
 * that VPA was never saved). A merchant handle like `swiggy@ybl` matches neither.
 */
function isUserHandle(local: string, tokens: string[], handles: Set<string>): boolean {
  const l = local.toLowerCase();
  if (handles.has(l)) return true;
  return tokens.some((t) => l.includes(t));
}

/**
 * Redact the user's PII from `text`, preserving merchant data. Returns a copy;
 * the caller keeps the original (we never mutate the stored raw email — only the
 * copy handed to the model).
 */
export function redactPii(
  text: string,
  identity: RedactionIdentity,
  opts: RedactOptions = {},
): string {
  if (!text) return text;
  const structural = opts.structural ?? true;
  let out = text;

  // The user's own names, longest first so "Udai Kiran" wins over "Udai".
  const names = [...identity.names].filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
  for (const name of names) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "[name]");
  }
  // "Dear Udai Kiran," / "Hi Udai," — mask the greeted name, keep the greeting.
  out = out.replace(
    /\b(Dear|Hi|Hello)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
    (_m, greeting: string) => `${greeting} [name]`,
  );

  // The user's own emails (always — even when structural is off, e.g. a forwarded
  // From line that is the user's own address; bank sender domains are left alone).
  for (const email of identity.emails.filter((e) => e.includes("@"))) {
    out = out.replace(new RegExp(escapeRegExp(email), "gi"), "[email]");
  }

  const tokens = nameTokens(identity.names);
  const handles = userHandles(identity);

  if (structural) {
    // All email addresses in the body: never a merchant's *categorization* signal
    // (the merchant name carries that), so masking them can't hurt extraction.
    out = out.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]");
  }

  // UPI VPAs (handle@psp, no dot in the psp — emails already handled above): mask
  // ONLY when the handle is the user's, so merchant VPAs (swiggy@ybl) survive.
  out = out.replace(/\b([a-z0-9._-]{2,})@([a-z]{2,})\b/gi, (m, local: string) =>
    isUserHandle(local, tokens, handles) ? "[upi]" : m,
  );

  if (structural) {
    // Aadhaar (12 digits, grouped by space or hyphen — the SAME separator
    // throughout, via the \1 backreference) before the generic long-number /
    // grouped-digit passes claim it.
    out = out.replace(/\b\d{4}([ -])\d{4}\1\d{4}\b/g, "[aadhaar]");
    // Grouped digit sequences: card/account numbers and spaced mobiles are
    // often written as several digit groups separated by a single space or
    // hyphen (never a comma or dot, so Indian-grouped rupee amounts like
    // "1,23,456.78" and decimals are never touched). Mask the whole run when
    // the total digit count is in the 9–19 range so short refs/dates and the
    // bank-masked last-4 ("XXXX 5739", a single group) survive.
    //
    // Two hardenings over a naive `[ -]` group-separator class:
    //  1. The `\1` backreference pins every group in one run to the SAME
    //     separator character. Space and hyphen are otherwise interchangeable
    //     within a single match, so a hyphenated date immediately followed by
    //     a space-separated amount (e.g. "20-07-2026 450.00") would otherwise
    //     be swept up as one run and both destroyed. With the backreference,
    //     "20-07-2026" (hyphen-grouped, 8 digits, under the 9 floor) and
    //     "450.00" (never grouped at all — a lone number before a decimal
    //     point) are seen as two separate, unrelated tokens.
    //  2. `(?!\.\d)` forbids the match from ending immediately before a
    //     decimal fraction. This matters when the separator IS uniform, e.g.
    //     "5010 0123 4535 10 450.00" — every gap is a space, so the greedy
    //     `{0,5}` would otherwise happily swallow "450" as a final group too.
    //     The lookahead fails there, and — because the preceding quantifier
    //     is greedy but backtracks on failure — the regex engine gives back
    //     the last repetition and re-tries the match ending one group
    //     earlier, at "...4535 10", where the lookahead succeeds (the next
    //     character is a space, not "."). "450.00" is left untouched.
    out = out.replace(/\b\d{1,5}(?:([ -])\d{1,5}(?:\1\d{1,5}){0,5})\b(?!\.\d)/g, (m) => {
      const digitCount = m.replace(/[ -]/g, "").length;
      return digitCount >= 9 && digitCount <= 19 ? "[account]" : m;
    });
    // PAN — ABCDE1234F.
    out = out.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]");
    // Indian mobile (optionally +91), before the long-number pass.
    out = out.replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[phone]");
    // Full account / card numbers: 9–19 digits. Runs of ≤8 (the bank-masked
    // last-4, refs) are left so account-matching still works.
    out = out.replace(/\b\d{9,19}\b/g, "[account]");
    // Labelled address blocks: mask everything after an explicit "Address:"
    // style label through to (and including) a line with a 6-digit PIN, a
    // blank line, or a 4-line cap — conservative enough that ordinary
    // merchant/transaction lines are never touched. This MUST run before the
    // labelled-PIN pass below: that pass replaces a PIN like "PIN 560103"
    // with "PIN [pin]", which would make the address block's own PIN
    // terminator (a raw 6-digit number) invisible and let the block overrun
    // into unrelated lines (e.g. transaction rows).
    out = maskLabelledAddresses(out);
    // Address proxy: a PIN code only when explicitly labelled, so a plain 6-digit
    // rupee amount on a statement line is never mistaken for one.
    out = out.replace(/\b(PIN\s*code|pincode|PIN)[:\s-]*([1-9]\d{5})\b/gi, "$1 [pin]");
  }

  return out;
}

const ADDRESS_LABEL_RE = /\b(?:billing address|mailing address|correspondence address|address)\s*[:-]/i;
// A raw 6-digit PIN, or the already-masked "[pin]" literal (belt and braces —
// the labelled-PIN pass normally runs after this one, but if that ordering
// ever changes again the block terminator still recognizes its own output).
const PIN_LINE_RE = /\b[1-9]\d{5}\b|\[pin\]/;
// A line that looks like a transaction/statement row (leading date, or a
// currency amount) should never be swallowed into a PIN-less address block.
const TRANSACTION_LINE_RE =
  /^\s*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b|(?:₹|\bRs\.?|\bINR\b)\s*[\d,]+|\b\d{1,3}(?:,\d{2,3})*\.\d{2}\b/;
const MAX_ADDRESS_BLOCK_LINES = 4;

/**
 * Mask the free-text address that follows an explicit label line (e.g.
 * "Billing Address:") up to and including a line containing a 6-digit PIN,
 * a blank line, or a 4-line cap — whichever comes first. Only fires on an
 * explicit label, so it never eats merchant/transaction lines.
 */
function maskLabelledAddresses(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = ADDRESS_LABEL_RE.exec(line);
    if (!m) {
      out.push(line);
      i++;
      continue;
    }
    const prefix = line.slice(0, m.index + m[0].length);
    const remainder = line.slice(m.index + m[0].length);

    const blockLines: string[] = [];
    let foundPin = false;
    if (remainder.trim().length > 0) {
      blockLines.push(remainder);
      if (PIN_LINE_RE.test(remainder)) foundPin = true;
    }

    let j = i + 1;
    while (!foundPin && blockLines.length < MAX_ADDRESS_BLOCK_LINES && j < lines.length) {
      const next = lines[j] ?? "";
      if (next.trim().length === 0) break;
      // A PIN-less address block must not swallow a transaction/statement
      // row that immediately follows it — stop before consuming it.
      if (TRANSACTION_LINE_RE.test(next)) break;
      blockLines.push(next);
      j++;
      if (PIN_LINE_RE.test(next)) foundPin = true;
    }

    if (blockLines.length === 0) {
      out.push(line);
      i++;
      continue;
    }

    out.push(`${prefix} [address]`);
    i = j;
  }
  return out.join("\n");
}
