import { and, eq } from "drizzle-orm";
import type { AccountType, AssetClass, GainsTaxClass, SipFrequency } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts } from "../../../db/schema.ts";
import { holdings, sips } from "../schema.ts";
import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../planning/services/goal-allocation.ts";
import { assertPublicAccountType } from "../../../lib/account-type.ts";

// ---------- Committed monthly (goal-plan gap) ----------

export interface ClassifiableSip {
  amountPaise: number;
  /** defaults to "monthly" when omitted, so existing call sites need not change. */
  frequency?: SipFrequency;
  allocationClass: GoalAllocationClass;
}

/**
 * A SIP's contribution monthlyized for the goal plan's ₹/mo comparison: a
 * quarterly deposit counts a third each month, a yearly one a twelfth — so a
 * lumpy PPF/SSY contribution still compares fairly against a monthly MF SIP.
 */
export function monthlyEquivalentPaise(amountPaise: number, frequency: SipFrequency): number {
  if (frequency === "quarterly") return Math.round(amountPaise / 3);
  if (frequency === "yearly") return Math.round(amountPaise / 12);
  return amountPaise;
}

/** Sum a set of already-classified SIPs into the equity/debt legs a goal plan compares against. */
export function committedSplit(
  sips: ClassifiableSip[],
): { committedEquityPaise: number; committedDebtPaise: number } {
  let equity = 0;
  let debt = 0;
  for (const s of sips) {
    const monthly = monthlyEquivalentPaise(s.amountPaise, s.frequency ?? "monthly");
    if (s.allocationClass === "equity") equity += monthly;
    else if (s.allocationClass === "debt") debt += monthly;
    // "other" targets (shouldn't happen for a SIP target, but stay defensive) don't count.
  }
  return { committedEquityPaise: equity, committedDebtPaise: debt };
}

/** Classify one SIP's target the same way the goal-plan reports current holdings/accounts. */
export function classifySipTarget(sip: {
  targetKind: "mf_folio" | "account";
  holding: { assetClass: AssetClass; gainsTaxClass: GainsTaxClass } | null;
  account: { type: AccountType } | null;
}): GoalAllocationClass {
  if (sip.targetKind === "mf_folio") {
    return sip.holding ? holdingAllocationClass(sip.holding.assetClass, sip.holding.gainsTaxClass) : "other";
  }
  return sip.account ? accountAllocationClass(sip.account.type) : "other";
}

/**
 * Committed equity/debt paise-per-month for a goal's *active* SIPs — the basis
 * for the goal plan's gap. Joins each SIP's target so classification matches
 * exactly how the plan classifies mapped assets (holdingAllocationClass /
 * accountAllocationClass).
 */
export async function committedForGoal(
  db: Db,
  userId: string,
  goalId: string,
): Promise<{ committedEquityPaise: number; committedDebtPaise: number }> {
  const rows = await db
    .select({
      amountPaise: sips.amountPaise,
      frequency: sips.frequency,
      targetKind: sips.targetKind,
      holdingAssetClass: holdings.assetClass,
      holdingGainsTaxClass: holdings.gainsTaxClass,
      accountType: accounts.type,
    })
    .from(sips)
    .leftJoin(holdings, eq(holdings.id, sips.targetHoldingId))
    .leftJoin(accounts, eq(accounts.id, sips.targetAccountId))
    .where(and(eq(sips.userId, userId), eq(sips.goalId, goalId), eq(sips.status, "active")));

  const classified: ClassifiableSip[] = rows.map((r) => ({
    amountPaise: r.amountPaise,
    frequency: r.frequency,
    allocationClass: classifySipTarget({
      targetKind: r.targetKind,
      holding:
        r.holdingAssetClass && r.holdingGainsTaxClass
          ? { assetClass: r.holdingAssetClass, gainsTaxClass: r.holdingGainsTaxClass }
          : null,
      account: r.accountType ? { type: assertPublicAccountType(r.accountType) } : null,
    }),
  }));
  return committedSplit(classified);
}
