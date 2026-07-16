import { and, eq } from "drizzle-orm";
import type { BankDetails, UpsertBankDetails } from "@compass/shared";
import { isBankAccount, UpsertBankDetailsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { accounts, bankDetails } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { syncAccountLast4 } from "./accounts.ts";

type DetailsRow = typeof bankDetails.$inferSelect;

function toDetails(d: DetailsRow): BankDetails {
  return {
    accountId: d.accountId,
    accountNumber: d.accountNumber,
    ifsc: d.ifsc,
    branch: d.branch,
    subtype: d.subtype,
  };
}

async function ownedBankAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (!isBankAccount(acc.type)) throw new HttpError(400, "Not a bank account");
  return acc;
}

export async function getBankDetails(
  db: Db,
  userId: string,
  accountId: string,
): Promise<BankDetails | null> {
  await ownedBankAccount(db, userId, accountId);
  const row = await db.query.bankDetails.findFirst({
    where: and(eq(bankDetails.accountId, accountId), eq(bankDetails.userId, userId)),
  });
  return row ? toDetails(row) : null;
}

export async function upsertBankDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertBankDetails,
): Promise<BankDetails> {
  await ownedBankAccount(db, userId, accountId);
  const parsed = UpsertBankDetailsSchema.parse(input);

  const rows = await db
    .insert(bankDetails)
    .values({ ...parsed, accountId, userId })
    .onConflictDoUpdate({
      target: bankDetails.accountId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();

  await syncAccountLast4(db, userId, accountId, parsed.accountNumber);
  return toDetails(rows[0]!);
}
