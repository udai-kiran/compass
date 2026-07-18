/**
 * Credit-card bill payment via UPI. Some issuers expose a deterministic virtual
 * payment address (VPA) you can build from the registered mobile and the card's
 * last four digits; sending money to it settles the bill.
 *
 * Only issuers with a mobile+last4 scheme are here — no full card number is ever
 * needed or stored. Issuers without a public VPA scheme (e.g. HDFC) or that need
 * the full PAN (e.g. SBI Card) are deliberately absent: they return null so the
 * UI shows nothing rather than a wrong address. Formats change; verify the payee
 * in your UPI app before paying. Keyed by the canonical institution label from
 * institutions.ts.
 */
import { findInstitution } from "./institutions.ts";

type VpaBuilder = (m: { mobile: string; last4: string }) => string;

const SCHEMES: Record<string, VpaBuilder> = {
  // CC.91<mobile><last4>@axisbank
  Axis: ({ mobile, last4 }) => `CC.91${mobile}${last4}@axisbank`,
  // ccpay.<mobile><last4>@icici
  ICICI: ({ mobile, last4 }) => `ccpay.${mobile}${last4}@icici`,
};

/** True when we know a mobile+last4 VPA scheme for this bank. */
export function bankSupportsBillVpa(bank: string | null): boolean {
  const inst = findInstitution(bank);
  return inst !== null && inst.label in SCHEMES;
}

/**
 * The bill-payment VPA for a card, or null when the issuer has no scheme or the
 * inputs are incomplete. Mobile must be 10 digits, last4 exactly 4 digits.
 */
export function cardBillVpa(
  bank: string | null,
  mobile: string | null,
  last4: string | null,
): string | null {
  const inst = findInstitution(bank);
  if (!inst) return null;
  const build = SCHEMES[inst.label];
  if (!build) return null;
  const m = (mobile ?? "").replace(/\D/g, "");
  const l = (last4 ?? "").replace(/\D/g, "");
  if (m.length !== 10 || l.length !== 4) return null;
  return build({ mobile: m, last4: l });
}
