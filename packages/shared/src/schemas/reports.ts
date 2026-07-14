import { z } from "zod";

export const ReportPeriodSchema = z.enum(["monthly", "annual"]);
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
  categories: z.array(
    z.object({ categoryId: z.uuid().nullable(), name: z.string(), spentPaise: z.number().int() }),
  ),
  topMerchants: z.array(
    z.object({ merchant: z.string(), spentPaise: z.number().int(), count: z.number().int() }),
  ),
});
export type Report = z.infer<typeof ReportSchema>;
