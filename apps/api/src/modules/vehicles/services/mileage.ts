import type { MileageInterval } from "@compass/shared";

/**
 * Derives fuel-economy intervals from a vehicle's odometer readings.
 *
 * Deliberately never asks for litres. A fuel receipt states an amount paid —
 * that's what a reviewer actually has on hand and what the ledger already
 * records via the reading's optional `transactionId` — never a litre count,
 * which few people transcribe accurately at the pump. So the economy figure
 * here is km covered per ₹100 spent, not km/l.
 *
 * "Full-to-full" convention: the spend recorded AT the start of an interval
 * (`fromReadingId`) is assumed to explain the driving up to the next reading.
 * A reading with no linked transaction still contributes its km to the
 * interval that starts there, but that interval's `amountPaise`/
 * `kmPer100Rupees` come out null — there's nothing to divide by.
 */
export interface OdometerPoint {
  id: string;
  odometerKm: number;
  /** ISO date */
  readingDate: string;
  /** paise magnitude of the linked transaction, or null if this reading has none */
  amountPaise: number | null;
}

/**
 * Input order is not trusted — sorted here by (readingDate, odometerKm) so a
 * caller's DB query order never silently changes the result. Two readings on
 * the same day are ordered by odometer so a same-day pair still yields a
 * sensible (non-negative, in the common case) interval rather than one
 * arbitrarily flipped by insertion order.
 */
export function computeMileageIntervals(readings: OdometerPoint[]): MileageInterval[] {
  const sorted = [...readings].sort((a, b) => {
    if (a.readingDate !== b.readingDate) return a.readingDate < b.readingDate ? -1 : 1;
    return a.odometerKm - b.odometerKm;
  });

  const intervals: MileageInterval[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;
    const kmDriven = to.odometerKm - from.odometerKm;
    const amountPaise = from.amountPaise;
    // A negative/zero spend, or a non-positive km delta (a data-entry mistake
    // that slipped past write-time validation, or a same-day pair with equal
    // readings) both make "km per ₹100" meaningless — null rather than
    // Infinity/NaN.
    const kmPer100Rupees =
      amountPaise !== null && amountPaise > 0 && kmDriven > 0
        ? (kmDriven * 10000) / amountPaise
        : null;
    intervals.push({
      fromReadingId: from.id,
      toReadingId: to.id,
      fromDate: from.readingDate,
      toDate: to.readingDate,
      kmDriven,
      amountPaise,
      kmPer100Rupees,
    });
  }
  return intervals;
}
