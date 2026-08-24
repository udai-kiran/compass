/**
 * CRUD service for deposit_details (FD / RD / NSC / Tax-saver FD).
 *
 * Ownership pattern mirrors holding-details.ts:
 *  1. Load the holding by (id, userId) — throws 404 if absent.
 *  2. Verify assetClass === 'fd' — throws 400 otherwise.
 *  3. Read/write deposit_details.
 *
 * The accrual schedule is computed on demand via computeAccrualSchedule (pure,
 * never stored).
 */
import { and, eq } from "drizzle-orm";
import type {
  DepositDetails,
  UpsertDepositDetails,
  AccrualScheduleResponse,
} from "@compass/shared";
import { UpsertDepositDetailsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { holdings, depositDetails } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { computeAccrualSchedule, addMonths } from "./deposit-accrual.ts";
import type { DepositTerms } from "./deposit-accrual.ts";

type DepositRow = typeof depositDetails.$inferSelect;

function toResponse(row: DepositRow): DepositDetails {
  return {
    holdingId: row.holdingId,
    userId: row.userId,
    depositKind: row.depositKind,
    principalPaise: row.principalPaise,
    installmentPaise: row.installmentPaise,
    totalInstallments: row.totalInstallments,
    annualRateBps: row.annualRateBps,
    compoundingFrequency: row.compoundingFrequency,
    interestDisposition: row.interestDisposition,
    // payoutFrequency is stored as text; cast to the Zod enum type.
    payoutFrequency: row.payoutFrequency as DepositDetails["payoutFrequency"],
    startDate: row.startDate,
    maturityDate: row.maturityDate,
    autoRenewal: row.autoRenewal,
    prematureClosurePenaltyBps: row.prematureClosurePenaltyBps,
    jointHolderName: row.jointHolderName,
    tdsSectionApplicable: row.tdsSectionApplicable,
  };
}

async function ownedFdHolding(db: Db, userId: string, holdingId: string) {
  const h = await db.query.holdings.findFirst({
    where: and(eq(holdings.id, holdingId), eq(holdings.userId, userId)),
  });
  if (!h) throw new HttpError(404, "Holding not found");
  if (h.assetClass !== "fd") throw new HttpError(400, "Not an fd holding");
  return h;
}

function toTerms(row: DepositRow): DepositTerms {
  return {
    depositKind: row.depositKind,
    principalPaise: row.principalPaise ?? undefined,
    installmentPaise: row.installmentPaise ?? undefined,
    totalInstallments: row.totalInstallments ?? undefined,
    annualRateBps: row.annualRateBps,
    compoundingFrequency: row.compoundingFrequency,
    interestDisposition: row.interestDisposition,
    startDate: row.startDate,
    maturityDate: row.maturityDate,
  };
}

export function validateDepositKindConstraints(input: UpsertDepositDetails): void {
  const kind = input.depositKind;
  if (kind === "rd") {
    if (input.installmentPaise == null) {
      throw new HttpError(400, "installmentPaise is required for RD");
    }
    if (input.totalInstallments == null) {
      throw new HttpError(400, "totalInstallments is required for RD");
    }
    // RD requires quarterly compounding (standard Indian convention).
    if (input.compoundingFrequency !== "quarterly") {
      throw new HttpError(400, "RD requires quarterly compounding");
    }
  } else {
    // fd, nsc, tax_saver_fd
    if (input.principalPaise == null) {
      throw new HttpError(400, "principalPaise is required for FD/NSC/tax_saver_fd");
    }
    if (kind === "nsc") {
      // NSC must use annual compounding and reinvest mode.
      if (input.compoundingFrequency !== "annually") {
        throw new HttpError(400, "NSC requires annual compounding");
      }
      if (input.interestDisposition !== "reinvest") {
        throw new HttpError(400, "NSC requires reinvest interest disposition");
      }
      // NSC is a 5-year instrument (exact calendar comparison).
      const expected5y = addMonths(input.startDate, 60);
      if (input.maturityDate !== expected5y) {
        throw new HttpError(400, "NSC must have a 5-year term");
      }
    }
    if (kind === "tax_saver_fd") {
      // Tax-saver FD must be exactly 5 calendar years (leap-safe exact comparison).
      const expected5y = addMonths(input.startDate, 60);
      if (input.maturityDate !== expected5y) {
        throw new HttpError(400, "Tax-saver FD must have a 5-year lock-in");
      }
    }
  }
  if (input.maturityDate <= input.startDate) {
    throw new HttpError(400, "maturityDate must be after startDate");
  }
}

export async function getDepositDetails(
  db: Db,
  userId: string,
  holdingId: string,
): Promise<DepositDetails | null> {
  await ownedFdHolding(db, userId, holdingId);
  const row = await db.query.depositDetails.findFirst({
    where: and(eq(depositDetails.holdingId, holdingId), eq(depositDetails.userId, userId)),
  });
  return row ? toResponse(row) : null;
}

export async function upsertDepositDetails(
  db: Db,
  userId: string,
  holdingId: string,
  input: UpsertDepositDetails,
): Promise<DepositDetails> {
  await ownedFdHolding(db, userId, holdingId);
  const parsed = UpsertDepositDetailsSchema.parse(input);
  validateDepositKindConstraints(parsed);

  const rows = await db
    .insert(depositDetails)
    .values({
      holdingId,
      userId,
      depositKind: parsed.depositKind,
      principalPaise: parsed.principalPaise ?? null,
      installmentPaise: parsed.installmentPaise ?? null,
      totalInstallments: parsed.totalInstallments ?? null,
      annualRateBps: parsed.annualRateBps,
      compoundingFrequency: parsed.compoundingFrequency,
      interestDisposition: parsed.interestDisposition,
      payoutFrequency: parsed.payoutFrequency ?? null,
      startDate: parsed.startDate,
      maturityDate: parsed.maturityDate,
      autoRenewal: parsed.autoRenewal,
      prematureClosurePenaltyBps: parsed.prematureClosurePenaltyBps ?? null,
      jointHolderName: parsed.jointHolderName ?? null,
      tdsSectionApplicable: parsed.tdsSectionApplicable,
    })
    .onConflictDoUpdate({
      target: depositDetails.holdingId,
      set: {
        depositKind: parsed.depositKind,
        principalPaise: parsed.principalPaise ?? null,
        installmentPaise: parsed.installmentPaise ?? null,
        totalInstallments: parsed.totalInstallments ?? null,
        annualRateBps: parsed.annualRateBps,
        compoundingFrequency: parsed.compoundingFrequency,
        interestDisposition: parsed.interestDisposition,
        payoutFrequency: parsed.payoutFrequency ?? null,
        startDate: parsed.startDate,
        maturityDate: parsed.maturityDate,
        autoRenewal: parsed.autoRenewal,
        prematureClosurePenaltyBps: parsed.prematureClosurePenaltyBps ?? null,
        jointHolderName: parsed.jointHolderName ?? null,
        tdsSectionApplicable: parsed.tdsSectionApplicable,
        updatedAt: new Date(),
      },
    })
    .returning();

  return toResponse(rows[0]!);
}

export async function getDepositSchedule(
  db: Db,
  userId: string,
  holdingId: string,
): Promise<AccrualScheduleResponse> {
  await ownedFdHolding(db, userId, holdingId);
  const row = await db.query.depositDetails.findFirst({
    where: and(eq(depositDetails.holdingId, holdingId), eq(depositDetails.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Deposit details not found");
  const schedule = computeAccrualSchedule(toTerms(row));
  return {
    holdingId,
    periods: schedule.periods,
    totalInterestPaise: schedule.totalInterestPaise,
    totalDepositPaise: schedule.totalDepositPaise,
    maturityValuePaise: schedule.maturityValuePaise,
  };
}
