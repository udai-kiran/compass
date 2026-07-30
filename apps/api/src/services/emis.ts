import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import type { EmiInstallment, CreateEmi, EmiSummary, UpsertEmiDetails } from "@compass/shared";
import { CreateEmiSchema, standardEmiPaise, UpsertEmiDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, emiDetails, recurringTemplates, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { assertOwnedCategory } from "./ownership.ts";

function monthsSince(startDate: string, today: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let n = (ty - sy) * 12 + (tm - sm);
  if (td >= sd) n += 1; // this month's installment has landed
  return Math.max(0, n);
}

function addMonths(startDate: string, months: number): string {
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/**
 * Reducing-balance amortization: each installment pays one month's interest,
 * the rest reduces principal. Returns total interest over the full schedule
 * and the outstanding principal after `paid` installments.
 */
export function amortize(
  principalPaise: number,
  annualRateBps: number,
  installmentPaise: number,
  totalInstallments: number,
  paidInstallments: number,
): { totalInterestPaise: number; outstandingPaise: number } {
  const r = annualRateBps / 10000 / 12;
  let balance = principalPaise;
  let totalInterest = 0;
  let outstanding = principalPaise;
  for (let i = 0; i < totalInstallments && balance > 0; i += 1) {
    const interest = Math.round(balance * r);
    const principalPart = Math.min(balance, installmentPaise - interest);
    totalInterest += interest;
    balance -= Math.max(0, principalPart);
    if (i + 1 === paidInstallments) outstanding = balance;
  }
  if (paidInstallments >= totalInstallments) outstanding = 0;
  if (paidInstallments === 0) outstanding = principalPaise;
  return { totalInterestPaise: totalInterest, outstandingPaise: outstanding };
}

/** Whole calendar months between two ISO dates, ignoring day-of-month —
 *  the same monthly-period granularity annualRateBps/12 already assumes
 *  everywhere else in this file. Always >= 0 when `to >= from` lexically
 *  (guaranteed by callers, which pass date-ascending rows no earlier
 *  than `startDate` — see P4's date filter). */
function calendarMonthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Splits each actual installment payment into principal and interest,
 * walked against a running balance the same reducing-balance way
 * amortize() projects the fixed schedule — but driven by the *actual*
 * payment dates/amounts, so it's elapsed-month-aware rather than
 * one-period-per-row:
 *  - the first payment always accrues at least one period of interest
 *    (from `startDate`), even if it lands the same calendar month as
 *    `startDate` (that month IS the first period);
 *  - a later payment in the *same* calendar month as the previous one
 *    (e.g. a same-month top-up) accrues zero new interest — it's a pure
 *    principal payment against the already-charged period;
 *  - a payment after a gap of N unpaid calendar months capitalizes
 *    (adds to balance, uncompounded-per-day but compounded-per-skipped-
 *    month) the interest for the N-1 skipped months before charging the
 *    final, paid period — real negative amortization for a genuinely
 *    missed payment, not modeled beyond whole-month granularity.
 * `principalPaise + interestPaise` is always exactly `abs(amountPaise)`
 * except when a payment overshoots what's needed to zero the balance
 * (a payoff/overpayment) — the excess isn't attributed to either bucket
 * and balancePaise simply floors at 0.
 * Callers must pre-filter to outflow-signed (amountPaise < 0),
 * same-account transactions — this function trusts its input list is
 * already the correct set of real installment payments, date-ascending.
 */
export function splitInstallments(
  principalPaise: number,
  annualRateBps: number,
  startDate: string,
  payments: { transactionId: string; date: string; amountPaise: number }[],
): {
  transactionId: string;
  date: string;
  amountPaise: number;
  principalPaise: number;
  interestPaise: number;
  balancePaise: number;
}[] {
  const r = annualRateBps / 10000 / 12;
  let balance = principalPaise;
  let prevDate = startDate;
  const out: ReturnType<typeof splitInstallments> = [];
  for (const [i, p] of payments.entries()) {
    const paid = Math.abs(p.amountPaise);
    const elapsed =
      i === 0
        ? Math.max(1, calendarMonthsBetween(startDate, p.date))
        : Math.max(0, calendarMonthsBetween(prevDate, p.date));
    // Capitalize interest for any fully-skipped, unpaid months before
    // this payment's own period.
    const skippedPeriods = Math.max(0, elapsed - 1);
    for (let s = 0; s < skippedPeriods; s += 1) {
      balance += Math.round(balance * r);
    }
    // This payment's own period (elapsed === 0 means "same month as the
    // previous payment" — no new period, no new interest).
    const periodInterest = elapsed === 0 ? 0 : Math.round(balance * r);
    const interestPaise = Math.min(periodInterest, paid);
    const shortfall = periodInterest - interestPaise; // unpaid interest, capitalizes
    const principalPart = Math.max(0, Math.min(balance, paid - interestPaise));
    balance = Math.max(0, balance - principalPart + shortfall);
    out.push({
      transactionId: p.transactionId,
      date: p.date,
      amountPaise: p.amountPaise,
      principalPaise: principalPart,
      interestPaise,
      balancePaise: balance,
    });
    prevDate = p.date;
  }
  return out;
}

/**
 * Create an EMI as a monthly recurring template (kind = "emi") plus its loan
 * schedule. The installment is derived from principal/rate/tenure and stored as
 * the template's (negative) amount; the recurring engine then materializes each
 * due installment as a transaction. endDate caps materialization at the tenure.
 */
export async function createEmi(db: Db, userId: string, input: CreateEmi): Promise<EmiSummary> {
  const parsed = CreateEmiSchema.parse(input);
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, parsed.accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  await assertOwnedCategory(db, userId, parsed.categoryId);

  const installment = standardEmiPaise(
    parsed.principalPaise,
    parsed.annualRateBps,
    parsed.totalInstallments,
  );
  const endDate = addMonths(parsed.startDate, parsed.totalInstallments - 1);

  const templateId = await db.transaction(async (trx) => {
    const [tpl] = await trx
      .insert(recurringTemplates)
      .values({
        userId,
        accountId: parsed.accountId,
        categoryId: parsed.categoryId ?? null,
        merchant: parsed.name,
        amountPaise: -installment,
        notes: "",
        frequency: "monthly",
        interval: 1,
        nextDueDate: parsed.startDate,
        endDate,
        kind: "emi",
      })
      .returning({ id: recurringTemplates.id });
    await trx.insert(emiDetails).values({
      templateId: tpl!.id,
      userId,
      principalPaise: parsed.principalPaise,
      annualRateBps: parsed.annualRateBps,
      totalInstallments: parsed.totalInstallments,
      startDate: parsed.startDate,
    });
    return tpl!.id;
  });

  const list = await listEmis(db, userId);
  return list.find((e) => e.templateId === templateId)!;
}

/** Delete an EMI (and its schedule); materialized installments stay as transactions. */
export async function deleteEmi(db: Db, userId: string, templateId: string): Promise<void> {
  const rows = await db
    .delete(recurringTemplates)
    .where(and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)))
    .returning({ id: recurringTemplates.id });
  if (rows.length === 0) throw new HttpError(404, "EMI not found");
}

export async function upsertEmiDetails(
  db: Db,
  userId: string,
  templateId: string,
  input: UpsertEmiDetails,
): Promise<EmiSummary> {
  const template = await db.query.recurringTemplates.findFirst({
    where: and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)),
  });
  if (!template) throw new HttpError(404, "Template not found");
  if (template.kind !== "emi") throw new HttpError(400, "Template kind must be 'emi'");
  const parsed = UpsertEmiDetailsSchema.parse(input);
  await db
    .insert(emiDetails)
    .values({ ...parsed, templateId, userId })
    .onConflictDoUpdate({ target: emiDetails.templateId, set: { ...parsed, updatedAt: new Date() } });
  const list = await listEmis(db, userId);
  return list.find((e) => e.templateId === templateId)!;
}

export async function listEmis(db: Db, userId: string): Promise<EmiSummary[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ d: emiDetails, t: recurringTemplates })
    .from(emiDetails)
    .innerJoin(recurringTemplates, eq(recurringTemplates.id, emiDetails.templateId))
    .where(eq(emiDetails.userId, userId));
  return rows
    .map(({ d, t }) => {
      const installment = Math.abs(t.amountPaise);
      const paid = Math.min(d.totalInstallments, monthsSince(d.startDate, today));
      const { totalInterestPaise, outstandingPaise } = amortize(
        d.principalPaise,
        d.annualRateBps,
        installment,
        d.totalInstallments,
        paid,
      );
      return {
        templateId: t.id,
        accountId: t.accountId,
        merchant: t.merchant,
        installmentPaise: installment,
        principalPaise: d.principalPaise,
        annualRateBps: d.annualRateBps,
        totalInstallments: d.totalInstallments,
        paidInstallments: paid,
        remainingInstallments: d.totalInstallments - paid,
        totalInterestPaise,
        outstandingPaise,
        payoffDate: addMonths(d.startDate, d.totalInstallments - 1),
        paused: t.pausedAt !== null,
      };
    })
    .sort((a, b) => a.payoffDate.localeCompare(b.payoffDate));
}

/**
 * Real ledger transactions materialized against an EMI's recurring template,
 * each split into principal/interest via splitInstallments. The query is
 * defensively scoped to the template's own account, outflow-signed rows,
 * and dates on-or-after the loan's startDate — see TASK.md P4 (review-1
 * findings 2/3, review-2 finding 1) for why each filter is needed.
 */
export async function listEmiInstallments(
  db: Db,
  userId: string,
  templateId: string,
): Promise<EmiInstallment[]> {
  const template = await db.query.recurringTemplates.findFirst({
    where: and(eq(recurringTemplates.id, templateId), eq(recurringTemplates.userId, userId)),
  });
  if (!template) throw new HttpError(404, "Template not found");
  if (template.kind !== "emi") throw new HttpError(400, "Template kind must be 'emi'");
  const d = await db.query.emiDetails.findFirst({
    where: and(eq(emiDetails.templateId, templateId), eq(emiDetails.userId, userId)),
  });
  if (!d) throw new HttpError(404, "EMI details not found");

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountPaise: transactions.amountPaise,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurringTemplateId, templateId),
        eq(transactions.userId, userId),
        eq(transactions.accountId, template.accountId),
        lt(transactions.amountPaise, 0),
        gte(transactions.date, d.startDate),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))
    .limit(2000);

  return splitInstallments(
    d.principalPaise,
    d.annualRateBps,
    d.startDate,
    rows.map((r) => ({ transactionId: r.id, date: r.date, amountPaise: r.amountPaise })),
  );
}
