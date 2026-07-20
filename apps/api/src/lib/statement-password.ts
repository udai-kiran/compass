/**
 * Credit-card e-statement PDFs are password-protected, and the scheme differs by
 * issuer. From what we hold on the account — cardholder name, card last-4, and
 * (when the user supplies it) date of birth — we derive an ORDERED list of
 * candidate passwords and try them in turn; the first that decrypts the PDF wins.
 * When nothing is derivable (e.g. a DOB-based scheme with no DOB on file) the
 * list is empty and the user is asked for the password.
 *
 * Schemes come from each issuer's own "how to open your statement" instructions.
 * Only HDFC is confirmed (name + last-4, or name + birth DDMM — see the shared
 * instruction image); the others are best-effort and marked PENDING. Trying an
 * extra wrong candidate only costs one failed decrypt, so over-generating is safe.
 */

export interface CardholderInfo {
  /** issuing bank; matched loosely (substring) against the account's `institution` */
  issuer?: string | null;
  /** name embossed on the card / account holder name */
  holderName?: string | null;
  /** card last-4 (any format; digits are extracted) */
  last4?: string | null;
  /** date of birth as ISO YYYY-MM-DD, when the user has provided it */
  dob?: string | null;
}

/** First 4 letters of the name, A–Z only, uppercased ("Ravi Shankar" → "RAVI"). */
export function nameKey(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
}

function dobParts(dob: string): { ddmm: string; ddmmyyyy: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return { ddmm: `${dd}${mm}`, ddmmyyyy: `${dd}${mm}${yyyy}` };
}

/** The building blocks an issuer scheme can reference. */
type Ingredient = "nameLast4" | "nameDDMM" | "ddmmyyyy" | "last4DDMM" | "ddmmyyyyLast4";

// Ordered ingredients per issuer, best-known first. HDFC is confirmed from the
// bank's instructions; the rest are PENDING confirmation. Keys are matched as a
// substring of the account's `institution` (case-insensitive).
const ISSUER_SCHEMES: Record<string, Ingredient[]> = {
  hdfc: ["nameLast4", "nameDDMM"], // CONFIRMED (name + last-4, or name + birth DDMM)
  sbi: ["ddmmyyyyLast4"], // CONFIRMED (birth DDMMYYYY + last-4, e.g. 010419801234)
  icici: ["nameDDMM", "nameLast4"], // PENDING
  axis: ["nameDDMM", "last4DDMM", "nameLast4"], // PENDING
};

// Full ingredient order, appended after the issuer's own scheme so a decrypt is
// still attempted when our recorded scheme is wrong or the issuer is unknown.
const ALL_INGREDIENTS: Ingredient[] = [
  "nameLast4",
  "nameDDMM",
  "ddmmyyyyLast4",
  "ddmmyyyy",
  "last4DDMM",
];

function issuerKey(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  const s = issuer.toLowerCase();
  return Object.keys(ISSUER_SCHEMES).find((k) => s.includes(k)) ?? null;
}

export function statementPasswordCandidates(info: CardholderInfo): string[] {
  const name = info.holderName ? nameKey(info.holderName) : "";
  const last4 = (info.last4 ?? "").replace(/\D/g, "").slice(-4);
  const has4 = last4.length === 4;
  const dob = info.dob ? dobParts(info.dob) : null;

  const build = (ing: Ingredient): string | null => {
    switch (ing) {
      case "nameLast4":
        return name && has4 ? `${name}${last4}` : null;
      case "nameDDMM":
        return name && dob ? `${name}${dob.ddmm}` : null;
      case "ddmmyyyy":
        return dob ? dob.ddmmyyyy : null;
      case "last4DDMM":
        return has4 && dob ? `${last4}${dob.ddmm}` : null;
      case "ddmmyyyyLast4":
        return dob && has4 ? `${dob.ddmmyyyy}${last4}` : null;
    }
  };

  const scheme = ISSUER_SCHEMES[issuerKey(info.issuer) ?? ""] ?? [];
  const out: string[] = [];
  for (const ing of [...scheme, ...ALL_INGREDIENTS]) {
    const v = build(ing);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
