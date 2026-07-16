import { and, eq } from "drizzle-orm";
import type { CreateEmi, EmiSummary, UpsertEmiDetails } from "@compass/shared";
import { CreateEmiSchema, standardEmiPaise, UpsertEmiDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, emiDetails, recurringTemplates } from "../db/schema.ts";
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
