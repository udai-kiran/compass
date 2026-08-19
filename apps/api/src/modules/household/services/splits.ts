import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { splits, splitShares } from "../schema.ts";
import { computeEqualShares, computeProportionalShares, validateExactShares } from "./split-math.ts";
import { HttpError } from "../../../lib/errors.ts";

export type SplitRule = "equal" | "shares" | "exact";

export interface CreateSplitInput {
  transactionId: string;
  householdId: string;
  rule: SplitRule;
  /**
   * Total transaction amount in paise — used to compute per-person shares.
   * Must be supplied by the caller (the amount lives on postings, not transactions).
   */
  totalPaise: number;
  /** Person ID of the member who paid the transaction */
  payerPersonId: string;
  /** Person IDs ordered consistently — one per share slot */
  memberPersonIds: string[];
  /** For rule="exact": paise per person, must sum to totalPaise */
  sharePaise?: number[];
  /** For rule="shares": positive integer ratios, one per member */
  ratios?: number[];
}

export async function createSplit(
  db: Db,
  userId: string,
  input: CreateSplitInput,
): Promise<typeof splits.$inferSelect> {
  const { transactionId, householdId, rule, totalPaise, payerPersonId, memberPersonIds, sharePaise, ratios } = input;

  // Compute per-person shares
  let computed: number[];
  if (rule === "equal") {
    computed = computeEqualShares(totalPaise, memberPersonIds.length);
  } else if (rule === "shares") {
    if (!ratios || ratios.length !== memberPersonIds.length) {
      throw new HttpError(400, "ratios must be provided and match memberPersonIds length for rule=shares");
    }
    computed = computeProportionalShares(totalPaise, ratios);
  } else {
    // exact
    if (!sharePaise || sharePaise.length !== memberPersonIds.length) {
      throw new HttpError(400, "sharePaise must be provided and match memberPersonIds length for rule=exact");
    }
    const shortfall = validateExactShares(sharePaise, totalPaise);
    if (shortfall !== 0) {
      throw new HttpError(400, `sharePaise do not sum to transaction amount: shortfall=${shortfall}`);
    }
    computed = sharePaise;
  }

  return await db.transaction(async (tx) => {
    const [split] = await tx
      .insert(splits)
      .values({
        transactionId,
        householdId,
        rule,
        payerPersonId,
        createdByUserId: userId,
      })
      .returning();
    if (!split) throw new HttpError(400, "Failed to insert split");

    if (memberPersonIds.length > 0) {
      await tx.insert(splitShares).values(
        memberPersonIds.map((personId, i) => ({
          splitId: split.id,
          personId,
          sharePaise: computed[i]!,
        })),
      );
    }

    return split;
  });
}

export async function deleteSplit(
  db: DbOrTx,
  userId: string,
  splitId: string,
): Promise<void> {
  const [split] = await db
    .select({ createdByUserId: splits.createdByUserId })
    .from(splits)
    .where(eq(splits.id, splitId));
  if (!split) throw new HttpError(404, `Split ${splitId} not found`);
  if (split.createdByUserId !== userId) {
    throw new HttpError(403, "Forbidden: only the creator can delete this split");
  }
  await db.delete(splits).where(eq(splits.id, splitId));
}

export async function getSplit(
  db: DbOrTx,
  _userId: string,
  splitId: string,
): Promise<{ split: typeof splits.$inferSelect; shares: (typeof splitShares.$inferSelect)[] }> {
  const [split] = await db.select().from(splits).where(eq(splits.id, splitId));
  if (!split) throw new HttpError(404, "Split not found");
  const shares = await db.select().from(splitShares).where(eq(splitShares.splitId, splitId));
  return { split, shares };
}

export async function updateSplit(
  db: Db,
  userId: string,
  splitId: string,
  input: { rule?: SplitRule; payerPersonId?: string; totalPaise?: number; memberPersonIds?: string[]; sharePaise?: number[]; ratios?: number[] },
): Promise<{ split: typeof splits.$inferSelect; shares: (typeof splitShares.$inferSelect)[] }> {
  const [existing] = await db.select().from(splits).where(eq(splits.id, splitId));
  if (!existing) throw new HttpError(404, "Split not found");
  if (existing.createdByUserId !== userId) throw new HttpError(403, "Only the creator can update this split");

  const rule = (input.rule ?? existing.rule) as SplitRule;
  const payerPersonId = input.payerPersonId ?? existing.payerPersonId;

  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(splits)
      .set({ rule, payerPersonId, updatedAt: new Date() })
      .where(eq(splits.id, splitId))
      .returning();
    if (!updated) throw new HttpError(500, "Failed to update split");

    // Re-create shares if memberPersonIds + totalPaise provided
    if (input.memberPersonIds && input.totalPaise) {
      await tx.delete(splitShares).where(eq(splitShares.splitId, splitId));
      let computed: number[];
      if (rule === "equal") {
        computed = computeEqualShares(input.totalPaise, input.memberPersonIds.length);
      } else if (rule === "shares") {
        if (!input.ratios) throw new HttpError(400, "ratios required for rule=shares");
        computed = computeProportionalShares(input.totalPaise, input.ratios);
      } else {
        if (!input.sharePaise) throw new HttpError(400, "sharePaise required for rule=exact");
        const shortfall = validateExactShares(input.sharePaise, input.totalPaise);
        if (shortfall !== 0) throw new HttpError(400, `sharePaise do not sum to totalPaise: shortfall=${shortfall}`);
        computed = input.sharePaise;
      }
      await tx.insert(splitShares).values(
        input.memberPersonIds.map((personId, i) => ({
          splitId: splitId,
          personId,
          sharePaise: computed[i]!,
        }))
      );
    }

    const shares = await tx.select().from(splitShares).where(eq(splitShares.splitId, splitId));
    return { split: updated, shares };
  });
}
