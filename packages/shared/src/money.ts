import { z } from "zod";

/**
 * Money is always handled as an integer number of minor units (paise).
 * Never store or compute money as floating-point rupees.
 */

/**
 * Zod schema for a safe integer paise amount.
 * Rejects floats, NaN, Infinity, and values outside the safe integer range.
 */
export const SafePaiseSchema = z.number().int().refine(Number.isSafeInteger, "amount exceeds safe integer range");

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

// ─── Unit-price helpers (task 9.3) ────────────────────────────────────────────

/**
 * Compute the price per reference display unit in paise, using BigInt
 * round-half-up arithmetic to avoid any floating-point imprecision.
 *
 * Reference unit: **per kg** for `g`, **per litre** for `ml`, **per piece**
 * for `piece`. This lets callers compare prices across different pack sizes
 * with exact integer results.
 *
 * Formula (round-half-up): `(2 · pricePaise · ref + quantityBase) / (2 · quantityBase)`
 * where `/` is BigInt (floor) division. The `+ quantityBase` term lifts a
 * fractional 0.5 exactly over the next integer before truncation.
 *
 * Guards:
 * - `pricePaise` must be a non-negative safe integer (zero price is valid).
 * - `quantityBase` must be a positive safe integer (zero/negative → RangeError).
 * - `unit` must be one of `"g"`, `"ml"`, or `"piece"`.
 * - The computed result must not exceed `Number.MAX_SAFE_INTEGER`.
 */
export function unitPricePaise(
  pricePaise: number,
  quantityBase: number,
  unit: "g" | "ml" | "piece",
): number {
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) {
    throw new RangeError("pricePaise must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(quantityBase) || quantityBase <= 0) {
    throw new RangeError("quantityBase must be a positive safe integer");
  }
  if (unit !== "g" && unit !== "ml" && unit !== "piece") {
    throw new RangeError("unit must be one of g, ml, or piece");
  }

  const ref = unit === "piece" ? 1n : 1000n;
  const p = BigInt(pricePaise);
  const q = BigInt(quantityBase);

  // Round-half-up: floor((p * ref / q) + 0.5) = floor((2p·ref + q) / (2q))
  const result = (2n * p * ref + q) / (2n * q);

  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("unitPricePaise result exceeds safe integer range");
  }
  return Number(result);
}

/**
 * Convert a user-supplied display quantity (as an exact decimal string) to
 * a base-unit integer, with no floating-point arithmetic.
 *
 * Display→base mapping:
 * - `kg`    → grams   (`g`),   max 3 decimal places  (0.001 kg = 1 g)
 * - `litre` → ml      (`ml`),  max 3 decimal places  (0.001 L = 1 ml)
 * - `g`     → grams   (`g`),   0 decimal places (whole grams only)
 * - `ml`    → ml      (`ml`),  0 decimal places (whole ml only)
 * - `piece` → pieces  (`piece`), 0 decimal places
 *
 * Guards:
 * - `quantity` must match `^\d+(\.\d+)?$` (non-negative decimal).
 * - Fractional digits must not exceed the unit's max (excess precision → RangeError).
 * - The computed `quantityBase` must be a safe integer.
 *
 * Groundwork for task 9.4 (AI text-capture) — not yet called by the routes.
 */
export function convertToBaseQuantity(
  quantity: string,
  displayUnit: "kg" | "g" | "litre" | "ml" | "piece",
): { quantityBase: number; unit: "g" | "ml" | "piece" } {
  if (
    displayUnit !== "kg" &&
    displayUnit !== "g" &&
    displayUnit !== "litre" &&
    displayUnit !== "ml" &&
    displayUnit !== "piece"
  ) {
    throw new RangeError("displayUnit must be one of kg, g, litre, ml, or piece");
  }
  if (!/^\d+(\.\d+)?$/.test(quantity)) {
    throw new RangeError(
      "quantity must be a non-negative decimal string (e.g. '1.5', '500')",
    );
  }

  const dotIdx = quantity.indexOf(".");
  const intStr = dotIdx === -1 ? quantity : quantity.slice(0, dotIdx);
  const fracStr = dotIdx === -1 ? "" : quantity.slice(dotIdx + 1);

  let quantityBase: number;
  let unit: "g" | "ml" | "piece";

  if (displayUnit === "kg" || displayUnit === "litre") {
    unit = displayUnit === "kg" ? "g" : "ml";
    if (fracStr.length > 3) {
      throw new RangeError(
        `${displayUnit} quantities may have at most 3 decimal places`,
      );
    }
    // Exact integer arithmetic: pad fractional part to 3 digits then combine.
    const intPart = parseInt(intStr, 10);
    const fracPadded = fracStr.padEnd(3, "0");
    const fracPart = parseInt(fracPadded, 10);
    quantityBase = intPart * 1000 + fracPart;
  } else {
    // g, ml, piece: only whole numbers
    unit = displayUnit as "g" | "ml" | "piece";
    if (fracStr.length > 0) {
      throw new RangeError(
        `${displayUnit} quantities must be whole numbers (no decimal places)`,
      );
    }
    quantityBase = parseInt(intStr, 10);
  }

  if (!Number.isSafeInteger(quantityBase)) {
    throw new RangeError(
      "convertToBaseQuantity result exceeds safe integer range",
    );
  }

  return { quantityBase, unit };
}
