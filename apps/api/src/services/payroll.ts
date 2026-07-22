import { and, eq } from "drizzle-orm";
import type { AccountType, CreatePayslip, PayslipDeduction, PayslipResult } from "@compass/shared";
import { isRetirementAccount } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, categories } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { findOrCreateCategory } from "./categories.ts";
import { createTransaction } from "./transactions.ts";
import { linkTransfer } from "./transfers.ts";

/** Fetch an owned account's type, or 404. Enforces both ownership and existence. */
async function ownedAccountType(db: Db, userId: string, accountId: string): Promise<AccountType> {
  const row = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
    columns: { type: true },
  });
  if (!row) throw new HttpError(404, "Account not found");
  return row.type;
}

const PAYSLIP_TAG = "payslip";

/**
 * Pure arithmetic of a payslip: gross minus every deduction is take-home, and the
 * deductions roll up by kind (TDS + professional tax = tax, EPF, everything else).
 * Kept separate from the DB orchestration so the money math is unit-testable.
 */
export function computePayslip(
  grossPaise: number,
  deductions: Pick<PayslipDeduction, "kind" | "amountPaise">[],
): { netPaise: number; taxPaise: number; epfPaise: number; otherPaise: number } {
  let taxPaise = 0;
  let epfPaise = 0;
  let otherPaise = 0;
  for (const d of deductions) {
    if (d.kind === "tds" || d.kind === "professional_tax") taxPaise += d.amountPaise;
    else if (d.kind === "epf") epfPaise += d.amountPaise;
    else otherPaise += d.amountPaise;
  }
  return { netPaise: grossPaise - taxPaise - epfPaise - otherPaise, taxPaise, epfPaise, otherPaise };
}

function deductionNote(d: PayslipDeduction): string {
  if (d.kind === "tds") return "TDS";
  if (d.kind === "professional_tax") return "Professional Tax";
  if (d.kind === "epf") return "EPF contribution";
  return d.label.trim() || "Deduction";
}

/**
 * Record a payslip as linked ledger entries: the gross as bank income, each tax
 * as a bank expense (Taxes / Salary Deductions category), and each EPF slice as a
 * transfer from the bank into the chosen retirement account. All entries share the
 * `payslip` tag and the employer as merchant. The bank balance nets to take-home.
 */
export async function createPayslip(
  db: Db,
  userId: string,
  input: CreatePayslip,
): Promise<PayslipResult> {
  // Enforce the account-type invariants the UI relies on — a direct API call must
  // not credit gross salary to a card/investment or route EPF to a non-retirement
  // account. Salary lands in a spendable account; EPF lands in a retirement one.
  const bankType = await ownedAccountType(db, userId, input.bankAccountId);
  if (bankType !== "bank" && bankType !== "cash") {
    throw new HttpError(400, "Salary must be credited to a bank or cash account");
  }
  for (const d of input.deductions) {
    if (d.kind !== "epf") continue;
    const destType = await ownedAccountType(db, userId, d.toAccountId!);
    if (!isRetirementAccount(destType)) {
      throw new HttpError(400, "EPF must go to a PPF, EPF or SSY account");
    }
  }

  // A caller-supplied income category must actually be income — otherwise the
  // gross credit would land under an expense bucket and skew every report.
  if (input.categoryId) {
    const cat = await db.query.categories.findFirst({
      where: and(eq(categories.id, input.categoryId), eq(categories.userId, userId)),
    });
    if (!cat) throw new HttpError(404, "Category not found");
    if (cat.kind !== "income") throw new HttpError(400, "Salary category must be an income category");
  }

  const rollup = computePayslip(input.grossPaise, input.deductions);
  const employer = input.employer;

  const transactionIds = await db.transaction(async (tx) => {
    const ids: string[] = [];

    const salaryCategoryId =
      input.categoryId ?? (await findOrCreateCategory(tx, userId, "Salary", "income", "💰")).id;

    // Gross salary → bank income.
    const gross = await createTransaction(tx, userId, {
      accountId: input.bankAccountId,
      date: input.date,
      amountPaise: input.grossPaise,
      merchant: employer,
      categoryId: salaryCategoryId,
      notes: input.notes,
      tags: [PAYSLIP_TAG],
    });
    ids.push(gross.id);

    for (const d of input.deductions) {
      if (d.kind === "epf") {
        // EPF is not spent — it moves into a retirement asset. Book both legs and
        // link them so it's excluded from income/expense but grows the account.
        const outLeg = await createTransaction(tx, userId, {
          accountId: input.bankAccountId,
          date: input.date,
          amountPaise: -d.amountPaise,
          merchant: employer,
          categoryId: null,
          notes: deductionNote(d),
          tags: [PAYSLIP_TAG],
        });
        const inLeg = await createTransaction(tx, userId, {
          accountId: d.toAccountId!,
          date: input.date,
          amountPaise: d.amountPaise,
          merchant: employer,
          categoryId: null,
          notes: deductionNote(d),
          tags: [PAYSLIP_TAG],
        });
        await linkTransfer(tx, userId, outLeg.id, inLeg.id, false);
        ids.push(outLeg.id, inLeg.id);
        continue;
      }

      // TDS / professional tax → Taxes; anything else → Salary Deductions.
      const isTax = d.kind === "tds" || d.kind === "professional_tax";
      const category = isTax
        ? await findOrCreateCategory(tx, userId, "Taxes", "expense", "🧾")
        : await findOrCreateCategory(tx, userId, "Salary Deductions", "expense", "📄");
      const expense = await createTransaction(tx, userId, {
        accountId: input.bankAccountId,
        date: input.date,
        amountPaise: -d.amountPaise,
        merchant: employer,
        categoryId: category.id,
        notes: deductionNote(d),
        tags: [PAYSLIP_TAG],
      });
      ids.push(expense.id);
    }

    return ids;
  });

  return {
    grossPaise: input.grossPaise,
    netPaise: rollup.netPaise,
    taxPaise: rollup.taxPaise,
    epfPaise: rollup.epfPaise,
    otherPaise: rollup.otherPaise,
    transactionIds,
  };
}
