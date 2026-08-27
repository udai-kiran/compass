import { z } from "zod";

// ---------- Vehicle service configuration (1:1 with a `resources` row of kind "vehicle") ----------

export const VehicleServiceConfigSchema = z.object({
  resourceId: z.uuid(),
  /** fire a service reminder once the odometer has advanced this far past the last service; null = not tracked by km */
  serviceIntervalKm: z.number().int().positive().nullable(),
  /** fire a service reminder once this many months have passed since the last service; null = not tracked by time */
  serviceIntervalMonths: z.number().int().positive().nullable(),
  lastServiceOdometerKm: z.number().int().nonnegative().nullable(),
  lastServiceDate: z.iso.date().nullable(),
});
export type VehicleServiceConfig = z.infer<typeof VehicleServiceConfigSchema>;

export const UpdateVehicleServiceConfigSchema = z.object({
  serviceIntervalKm: z.number().int().positive().nullable().optional(),
  serviceIntervalMonths: z.number().int().positive().nullable().optional(),
  lastServiceOdometerKm: z.number().int().nonnegative().nullable().optional(),
  lastServiceDate: z.iso.date().nullable().optional(),
});
export type UpdateVehicleServiceConfig = z.infer<typeof UpdateVehicleServiceConfigSchema>;

/** Convenience action: stamp "serviced today, at this odometer reading" in one call. */
export const MarkServiceDoneSchema = z.object({
  odometerKm: z.number().int().nonnegative(),
  serviceDate: z.iso.date(),
});
export type MarkServiceDone = z.infer<typeof MarkServiceDoneSchema>;

// ---------- Odometer readings ----------

export const OdometerReadingSchema = z.object({
  id: z.uuid(),
  resourceId: z.uuid(),
  odometerKm: z.number().int().nonnegative(),
  readingDate: z.iso.date(),
  /** the fuel/service spend this reading was taken alongside, or null for a plain reading */
  transactionId: z.uuid().nullable(),
  /** paise magnitude of the linked transaction, if any — not stored, joined in for the economy calc */
  amountPaise: z.number().int().nullable(),
  notes: z.string(),
  createdAt: z.iso.datetime(),
});
export type OdometerReading = z.infer<typeof OdometerReadingSchema>;

/** A candidate transaction to link a new odometer reading to — a spend already tagged to this vehicle resource. */
export const VehicleTransactionCandidateSchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  merchant: z.string(),
  amountPaise: z.number().int(),
});
export type VehicleTransactionCandidate = z.infer<typeof VehicleTransactionCandidateSchema>;

export const CreateOdometerReadingSchema = z.object({
  odometerKm: z.number().int().nonnegative(),
  readingDate: z.iso.date(),
  transactionId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(500).default(""),
});
export type CreateOdometerReading = z.infer<typeof CreateOdometerReadingSchema>;

// ---------- Fuel economy, derived between consecutive readings ----------

/**
 * One driven interval between two consecutive odometer readings (by date).
 * "Full-to-full" convention: the fuel amount spent AT the start of the
 * interval is assumed to have been consumed driving to the end of it, so the
 * economy figure attaches to `fromReadingId`'s linked transaction — never to
 * litres, which this app has no reliable way to capture (a receipt states an
 * amount paid, not a litre count a reviewer can be expected to transcribe).
 */
export const MileageIntervalSchema = z.object({
  fromReadingId: z.uuid(),
  toReadingId: z.uuid(),
  fromDate: z.iso.date(),
  toDate: z.iso.date(),
  kmDriven: z.number().int(),
  /** paise spent on the fuel-up that opened this interval, or null if untracked */
  amountPaise: z.number().int().nullable(),
  /** km covered per ₹100 of that spend, or null when amountPaise is null, zero, or kmDriven isn't positive */
  kmPer100Rupees: z.number().nullable(),
});
export type MileageInterval = z.infer<typeof MileageIntervalSchema>;

/** One row of the vehicles overview list — cheap enough to compute for every vehicle at once. */
export const VehicleOverviewSchema = z.object({
  resourceId: z.uuid(),
  name: z.string(),
  currentOdometerKm: z.number().int().nullable(),
  serviceDue: z.boolean(),
  dueByKm: z.boolean(),
  dueByTime: z.boolean(),
});
export type VehicleOverview = z.infer<typeof VehicleOverviewSchema>;

export const VehicleSummarySchema = z.object({
  resourceId: z.uuid(),
  name: z.string(),
  config: VehicleServiceConfigSchema,
  currentOdometerKm: z.number().int().nullable(),
  /** true once either the km or time interval is at/past its remind window (whichever comes first) */
  serviceDue: z.boolean(),
  dueByKm: z.boolean(),
  dueByTime: z.boolean(),
  /** odometer reading at which the next service falls due, or null if km isn't tracked */
  nextServiceOdometerKm: z.number().int().nullable(),
  /** calendar date the next service falls due, or null if time isn't tracked */
  nextServiceDate: z.iso.date().nullable(),
  /** newest-first */
  readings: z.array(OdometerReadingSchema),
  /** oldest-to-newest driven intervals derived from `readings` */
  intervals: z.array(MileageIntervalSchema),
});
export type VehicleSummary = z.infer<typeof VehicleSummarySchema>;
