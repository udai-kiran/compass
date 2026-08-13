/**
 * Rank credit cards by how closely their name and institution match the email
 * subject. Used to select the right card when multiple cards share the same
 * statement PDF password (common with Indian banks that use a DOB-based formula
 * for all cards of the same issuer).
 */

const STOPWORDS = new Set([
  "bank", "credit", "card", "statement", "your", "account",
  "the", "for", "and", "of", "a", "an", "in", "on", "at",
]);

/** Split a string into lowercase alphanumeric tokens, excluding stopwords. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Return a copy of `cards` sorted so the card whose name + institution words
 * best match the email subject appears first. Equal-score cards retain their
 * original order (stable, using explicit index comparison).
 */
export function rankCardsBySubject<T extends { name: string; institution: string }>(
  cards: T[],
  subject: string,
): T[] {
  const subjectTokens = new Set(tokenize(subject));
  const scored = cards.map((card, originalIndex) => {
    const cardTokens = new Set([...tokenize(card.name), ...tokenize(card.institution)]);
    const score = [...cardTokens].filter((t) => subjectTokens.has(t)).length;
    return { card, score, originalIndex };
  });
  scored.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return scored.map((s) => s.card);
}
