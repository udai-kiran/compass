import { z } from "zod";

// ---------- Maturity & renewal calendar (task 14.3) ----------

/** Source type for a calendar event — what instrument produced it. */
export const CalendarSourceSchema = z.enum([
  "insurance_renewal",
  "insurance_maturity",
  "fd_maturity",
  "rd_maturity",
  "nsc_maturity",
  "ppf_maturity",
  "ppf_extension",
  "ssy_maturity",
  "ssy_partial_withdrawal",
  "sgb_exit_window",
  "sgb_maturity",
  "elss_unlock",
  "epf_retirement",
]);
export type CalendarSource = z.infer<typeof CalendarSourceSchema>;

/** A single event on the maturity/renewal calendar. */
export const CalendarEventSchema = z.object({
  /** stable key for dedup (e.g. "ppf:<accountId>:maturity") */
  key: z.string(),
  /** the calendar date this event falls on */
  date: z.iso.date(),
  source: CalendarSourceSchema,
  /** human-readable title, e.g. "SBI FD matures" */
  title: z.string(),
  /** longer description with amount/details */
  description: z.string(),
  /** the relevant entity ID (account, holding, or policy) */
  entityId: z.string(),
  /** amount in paise if applicable (maturity value, sum assured, etc.) */
  amountPaise: z.number().int().nullable(),
  /** whether this item is past due / already matured */
  isPast: z.boolean(),
  /** warnings, e.g. "auto-renewal may roll into a worse rate" */
  warnings: z.array(z.string()),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

/** The full calendar response. */
export const MaturityCalendarSchema = z.object({
  events: z.array(CalendarEventSchema),
  /** events grouped by upcoming/past */
  upcomingCount: z.number().int(),
  pastCount: z.number().int(),
  /** assets that have already matured and may be sitting idle */
  maturedIdleCount: z.number().int(),
});
export type MaturityCalendar = z.infer<typeof MaturityCalendarSchema>;

// ---------- Nominee & continuity dossier (task 14.4) ----------

/** One row in the dossier — any financial asset, liability, or policy with its nominee status. */
export const DossierEntrySchema = z.object({
  /** stable key: "<type>:<id>" */
  key: z.string(),
  /** "account" | "holding" | "insurance_policy" */
  entityType: z.enum(["account", "holding", "insurance_policy"]),
  entityId: z.string(),
  /** display name of the asset/liability */
  name: z.string(),
  /** further classification: account type, asset class, or insurance kind */
  subtype: z.string(),
  /** institution/insurer, if known */
  institution: z.string().nullable(),
  /** identifying number: account last4, folio, policy number */
  identifier: z.string().nullable(),
  /** nominee name; "" when none recorded */
  nominee: z.string(),
  /** linked family member ID as nominee */
  nomineePersonId: z.uuid().nullable(),
  /** linked family member name (denormalized for display) */
  nomineePersonName: z.string().nullable(),
  /** whether a policy document or file reference exists */
  hasDocument: z.boolean(),
  /** current value or sum assured, in paise; null if unknown */
  valuePaise: z.number().int().nullable(),
  /** true for accounts with no nominee set — the headline stat */
  missingNominee: z.boolean(),
});
export type DossierEntry = z.infer<typeof DossierEntrySchema>;

/** The full dossier response. */
export const ContinuityDossierSchema = z.object({
  entries: z.array(DossierEntrySchema),
  /** accounts/holdings/policies with no nominee — the headline */
  missingNomineeCount: z.number().int(),
  totalEntries: z.number().int(),
  /** Displayed prominently: nomination is NOT inheritance. */
  disclaimer: z.string(),
});
export type ContinuityDossier = z.infer<typeof ContinuityDossierSchema>;
