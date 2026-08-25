/**
 * harvesting.ts — 13.12 LTCG & tax-loss harvesting planner contracts.
 *
 * The planner reads the single FIFO calculator's open lots (tax-lots.ts via
 * getCapitalGains) and the annual ₹1.25L equity LTCG exemption, then suggests
 * harvests ordered by net tax benefit. Everything is an estimate.
 */

import { z } from "zod";
import { FySchema } from "./tax.ts";

export const OpenLotPositionSchema = z.object({
  holdingId: z.string().uuid(),
  holdingName: z.string(),
  folioNumber: z.string().nullable(),
  /** Pass-through of holdings.gains_tax_class ("equity" | "other" | ...). */
  gainsTaxClass: z.string(),
  /** ISO date the lot was acquired (the FIFO buy). */
  buyDate: z.string(),
  units: z.number().positive(),
  costPaise: z.number().int().min(0),
  /** Market value of these units from the latest valuation; null when unvalued. */
  currentValuePaise: z.number().int().min(0).nullable(),
  /** currentValue − cost; null without a valuation. */
  unrealisedGainPaise: z.number().int().nullable(),
  holdingPeriodDays: z.number().int().min(0),
  isLongTerm: z.boolean(),
  /** First date this lot crosses long-term status; in the past once long-term. */
  ltcgCrossoverDate: z.string(),
});
export type OpenLotPosition = z.infer<typeof OpenLotPositionSchema>;

export const HarvestSuggestionSchema = z.object({
  holdingId: z.string().uuid(),
  holdingName: z.string(),
  /** Realise a loss against realised gains, or bank gains inside exemption headroom. */
  kind: z.enum(["harvest_loss", "harvest_gain"]),
  buyDate: z.string(),
  unitsToSell: z.number().positive(),
  /** Unrealised P&L of the suggested slice (negative for losses). */
  unrealisedPaise: z.number().int(),
  grossTaxEffectPaise: z.number().int().min(0),
  estimatedCostsPaise: z.number().int().min(0),
  /** Gross effect minus costs; the sort key, descending. Zero ⇒ borderline. */
  netBenefitPaise: z.number().int().min(0),
  caveats: z.array(z.string()),
});
export type HarvestSuggestion = z.infer<typeof HarvestSuggestionSchema>;

export const TaxHarvestPlanSchema = z.object({
  fy: FySchema,
  /** Annual equity-LTCG exemption still unused this FY. */
  ltcgHeadroomPaise: z.number().int().min(0),
  /** Realised LTCG already booked this FY (consumed headroom). */
  realisedLtcgPaise: z.number().int().min(0),
  lots: z.array(OpenLotPositionSchema),
  suggestions: z.array(HarvestSuggestionSchema),
  /** Open lots excluded because they sit inside the ELSS 3-year lock-in. */
  elssLockedLotCount: z.number().int().min(0),
  rebuyCaveats: z.array(z.string()),
  assumptions: z.array(z.string()),
  isEstimate: z.literal(true),
  generatedAt: z.string(),
});
export type TaxHarvestPlan = z.infer<typeof TaxHarvestPlanSchema>;

export const GetHarvestPlanQuerySchema = z.object({
  fy: FySchema.optional(),
});
