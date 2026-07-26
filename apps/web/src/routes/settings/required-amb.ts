import { MAX_REQUIRED_AMB_PAISE, rupeesToPaise } from "@compass/shared";

/** The rupee string to seed the required-AMB field with; "" when no requirement is set. */
export function requiredAmbToInput(paise: number): string {
  if (paise === 0) return "";
  return (paise / 100).toString();
}

/**
 * Parses the field's rupee text to integer paise. "" means "no requirement" (0).
 * Returns null when the text isn't a usable amount, so the caller can block the
 * save rather than writing a NaN. Negatives are rejected — a requirement is a
 * floor, never below zero (the shared schema enforces `.min(0)` too).
 */
export function requiredAmbFromInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (trimmed.includes("-")) return null;
  // At most two decimals: paise are the smallest unit, and anything finer would
  // have to be rounded through binary floating point, which silently loses money
  // (Math.round(2.675 * 100) is 268, not 267). Rejecting it makes the user fix
  // the input instead. A trailing "." is allowed so the field stays usable mid-typing.
  if (!/^\d*\.?\d{0,2}$/.test(trimmed) || trimmed === ".") return null;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees)) return null;
  const paise = rupeesToPaise(rupees);
  if (!Number.isSafeInteger(paise) || paise < 0) return null;
  // Deliberately mirrors the shared schema's `.max(MAX_REQUIRED_AMB_PAISE)`
  // bound so the two cannot disagree — the user gets inline field validation
  // here instead of a 400 from the server.
  if (paise > MAX_REQUIRED_AMB_PAISE) return null;
  return paise;
}
