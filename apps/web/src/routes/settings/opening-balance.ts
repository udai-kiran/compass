import { isLiabilityAccount, rupeesToPaise, type AccountType } from "@compass/shared";

/**
 * The rupee string to seed the opening-balance editor with. Liabilities are held
 * as negative paise, but a user thinks in what they owe, so the field is shown
 * unsigned for them and re-signed on save.
 */
export function openingBalanceToInput(paise: number, type: AccountType): string {
  const shown = isLiabilityAccount(type) ? -paise : paise;
  if (shown === 0) return "";
  return (shown / 100).toString();
}

/**
 * Parses the editor's rupee string back to signed integer paise, re-applying the
 * liability sign. Returns null when the text isn't a usable amount, so the caller
 * can block the save rather than writing a NaN.
 */
export function openingBalanceFromInput(text: string, type: AccountType): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  // At most two decimals: paise are the smallest unit, and anything finer would
  // have to be rounded through binary floating point, which silently loses money
  // (Math.round(2.675 * 100) is 268, not 267). Rejecting it makes the user fix
  // the input instead. A trailing "." is allowed so the field stays usable mid-typing.
  if (!/^-?\d*\.?\d{0,2}$/.test(trimmed) || trimmed === "." || trimmed === "-") return null;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees)) return null;
  const magnitude = rupeesToPaise(Math.abs(rupees));
  if (!Number.isSafeInteger(magnitude)) return null;
  // For liabilities: any non-negative input → negative paise (owed). Explicit negative → still negative (owed).
  // For assets: positive → positive, negative → negative.
  if (isLiabilityAccount(type)) {
    return -magnitude;
  }
  return rupees < 0 ? -magnitude : magnitude;
}

/**
 * Whether the opening balance is editable as a plain amount on this account.
 *
 * Bank and cash accounts normally hold theirs as a real "Opening balance" ledger
 * transaction with the column pinned at 0 (see createAccount), so there is no
 * amount on the column to round-trip and the ledger row is the thing to edit.
 *
 * But an account that only became bank/cash through a later type change still
 * carries its amount on the column, where nothing in the ledger shows it. That
 * has to stay correctable, so it gets the editor too — saving migrates the amount
 * into a ledger row (see planOpeningBalanceChange) and re-pins the column at 0.
 */
export function editsOpeningBalanceAsAmount(type: AccountType, openingBalancePaise: number): boolean {
  if (!(type === "bank" || type === "cash")) return true;
  return openingBalancePaise !== 0;
}
