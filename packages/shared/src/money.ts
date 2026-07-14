/**
 * Money is always handled as an integer number of minor units (paise).
 * Never store or compute money as floating-point rupees.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

export function formatINR(paise: number): string {
  return inrFormatter.format(paise / 100);
}

/**
 * Standard reducing-balance EMI installment (paise), rounded to the nearest
 * paisa. `annualRateBps` is basis points (875 = 8.75% p.a.); a zero rate splits
 * the principal evenly. Shared by the API (authoritative) and the UI preview.
 */
export function standardEmiPaise(
  principalPaise: number,
  annualRateBps: number,
  installments: number,
): number {
  if (installments <= 0) return 0;
  const r = annualRateBps / 10000 / 12;
  if (r === 0) return Math.round(principalPaise / installments);
  const factor = Math.pow(1 + r, installments);
  return Math.round((principalPaise * r * factor) / (factor - 1));
}
