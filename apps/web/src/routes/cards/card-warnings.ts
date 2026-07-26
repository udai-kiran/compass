import type { CardSummary } from "@compass/shared";

/**
 * Whether this card has no statement-PDF password stored. A card with no details
 * row at all counts as missing one — there is nowhere for a password to live yet.
 * The API never sends the password itself, only whether one exists.
 */
export function needsStatementPassword(card: CardSummary): boolean {
  return !(card.details?.hasStatementPassword ?? false);
}
