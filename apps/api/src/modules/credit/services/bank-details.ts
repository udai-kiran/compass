import { and, eq } from "drizzle-orm";
import type { BankDetails, UpsertBankDetails } from "@compass/shared";
import { isBankAccount, UpsertBankDetailsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts } from "../../../db/schema.ts";
import { bankDetails } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { syncAccountLast4 } from "../../ledger/services/accounts.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";

type DetailsRow = typeof bankDetails.$inferSelect;

function toDetails(d: DetailsRow): BankDetails {
  return {
    accountId: d.accountId,
    accountNumber: d.accountNumber,
    ifsc: d.ifsc,
    branch: d.branch,
    subtype: d.subtype,
    requiredAmbPaise: d.requiredAmbPaise,
    debitCardLast4: d.debitCardLast4,
  };
}

async function ownedBankAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (!isBankAccount(assertPublicAccountType(acc.type))) throw new HttpError(400, "Not a bank account");
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
  const { requiredAmbPaise, ...parsed } = UpsertBankDetailsSchema.parse(input);

  // requiredAmbPaise has no schema default (see UpsertBankDetailsSchema): an
  // omitted field must preserve whatever is already stored, not silently reset
  // it to 0. So the insert path falls back to 0 (a brand-new row has nothing
  // stored yet), but the conflict-update `set` only includes the key when the
  // caller actually sent a value.
  const rows = await db
    .insert(bankDetails)
    .values({ ...parsed, requiredAmbPaise: requiredAmbPaise ?? 0, accountId, userId })
    .onConflictDoUpdate({
      target: bankDetails.accountId,
      set: {
        ...parsed,
        ...(requiredAmbPaise !== undefined ? { requiredAmbPaise } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  await syncAccountLast4(db, userId, accountId, parsed.accountNumber);
  return toDetails(rows[0]!);
}
