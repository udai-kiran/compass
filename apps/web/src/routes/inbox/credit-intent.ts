import type { ExtractedTransaction } from "@compass/shared";

type Intent = NonNullable<ExtractedTransaction["intent"]>;

/**
 * Display-only styling for a credit draft's AI-guessed `intent` — never
 * gates behaviour (see `isRepaymentEligible`'s own doc). `repayment` reads as
 * a card bill payment; the other three are still credits that land as plain
 * income unless the reviewer says otherwise, so they get a visually distinct
 * (non-indigo) badge to avoid being mistaken for a payment at a glance.
 */
export const INTENT_BADGE: Record<Intent, { label: string; className: string }> = {
  repayment: { label: "Card payment", className: "bg-indigo-50 text-indigo-700" },
  refund: { label: "Refund", className: "bg-sky-50 text-sky-700" },
  cashback: { label: "Cashback", className: "bg-emerald-50 text-emerald-700" },
  chargeback: { label: "Chargeback", className: "bg-amber-50 text-amber-700" },
};

/**
 * A credit the model flagged as NOT an actual bank/card bill payment. Used
 * only to steer which of "Accept" / "Record as card payment" reads as the
 * primary action for a draft — never to hide or disable either one, since
 * `intent` is a heuristic guess that can be wrong (see repayment-eligibility.ts).
 */
export function isNonPaymentIntent(intent: ExtractedTransaction["intent"]): boolean {
  return intent === "refund" || intent === "cashback" || intent === "chargeback";
}
