/**
 * credit.ts — shared Zod response schemas for the v2.2.0 revolving-debt endpoint.
 *
 * Source of truth: apps/api/src/modules/credit/services/revolving-debt.ts.
 * Compile-time parity assertions live in
 * apps/api/src/modules/credit/services/credit-schemas.test.ts.
 *
 * Money is always integer paise (minor units). The local `paiseField` helper
 * uses z.number().int().safe(). In the installed Zod 4.4.3, `.int()` already
 * rejects NaN, ±Infinity, and values outside the safe-integer range; `.safe()`
 * is therefore redundant but is retained as an explicit safe-integer guard and
 * as insurance should `.int()` semantics change in a future Zod release.
 *
 * Temporal strings:
 *   YYYY-MM → explicit regex refinement (StatementPaymentStatus.period)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Local money helper — NOT exported
// ---------------------------------------------------------------------------

/**
 * Integer paise field. In Zod 4.4.3, `.int()` already rejects NaN, ±Infinity,
 * and values outside the safe-integer range; `.safe()` is retained as a
 * redundant-but-explicit safe-integer guard for documentation clarity.
 */
function paiseField() {
  return z.number().int().safe();
}

// ---------------------------------------------------------------------------
// Temporal helpers
// ---------------------------------------------------------------------------

/** YYYY-MM year-month string (StatementPaymentStatus.period). */
const yearMonthString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a YYYY-MM year-month string");

// ---------------------------------------------------------------------------
// Revolving-debt schemas
// ---------------------------------------------------------------------------

export const PaymentStateSchema = z.enum([
  "unpaid",
  "minimum_only",
  "partial",
  "paid_in_full",
  "unknown",
]);
export type PaymentState = z.output<typeof PaymentStateSchema>;

export const StatementPaymentStatusSchema = z.object({
  accountId: z.string(),
  /** "YYYY-MM" period key */
  period: yearMonthString,
  /** from statement_reconciliations; null when not stated */
  totalDuePaise: paiseField().nullable(),
  /** from statement_reconciliations */
  minDuePaise: paiseField().nullable(),
  /** sum of positive postings to card account between close date and due date */
  paidByDueDatePaise: paiseField(),
  state: PaymentStateSchema,
  /** estimated revolving balance = max(0, totalDuePaise - paidByDueDatePaise) */
  revolvingBalancePaise: paiseField(),
  /**
   * Estimated monthly finance charge in paise; null when aprBps is null.
   */
  estimatedMonthlyChargePaise: paiseField().nullable(),
});
export type StatementPaymentStatus = z.output<typeof StatementPaymentStatusSchema>;

export const CardRevolvingStatusSchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  /** the most recent statement's status (last 2 months); null if no recent statement */
  latestStatement: StatementPaymentStatusSchema.nullable(),
  isRevolving: z.boolean(),
  revolvingBalancePaise: paiseField(),
});
export type CardRevolvingStatus = z.output<typeof CardRevolvingStatusSchema>;

export const HouseholdRevolvingDebtSchema = z.object({
  cards: z.array(CardRevolvingStatusSchema),
  totalRevolvingPaise: paiseField(),
  hasRevolvingDebt: z.boolean(),
  totalMonthlyChargePaise: paiseField(),
});
export type HouseholdRevolvingDebt = z.output<typeof HouseholdRevolvingDebtSchema>;
