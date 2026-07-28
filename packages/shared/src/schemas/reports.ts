import { z } from "zod";
import { inclusiveDayCount } from "../date.ts";

export const ReportPeriodSchema = z.enum(["monthly", "annual", "custom"]);
export type ReportPeriod = z.infer<typeof ReportPeriodSchema>;

export const ReportSchema = z.object({
  period: ReportPeriodSchema,
  periodKey: z.string(),
  from: z.iso.date(),
  to: z.iso.date(),
  incomePaise: z.number().int(),
  expensePaise: z.number().int(),
  netPaise: z.number().int(),
  savingsRatePct: z.number(),
  /**
   * Spend split by category necessity. The three buckets always sum to the total
   * of the `categories` breakdown below: both derive from the same
   * `spentByCategory` aggregation, so they share its handling of splits,
   * transfers, opening rows and soft deletes.
   *
   * That total equals `expensePaise` for ordinary data but is NOT guaranteed to.
   * `setSplits` only requires a transaction's splits to sum to its amount, not to
   * share its sign, so a mixed-sign split (-120 and +20 on a -100 transaction)
   * contributes 120 here while `expensePaise` counts 100. The discrepancy is
   * pre-existing and shared with the category breakdown and with budgets; it is
   * deliberately inherited rather than corrected here, so those three views stay
   * consistent with one another.
   *
   * `unclassifiedPaise` covers uncategorized spend and spend in categories whose
   * necessity has not been set.
   */
  necessity: z.object({
    essentialPaise: z.number().int(),
    nonEssentialPaise: z.number().int(),
    unclassifiedPaise: z.number().int(),
  }),
  categories: z.array(
    z.object({ categoryId: z.uuid().nullable(), name: z.string(), spentPaise: z.number().int() }),
  ),
  topMerchants: z.array(
    z.object({ merchant: z.string(), spentPaise: z.number().int(), count: z.number().int() }),
  ),
});
export type Report = z.infer<typeof ReportSchema>;

/**
 * A custom `from`/`to` range has no calendar bound the way a month or year does,
 * so without a cap a request could ask the report queries to scan an unbounded
 * span of transactions. 3660 days (~10 years) is generous for personal-finance
 * reporting while keeping the scan bounded.
 */
export const MAX_REPORT_RANGE_DAYS = 3660;

/** Shared month-key pattern (`YYYY-MM`, month 01-12) — the single definition used everywhere a monthly report key is validated. */
export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Shared year-key pattern (`YYYY`) — the single definition used everywhere an annual report key is validated. */
export const YEAR_KEY_RE = /^\d{4}$/;

/**
 * Query params for GET /api/reports (and the CSV variant). Stricter than the
 * old route-local `/^\d{4}(-\d{2})?$/` key regex: previously `period=monthly
 * &key=2026` and `period=annual&key=2026-07` were both accepted and produced a
 * nonsense range (e.g. `to: "2026-NaN"`); now they are rejected with a clean
 * 400 instead of silently computing garbage.
 */
export const ReportQuerySchema = z
  .object({
    period: ReportPeriodSchema.default("monthly"),
    key: z.string().optional(),
    // Date validity is delegated to Zod rather than the shared `isRealIsoDate`:
    // it runs before the refinement below and yields a typed per-field 400.
    // It rejects the same set (e.g. `2026-02-30`); `resolveReportRange` uses
    // `isRealIsoDate` for the same job on the paths that bypass Zod entirely.
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.period === "custom") {
      if (!v.from) {
        ctx.addIssue({ code: "custom", path: ["from"], message: "A start date is required" });
      }
      if (!v.to) {
        ctx.addIssue({ code: "custom", path: ["to"], message: "An end date is required" });
      }
      if (v.from && v.to) {
        if (v.from > v.to) {
          ctx.addIssue({
            code: "custom",
            path: ["to"],
            message: "The end date must not be before the start date",
          });
        } else if (inclusiveDayCount(v.from, v.to) > MAX_REPORT_RANGE_DAYS) {
          ctx.addIssue({
            code: "custom",
            path: ["to"],
            message: `The date range must not exceed ${MAX_REPORT_RANGE_DAYS} days`,
          });
        }
      }
      return;
    }
    if (!v.key) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "A period key is required" });
    } else if (v.period === "annual" && !YEAR_KEY_RE.test(v.key)) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "Year must be YYYY" });
    } else if (v.period === "monthly" && !MONTH_KEY_RE.test(v.key)) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "Month must be YYYY-MM" });
    }
  });
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
