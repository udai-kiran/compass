import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { HttpError } from "../../../lib/errors.ts";
import { settlements, splits, splitShares } from "../schema.ts";

export interface CreateSettlementInput {
  householdId: string;
  fromPersonId: string;
  toPersonId: string;
  amountPaise: number;
  note?: string;
}

export async function createSettlement(
  db: DbOrTx,
  _userId: string,
  input: CreateSettlementInput,
): Promise<typeof settlements.$inferSelect> {
  const [settlement] = await db
    .insert(settlements)
    .values({
      householdId: input.householdId,
      fromPersonId: input.fromPersonId,
      toPersonId: input.toPersonId,
      amountPaise: input.amountPaise,
      note: input.note ?? null,
    })
    .returning();
  if (!settlement) throw new HttpError(500, "Failed to insert settlement");
  return settlement;
}

export async function listSettlements(
  db: DbOrTx,
  _userId: string,
  householdId: string,
): Promise<(typeof settlements.$inferSelect)[]> {
  return db
    .select()
    .from(settlements)
    .where(eq(settlements.householdId, householdId));
}

/**
 * Compute net paise balance per person for a household.
 * Positive = owed money (others owe them), Negative = owes money.
 *
 * Model:
 *   - For each split, the payer fronted the money; non-payers owe their share.
 *   - Payer is credited by the sum of everyone else's shares.
 *   - Each non-payer is debited by their sharePaise.
 *   - Zero-sum invariant: sum of all balances = 0 for each split.
 *   - Settlements reduce outstanding balances between pairs.
 */
export async function getHouseholdBalances(
  db: DbOrTx,
  _userId: string,
  householdId: string,
): Promise<Record<string, number>> {
  // Single JOIN query — no N+1 loop
  const rows = await db
    .select({
      splitId: splits.id,
      payerPersonId: splits.payerPersonId,
      personId: splitShares.personId,
      sharePaise: splitShares.sharePaise,
    })
    .from(splits)
    .innerJoin(splitShares, eq(splitShares.splitId, splits.id))
    .where(eq(splits.householdId, householdId));

  const balances: Record<string, number> = {};

  // Group rows by splitId
  const bySplit = new Map<string, { payerPersonId: string; shares: { personId: string; sharePaise: number }[] }>();
  for (const row of rows) {
    if (!bySplit.has(row.splitId)) {
      bySplit.set(row.splitId, { payerPersonId: row.payerPersonId, shares: [] });
    }
    bySplit.get(row.splitId)!.shares.push({ personId: row.personId, sharePaise: row.sharePaise });
  }

  for (const { payerPersonId, shares } of bySplit.values()) {
    // Sum up what all non-payers owe
    const othersTotal = shares.reduce((s, x) => x.personId !== payerPersonId ? s + x.sharePaise : s, 0);
    // Debit each non-payer for their share
    for (const { personId, sharePaise } of shares) {
      if (personId !== payerPersonId) {
        balances[personId] = (balances[personId] ?? 0) - sharePaise;
      }
    }
    // Credit payer exactly once per split
    balances[payerPersonId] = (balances[payerPersonId] ?? 0) + othersTotal;
  }

  // Apply settlements: fromPerson paid toPerson → reduce fromPerson's debt
  const settledRows = await listSettlements(db, _userId, householdId);
  for (const s of settledRows) {
    // fromPerson paid amountPaise → their balance improves (less debt)
    balances[s.fromPersonId] = (balances[s.fromPersonId] ?? 0) + s.amountPaise;
    // toPerson received amountPaise → their credit decreases
    balances[s.toPersonId] = (balances[s.toPersonId] ?? 0) - s.amountPaise;
  }

  return balances;
}
