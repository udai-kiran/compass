import type { Account, ExtractedTransaction } from "@compass/shared";

/**
 * Whether a draft can be recorded as a card repayment via the dedicated
 * "Record as card payment" affordance, instead of a plain accept. Depends
 * only on the draft's direction and the account currently selected for it in
 * the UI — never on `intent`, which is informational only (set by misc-01)
 * and must not gate behaviour.
 */
export function isRepaymentEligible(
  draft: ExtractedTransaction,
  selectedAccount: Account | undefined,
): boolean {
  return draft.direction === "credit" && selectedAccount?.type === "credit_card";
}
