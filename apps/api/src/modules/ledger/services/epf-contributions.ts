import { and, eq } from "drizzle-orm";
import type { AccountType, CreateEpfContribution, EpfContributionResult } from "@compass/shared";
import { formatINR, isRetirementAccount } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";
import { findOrCreateCategory } from "./categories.ts";
import { createTransaction } from "./transactions.ts";

/** Fetch an owned account's type and archived state, or 404. Enforces both ownership and existence. */
async function ownedAccountType(
  db: Db,
  userId: string,
  accountId: string,
): Promise<{ type: AccountType; archivedAt: Date | null }> {
  const row = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
    columns: { type: true, archivedAt: true },
  });
  if (!row) throw new HttpError(404, "Account not found");
  return { ...row, type: assertPublicAccountType(row.type) };
}

const PAYSLIP_TAG = "payslip";

/**
 * Record an EPF contribution as one plain income transaction on the chosen
 * retirement account — no bank leg. The employer pays EPF straight to EPFO,
 * never through the user's bank, so there's nothing on the bank side to book;
 * the payslip is the only record of the contribution.
 */
export async function recordEpfContribution(
  db: Db,
  userId: string,
  input: CreateEpfContribution,
): Promise<EpfContributionResult> {
  const destAccount = await ownedAccountType(db, userId, input.toAccountId);
  if (!isRetirementAccount(destAccount.type)) {
    throw new HttpError(400, "EPF must go to a PPF, EPF or SSY account");
  }
  if (destAccount.archivedAt !== null) {
    throw new HttpError(400, "Account is archived");
  }

  const totalPaise =
    input.employeeSharePaise + input.employerSharePaise + input.pensionSharePaise;

  const breakdown = `EE: ${formatINR(input.employeeSharePaise)} | ER: ${formatINR(input.employerSharePaise)} | EPS: ${formatINR(input.pensionSharePaise)}`;
  const notes = input.notes.trim() ? `${breakdown}\n${input.notes.trim()}` : breakdown;

  // Wrapped in a transaction: findOrCreateCategory can both look up and
  // insert a category row, and createTransaction performs its own multiple
  // reads-then-insert. Without a surrounding transaction, a failure after
  // category creation but before the transaction insert would leave an
  // orphaned, unused category row.
  const txn = await db.transaction(async (tx) => {
    const category = await findOrCreateCategory(tx, userId, "EPF Contribution", "income", "🏦");

    return createTransaction(tx, userId, {
      accountId: input.toAccountId,
      date: input.date,
      amountPaise: totalPaise,
      merchant: input.employer,
      categoryId: category.id,
      notes,
      tags: [PAYSLIP_TAG],
    });
  });

  return { transactionId: txn.id, amountPaise: txn.amountPaise };
}
